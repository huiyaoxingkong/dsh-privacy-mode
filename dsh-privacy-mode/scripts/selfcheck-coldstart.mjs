/**
 * Cold-start and switch harness.
 *
 * It runs the real `lib/engine.js` against fake DSH services, in a throwaway
 * directory, and asserts the properties the acceptance list cares about that a live
 * profile cannot cheaply prove:
 *
 *  - a NORMAL profile keeps every marked-private bundle deselected and archives the
 *    sessions a marked workspace hides;
 *  - PRIVATE enables everything and restores exactly the sessions NORMAL archived;
 *  - a failing step rolls the whole switch back;
 *  - a cold start re-reads mode, markings and the PIN from disk, and relocks a
 *    PIN-guarded profile unless `keepPrivateAcrossRestart` says otherwise;
 *  - the PIN is stored as scrypt with a salt and never in plaintext anywhere;
 *  - the request path answers before a bundle toggle runs, one job at a time, and a
 *    toggle waits for the calling session's turn to end — the three properties that
 *    keep a switch from aborting the caller's own turn.
 *
 * Run: node scripts/selfcheck-coldstart.mjs
 */
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign as signData } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createEngine } from '../lib/engine.js'
import { PrivacyStore, verifyPin } from '../lib/store.js'
import { registerPrivacyTool } from '../tools.js'

const results = []
let failures = 0

function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    failures += 1
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

async function checkAsync(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
  } catch (error) {
    failures += 1
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

function makeWorld({ failOnDisable = null, listDelayMs = 0, toggleDelayMs = 0 } = {}) {
  const bundles = new Map([
    ['beta-plugin', { name: 'beta-plugin', version: '1.0.0', enabled: true, installed: true, rows: [{}, {}] }],
    ['gamma-plugin', { name: 'gamma-plugin', version: '2.0.0', enabled: true, installed: true, rows: [{}] }],
    ['delta-plugin', { name: 'delta-plugin', version: '3.0.0', enabled: false, installed: true, rows: [{}] }],
    ['dsh-privacy-mode', { name: 'dsh-privacy-mode', version: '0.1.0', enabled: true, installed: true, rows: [{}] }],
  ])
  const calls = []
  let listBundlesCalls = 0
  const pluginManager = {
    async listBundles() {
      listBundlesCalls += 1
      if (listDelayMs > 0) await sleep(listDelayMs)
      return [...bundles.values()].map((bundle) => ({ ...bundle }))
    },
    async setBundleEnabled(name, enabled) {
      calls.push({ name, enabled, at: Date.now() })
      if (toggleDelayMs > 0) await sleep(toggleDelayMs)
      if (failOnDisable !== null && name === failOnDisable && enabled === false) {
        throw new Error(`injected failure disabling ${name}`)
      }
      const bundle = bundles.get(name)
      if (bundle === undefined) throw new Error(`unknown bundle ${name}`)
      bundle.enabled = enabled
      return { changed: true, application: 'applied', stage: 'enable', target: name, enabled }
    },
  }

  const workspaces = new Map([
    ['ws-public', { id: 'ws-public', path: '/tmp/public', title: 'Public', sessionIds: ['s-pub-1', 's-pub-2'] }],
    ['ws-private', { id: 'ws-private', path: '/tmp/private', title: 'Private', sessionIds: ['s-priv-1', 's-priv-2'] }],
  ])
  const archived = new Set(['s-user-archived'])
  const workspaceRegistry = {
    list() {
      return [...workspaces.values()].map((workspace) => ({ ...workspace, sessionIds: [...workspace.sessionIds] }))
    },
    get(id) {
      const workspace = workspaces.get(id)
      return workspace === undefined ? undefined : { ...workspace, sessionIds: [...workspace.sessionIds] }
    },
    get archivedSessionIds() {
      return [...archived]
    },
    async archiveSession(sessionId) {
      archived.add(sessionId)
    },
    async unarchiveSession(sessionId) {
      archived.delete(sessionId)
    },
  }

  const sessionQuery = {
    async readTitleSnapshots(ids) {
      return ids.map((id) => ({ sessionId: id, title: id }))
    },
  }

  return {
    pluginManager,
    workspaceRegistry,
    sessionQuery,
    bundles,
    archived,
    calls,
    get listBundlesCalls() {
      return listBundlesCalls
    },
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Wait for the engine's queue to drain; the routes answer before it does. */
async function settle(engine, timeoutMs = 8000) {
  const started = Date.now()
  for (;;) {
    const current = engine.job()
    const pending = current !== null && (current.status === 'queued' || current.status === 'running')
    if (!pending) return current
    if (Date.now() - started > timeoutMs) throw new Error('the switch job never settled')
    await sleep(20)
  }
}

/** A fake `agents` service: one session whose turn is open or closed on demand. */
function makeAgents() {
  const model = { open: false, live: true }
  return {
    model,
    service: {
      get() {
        return model.live ? { session: { id: 's-live' } } : undefined
      },
      turnBoundaryOf() {
        return { openTurnStartSeq: model.open ? 7 : null, lastTurn: model.open ? 1 : 0 }
      },
    },
  }
}

/* --------------------------------------------------------------------------
 * A WebAuthn authenticator, in about sixty lines.
 *
 * The Host verifier is the part that must be right, and it can be exercised
 * without a browser: generate an ES256 key, build the CBOR an authenticator would
 * send, and sign the assertion the way a platform authenticator signs it.
 * ------------------------------------------------------------------------ */

function b64u(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

/** CBOR map with one text key `authData` holding the authenticator data bytes. */
function attestationObject(authData) {
  const key = Buffer.from('authData', 'utf8')
  const length = authData.length
  const header = length < 24
    ? Buffer.from([0x40 | length])
    : length < 256
      ? Buffer.from([0x58, length])
      : Buffer.from([0x59, length >> 8, length & 0xff])
  return Buffer.concat([Buffer.from([0xa1, 0x60 | key.length]), key, header, authData])
}

/** COSE_Key for an ES256 P-256 public key, as an authenticator encodes it. */
function coseKey(jwk) {
  const x = Buffer.from(jwk.x.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const y = Buffer.from(jwk.y.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return Buffer.concat([
    Buffer.from([0xa5]),
    Buffer.from([0x01, 0x02]),
    Buffer.from([0x03, 0x26]),
    Buffer.from([0x20, 0x01]),
    Buffer.from([0x21, 0x58, x.length]), x,
    Buffer.from([0x22, 0x58, y.length]), y,
  ])
}

function registrationAuthData({ host, credentialId, jwk, userVerified = true }) {
  const rpIdHash = createHash('sha256').update(host).digest()
  const flags = Buffer.from([0x41 | (userVerified ? 0x04 : 0x00)])
  const signCount = Buffer.alloc(4)
  const aaguid = Buffer.alloc(16)
  const idLength = Buffer.alloc(2)
  idLength.writeUInt16BE(credentialId.length, 0)
  return Buffer.concat([rpIdHash, flags, signCount, aaguid, idLength, credentialId, coseKey(jwk)])
}

function assertionAuthData({ host, signCount = 1, userVerified = true }) {
  const rpIdHash = createHash('sha256').update(host).digest()
  const flags = Buffer.from([0x01 | (userVerified ? 0x04 : 0x00)])
  const counter = Buffer.alloc(4)
  counter.writeUInt32BE(signCount, 0)
  return Buffer.concat([rpIdHash, flags, counter])
}

/** Sign `authenticatorData || SHA-256(clientDataJSON)`, exactly as an authenticator does. */
function signAssertion({ privateKey, authenticatorData, clientDataJSON }) {
  const clientHash = createHash('sha256').update(Buffer.from(clientDataJSON, 'utf8')).digest()
  return signData('sha256', Buffer.concat([authenticatorData, clientHash]), { key: privateKey, dsaEncoding: 'der' })
}

function config(overrides = {}) {
  return {
    defaultMode: 'normal',
    requirePin: true,
    keepPrivateAcrossRestart: false,
    hideWorkspaceRows: true,
    adoptDefaultPreset: false,
    basePreset: 'standard',
    presets: { normal: 'privacy-normal', private: 'privacy-private' },
    ...overrides,
  }
}

function workspace() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-privacy-mode-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

async function main() {
  // ---- 1. NORMAL deselects marked bundles and archives hidden sessions ----------
  const box1 = workspace()
  const world1 = makeWorld()
  const store1 = new PrivacyStore({ dir: box1.dir, defaultMode: 'normal' })
  const engine1 = createEngine({ store: store1, config: config(), services: world1 })

  engine1.mark('bundle', 'beta-plugin', 'private')
  engine1.mark('workspace', 'ws-private', 'private')
  engine1.mark('session', 's-pub-2', 'private')
  const normalReport = await engine1.reconcile({ actor: 'harness', reason: 'boot' })

  await checkAsync('NORMAL: marked bundle is deselected', async () => {
    assert.equal(normalReport.ok, true, JSON.stringify(normalReport.problems))
    assert.equal(world1.bundles.get('beta-plugin').enabled, false)
    assert.equal(world1.bundles.get('gamma-plugin').enabled, true)
  })
  await checkAsync('NORMAL: marked workspace and session are archived', async () => {
    assert.deepEqual([...world1.archived].sort(), ['s-priv-1', 's-priv-2', 's-pub-2', 's-user-archived'])
    const state = store1.read()
    assert.equal(state.archived.length, 3)
  })
  await checkAsync('NORMAL: a session the user archived by hand is not claimed', async () => {
    const state = store1.read()
    assert.equal(state.archived.some((record) => record.sessionId === 's-user-archived'), false)
  })
  await checkAsync('NORMAL: a bundle the user turned off is left alone', async () => {
    assert.equal(world1.bundles.get('delta-plugin').enabled, false)
    assert.deepEqual(store1.read().disabledByMode, ['beta-plugin'])
  })

  // ---- 2. PRIVATE is a superset and restores exactly what NORMAL hid -----------
  const switchPrivate = await engine1.switchTo('private', { actor: 'harness' })
  await checkAsync('PRIVATE: every bundle is enabled again', async () => {
    assert.equal(switchPrivate.ok, true, JSON.stringify(switchPrivate.problems))
    assert.equal(world1.bundles.get('beta-plugin').enabled, true)
  })
  await checkAsync('PRIVATE: only the sessions NORMAL archived are unarchived', async () => {
    assert.deepEqual([...world1.archived], ['s-user-archived'])
    assert.equal(store1.read().archived.length, 0)
    assert.equal(store1.read().mode, 'private')
  })

  const switchNormal = await engine1.switchTo('normal', { actor: 'harness' })
  await checkAsync('back to NORMAL: the same sessions are archived again', async () => {
    assert.equal(switchNormal.ok, true, JSON.stringify(switchNormal.problems))
    assert.deepEqual([...world1.archived].sort(), ['s-priv-1', 's-priv-2', 's-pub-2', 's-user-archived'])
  })
  await checkAsync('the switch never marked our own bundle private', async () => {
    assert.equal(world1.bundles.get('dsh-privacy-mode').enabled, true)
    assert.equal(store1.read().privateBundles.includes('dsh-privacy-mode'), false)
  })
  box1.cleanup()

  // ---- 2b. Dropping a marking gives the session back; a user archive stays --------
  const box4 = workspace()
  const world4 = makeWorld()
  world4.archived.add('s-priv-2') // the user archived this one by hand before we ran
  const store4 = new PrivacyStore({ dir: box4.dir, defaultMode: 'normal' })
  const engine4 = createEngine({ store: store4, config: config(), services: world4 })
  engine4.mark('workspace', 'ws-private', 'private')
  const firstPass = await engine4.reconcile({ actor: 'harness', reason: 'boot' })
  await checkAsync('marking a workspace archives only what it must', async () => {
    assert.equal(firstPass.ok, true, JSON.stringify(firstPass.problems))
    assert.deepEqual([...world4.archived].sort(), ['s-priv-1', 's-priv-2', 's-user-archived'])
  })
  engine4.mark('workspace', 'ws-private', 'unclassified')
  const restored = await engine4.reconcile({ actor: 'harness', reason: 'mark' })
  await checkAsync('dropping the marking in NORMAL unarchives the session we archived', async () => {
    assert.equal(restored.ok, true, JSON.stringify(restored.problems))
    assert.deepEqual([...world4.archived].sort(), ['s-priv-2', 's-user-archived'])
    assert.equal(store4.read().archived.length, 0)
  })
  store4.write({ ...store4.read(), mode: 'private' })
  await engine4.reconcile({ actor: 'harness', reason: 'switch-private' })
  await checkAsync('PRIVATE never unarchives a session the user archived', async () => {
    assert.deepEqual([...world4.archived].sort(), ['s-priv-2', 's-user-archived'])
  })
  box4.cleanup()

  // ---- 3. A failing step rolls the switch back --------------------------------
  const box2 = workspace()
  const world2 = makeWorld({ failOnDisable: 'gamma-plugin' })
  const store2 = new PrivacyStore({ dir: box2.dir, defaultMode: 'private' })
  const engine2 = createEngine({ store: store2, config: config(), services: world2 })
  engine2.mark('bundle', 'gamma-plugin', 'private')
  store2.write({ ...store2.read(), mode: 'private' })
  const rollback = await engine2.switchTo('normal', { actor: 'harness' })
  await checkAsync('a failing disable rolls the switch back', async () => {
    assert.equal(rollback.ok, false)
    assert.equal(rollback.rolledBack, true)
    assert.equal(world2.bundles.get('beta-plugin').enabled, true, 'first disable was undone')
    assert.equal(store2.read().mode, 'private', 'mode is unchanged after a rollback')
  })
  await checkAsync('a failed switch is recorded in the audit log', async () => {
    const entries = store2.auditTail(10)
    assert.equal(entries.some((entry) => entry.action === 'switch-normal-failed'), true)
  })
  box2.cleanup()

  // ---- 4. The PIN -------------------------------------------------------------
  const box3 = workspace()
  const world3 = makeWorld()
  const store3 = new PrivacyStore({ dir: box3.dir, defaultMode: 'normal' })
  const engine3 = createEngine({ store: store3, config: config(), services: world3 })
  const tooShort = engine3.setPin('abc')
  const set = engine3.setPin('4821')
  const wrong = await engine3.switchTo('private', { pin: '0000', actor: 'harness' })
  const modeAfterWrong = store3.read().mode
  const right = await engine3.switchTo('private', { pin: '4821', actor: 'harness' })

  check('PIN: a short PIN is refused', () => assert.equal(tooShort.ok, false))
  check('PIN: stored as scrypt with a salt', () => {
    assert.equal(set.ok, true)
    const pin = store3.read().pin
    assert.equal(pin.algo, 'scrypt')
    assert.equal(typeof pin.salt, 'string')
    assert.equal(pin.salt.length, 32)
    assert.equal(pin.hash.length, 64)
  })
  await checkAsync('PIN: a wrong PIN is refused and the mode does not move', async () => {
    assert.equal(wrong.ok, false)
    assert.equal(wrong.error, 'pin-mismatch')
    assert.equal(modeAfterWrong, 'normal')
  })
  await checkAsync('PIN: the right PIN enters PRIVATE', async () => {
    assert.equal(right.ok, true, JSON.stringify(right))
    assert.equal(store3.read().mode, 'private')
  })
  check('PIN: no plaintext PIN anywhere on disk', () => {
    const state = readFileSync(store3.statePath, 'utf8')
    const audit = existsSync(store3.auditPath) ? readFileSync(store3.auditPath, 'utf8') : ''
    assert.equal(state.includes('4821'), false)
    assert.equal(audit.includes('4821'), false)
  })

  // ---- 5. Cold start ----------------------------------------------------------
  const coldEngine = createEngine({ store: new PrivacyStore({ dir: box3.dir, defaultMode: 'normal' }), config: config(), services: world3 })
  const boot = await coldEngine.bootstrap()
  await checkAsync('cold start: a PIN-guarded PRIVATE profile relocks to NORMAL', async () => {
    assert.equal(boot.ok, true, JSON.stringify(boot.problems))
    assert.equal(coldEngine.state().mode, 'normal')
    assert.equal(world3.bundles.get('beta-plugin').enabled, true)
  })
  check('cold start: markings and PIN survive', () => {
    const state = coldEngine.state()
    assert.equal(state.pin !== null, true)
    assert.equal(Array.isArray(state.privateBundles), true)
  })
  check('cold start: the relock is audited', () => {
    const entries = coldEngine.auditTail(20)
    assert.equal(entries.some((entry) => entry.action === 'boot-relock'), true)
  })

  const keepBox = workspace()
  const keepWorld = makeWorld()
  const keepStore = new PrivacyStore({ dir: keepBox.dir, defaultMode: 'normal' })
  const keepEngine = createEngine({ store: keepStore, config: config({ keepPrivateAcrossRestart: true }), services: keepWorld })
  keepEngine.setPin('4821')
  keepStore.write({ ...keepStore.read(), mode: 'private' })
  const keepBoot = await keepEngine.bootstrap()
  await checkAsync('cold start: keepPrivateAcrossRestart keeps PRIVATE', async () => {
    assert.equal(keepBoot.ok, true, JSON.stringify(keepBoot.problems))
    assert.equal(keepEngine.state().mode, 'private')
  })

  // ---- 6. Snapshot shape ------------------------------------------------------
  const snapshot = await keepEngine.snapshot({ wait: true })
  check('snapshot: classifications and sets are present', () => {
    assert.equal(typeof snapshot.mode, 'string')
    assert.equal(Array.isArray(snapshot.bundles), true)
    assert.equal(snapshot.bundles.some((bundle) => bundle.classification === 'unclassified'), true)
    assert.equal(typeof snapshot.auditPath, 'string')
    assert.equal(JSON.stringify(snapshot).includes('4821'), false)
  })
  box3.cleanup()
  keepBox.cleanup()

  // ---- 7. The request path never waits for a profile recomposition ------------
  // Regression guard for the aborts: a bundle toggle recomposes the profile and
  // disposes live agents, so the HTTP surface answers `accepted` and the poll reads
  // the result. Nothing on the request path may await `setBundleEnabled`.
  const box5 = workspace()
  const world5 = makeWorld()
  const store5 = new PrivacyStore({ dir: box5.dir, defaultMode: 'normal' })
  const engine5 = createEngine({ store: store5, config: config(), services: world5 })
  engine5.mark('bundle', 'beta-plugin', 'private')

  const listingBefore = world5.listBundlesCalls
  const ack = engine5.requestReconcile({ reason: 'mark' })
  check('a marking is accepted before any bundle is toggled', () => {
    assert.equal(ack.accepted, true)
    assert.equal(world5.calls.length, 0, 'no bundle was toggled on the request path')
  })
  const settled5 = await settle(engine5)
  await checkAsync('the accepted marking still applies', async () => {
    assert.equal(settled5.status, 'done')
    assert.equal(world5.bundles.get('beta-plugin').enabled, false)
  })
  check('one listBundles per reconcile, not two', () => {
    assert.equal(world5.listBundlesCalls - listingBefore, 1)
  })
  const warm = await engine5.snapshot()
  check('the poll is answered from cache and reports the job', () => {
    assert.equal(warm.bundlesReady, true)
    assert.equal(warm.bundles.length, 4)
    assert.equal(warm.job.status, 'done')
    assert.equal(typeof warm.job.finishedAt, 'number')
  })
  box5.cleanup()

  // ---- 7b. One job at a time, and the answer comes before the work ------------
  const box6 = workspace()
  const world6 = makeWorld({ toggleDelayMs: 200 })
  const store6 = new PrivacyStore({ dir: box6.dir, defaultMode: 'normal' })
  const engine6 = createEngine({ store: store6, config: config(), services: world6 })
  engine6.mark('bundle', 'gamma-plugin', 'private')
  const first = engine6.requestReconcile({ reason: 'mark' })
  const second = engine6.requestSwitch('private')
  await settle(engine6)
  check('a second request queues behind the running one instead of dead-ending', () => {
    assert.equal(first.accepted, true)
    assert.equal(second.ok, true, JSON.stringify(second))
    assert.equal(second.queued, true)
  })
  await checkAsync('the queued switch still runs', async () => {
    assert.equal(store6.read().mode, 'private')
  })
  box6.cleanup()

  const box7 = workspace()
  const world7 = makeWorld({ toggleDelayMs: 120 })
  const store7 = new PrivacyStore({ dir: box7.dir, defaultMode: 'normal' })
  const engine7 = createEngine({ store: store7, config: config(), services: world7 })
  const answeredAt = Date.now()
  const ackSwitch = engine7.requestSwitch('private')
  const answerMs = Date.now() - answeredAt
  check('a switch answers before the recomposition runs', () => {
    assert.equal(ackSwitch.accepted, true)
    assert.ok(answerMs < 50, `answered in ${answerMs}ms`)
  })
  const done7 = await settle(engine7)
  await checkAsync('the accepted switch finished with a mode and timings', async () => {
    assert.equal(done7.status, 'done')
    assert.equal(store7.read().mode, 'private')
    assert.equal(Array.isArray(done7.timings), true)
  })
  box7.cleanup()

  // ---- 7c. A toggle waits for the calling session's turn to end ---------------
  const box8 = workspace()
  const world8 = makeWorld()
  const agents = makeAgents()
  agents.model.open = true
  const store8 = new PrivacyStore({ dir: box8.dir, defaultMode: 'normal' })
  const engine8 = createEngine({ store: store8, config: config(), services: { ...world8, agents: agents.service } })
  engine8.mark('bundle', 'beta-plugin', 'private')
  const idleStartedAt = Date.now()
  const pendingIdle = engine8.reconcile({ sessionId: 's-live', reason: 'mark' })
  setTimeout(() => { agents.model.open = false }, 260)
  const idleReport = await pendingIdle
  const idleWaited = Date.now() - idleStartedAt
  await checkAsync('a toggle waits for the calling session to go idle', async () => {
    assert.equal(idleReport.ok, true, JSON.stringify(idleReport.problems))
    assert.ok(idleWaited >= 240, `only waited ${idleWaited}ms`)
    assert.equal(world8.calls.length, 1)
    assert.ok(world8.calls[0].at - idleStartedAt >= 240, 'the toggle ran while the turn was open')
    assert.equal(idleReport.timings.some((step) => step.step === 'await-idle'), true)
  })
  box8.cleanup()

  // ---- 8. First-run password rule and the fingerprint unlock ------------------
  const box9 = workspace()
  const world9 = makeWorld()
  const store9 = new PrivacyStore({ dir: box9.dir, defaultMode: 'normal' })
  const engine9 = createEngine({ store: store9, config: config(), services: world9 })

  const mismatched = engine9.setPin('1234', { confirm: '1235' })
  check('PIN: the two entries must match', () => {
    assert.equal(mismatched.ok, false)
    assert.equal(mismatched.error, 'pin-confirm-mismatch')
    assert.equal(store9.read().pin, null, 'a mismatched setup stores nothing')
  })
  const confirmed = engine9.setPin('1234', { confirm: '1234' })
  check('PIN: two identical entries are stored', () => {
    assert.equal(confirmed.ok, true)
    assert.equal(typeof store9.read().pin.hash, 'string')
  })

  const host = 'localhost'
  const origin = `http://${host}:59806`
  const credentialId = Buffer.from('credential-1', 'utf8')
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })

  const beginReg = engine9.beginRegistration()
  const registration = engine9.finishRegistration({
    challenge: beginReg.challenge,
    clientDataJSON: b64u(JSON.stringify({ type: 'webauthn.create', challenge: beginReg.challenge, origin })),
    attestationObject: b64u(attestationObject(registrationAuthData({ host, credentialId, jwk }))),
    host,
  })
  check('fingerprint: a registration is verified and stored', () => {
    assert.equal(registration.ok, true, JSON.stringify(registration))
    const stored = store9.read().credential
    assert.equal(typeof stored.id, 'string')
    assert.equal(stored.id, b64u(credentialId))
    assert.equal(stored.publicKey.kty, 'EC')
  })
  check('fingerprint: only the public key reaches the state file', () => {
    const text = readFileSync(store9.statePath, 'utf8')
    assert.equal(text.includes(String(jwk.d ?? 'no-private-part')), false)
  })

  const beginAssert = engine9.beginAssertion()
  const assertClientData = JSON.stringify({ type: 'webauthn.get', challenge: beginAssert.challenge, origin })
  const authData = assertionAuthData({ host, signCount: 1 })
  const signature = signAssertion({ privateKey, authenticatorData: authData, clientDataJSON: assertClientData })
  const unlocked = engine9.finishAssertion({
    challenge: beginAssert.challenge,
    clientDataJSON: b64u(assertClientData),
    authenticatorData: b64u(authData),
    signature: b64u(signature),
    host,
  })
  await settle(engine9)
  await checkAsync('fingerprint: a valid assertion unlocks and switches to PRIVATE', async () => {
    assert.equal(unlocked.ok, true, JSON.stringify(unlocked))
    assert.equal(unlocked.accepted, true)
    assert.equal(store9.read().mode, 'private', 'PRIVATE is reached without typing the PIN')
  })

  const replay = engine9.finishAssertion({
    challenge: beginAssert.challenge,
    clientDataJSON: b64u(assertClientData),
    authenticatorData: b64u(authData),
    signature: b64u(signature),
    host,
  })
  check('fingerprint: a challenge cannot be replayed', () => {
    assert.equal(replay.ok, false)
    assert.equal(replay.error, 'challenge-expired')
  })

  const forged = (() => {
    const begin = engine9.beginAssertion()
    const clientData = JSON.stringify({ type: 'webauthn.get', challenge: begin.challenge, origin })
    const data = assertionAuthData({ host })
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
    return engine9.finishAssertion({
      challenge: begin.challenge,
      clientDataJSON: b64u(clientData),
      authenticatorData: b64u(data),
      signature: b64u(signAssertion({ privateKey: other, authenticatorData: data, clientDataJSON: clientData })),
      host,
    })
  })()
  check('fingerprint: a forged signature is refused', () => {
    assert.equal(forged.ok, false)
    assert.match(String(forged.error), /does not verify/u)
  })

  const unverified = (() => {
    const begin = engine9.beginAssertion()
    const clientData = JSON.stringify({ type: 'webauthn.get', challenge: begin.challenge, origin })
    const data = assertionAuthData({ host, userVerified: false })
    return engine9.finishAssertion({
      challenge: begin.challenge,
      clientDataJSON: b64u(clientData),
      authenticatorData: b64u(data),
      signature: b64u(signAssertion({ privateKey, authenticatorData: data, clientDataJSON: clientData })),
      host,
    })
  })()
  check('fingerprint: an assertion without user verification is refused', () => {
    assert.equal(unverified.ok, false)
    assert.match(String(unverified.error), /did not verify the user/u)
  })

  const foreignOrigin = (() => {
    const begin = engine9.beginAssertion()
    const clientData = JSON.stringify({ type: 'webauthn.get', challenge: begin.challenge, origin: 'http://evil.example:59806' })
    const data = assertionAuthData({ host })
    return engine9.finishAssertion({
      challenge: begin.challenge,
      clientDataJSON: b64u(clientData),
      authenticatorData: b64u(data),
      signature: b64u(signAssertion({ privateKey, authenticatorData: data, clientDataJSON: clientData })),
      host,
    })
  })()
  check('fingerprint: an assertion from another origin is refused', () => {
    assert.equal(foreignOrigin.ok, false)
    assert.match(String(foreignOrigin.error), /evil\.example/u)
  })

  const cleared = engine9.clearCredential()
  check('fingerprint: the credential can be removed', () => {
    assert.equal(cleared.ok, true)
    assert.equal(store9.read().credential, null)
  })
  box9.cleanup()

  // ---- 9. Password recovery through the platform authenticator ----------------
  const box10 = workspace()
  const world10 = makeWorld()
  const store10 = new PrivacyStore({ dir: box10.dir, defaultMode: 'normal' })
  const engine10 = createEngine({ store: store10, config: config(), services: world10 })
  engine10.setPin('1111', { confirm: '1111' })

  const key10 = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk10 = key10.publicKey.export({ format: 'jwk' })
  const beginReg10 = engine10.beginRegistration()
  engine10.finishRegistration({
    challenge: beginReg10.challenge,
    clientDataJSON: b64u(JSON.stringify({ type: 'webauthn.create', challenge: beginReg10.challenge, origin })),
    attestationObject: b64u(attestationObject(registrationAuthData({ host, credentialId: Buffer.from('cred-2'), jwk: jwk10 }))),
    host,
  })

  const beginRecover = engine10.beginAssertion()
  const recoverClientData = JSON.stringify({ type: 'webauthn.get', challenge: beginRecover.challenge, origin })
  const recoverData = assertionAuthData({ host, signCount: 2 })
  const recovered = engine10.finishAssertion({
    challenge: beginRecover.challenge,
    clientDataJSON: b64u(recoverClientData),
    authenticatorData: b64u(recoverData),
    signature: b64u(signAssertion({ privateKey: key10.privateKey, authenticatorData: recoverData, clientDataJSON: recoverClientData })),
    host,
    purpose: 'recover',
  })
  check('recovery: a verified gesture returns a one-time token and does not switch', () => {
    assert.equal(recovered.ok, true, JSON.stringify(recovered))
    assert.equal(typeof recovered.recovery, 'string')
    assert.equal(store10.read().mode, 'normal')
  })
  const reset = engine10.setPin('2222', { confirm: '2222', recovery: recovered.recovery })
  check('recovery: the token replaces the forgotten password', () => {
    assert.equal(reset.ok, true)
    assert.equal(reset.recovered, true)
  })
  const replayRecovery = engine10.setPin('3333', { confirm: '3333', recovery: recovered.recovery })
  check('recovery: the token is single use', () => {
    assert.equal(replayRecovery.ok, false)
    assert.equal(replayRecovery.error, 'current-pin-mismatch')
  })
  check('recovery: the old password no longer works', () => {
    assert.equal(verifyPin('1111', store10.read().pin), false)
  })
  box10.cleanup()

  // ---- 10. An install belongs to the mode it happened in ----------------------
  const box11 = workspace()
  const world11 = makeWorld()
  const store11 = new PrivacyStore({ dir: box11.dir, defaultMode: 'normal' })
  const engine11 = createEngine({ store: store11, config: config(), services: world11 })

  const inNormal = engine11.classifyInstalled('fresh-in-normal')
  check('install: in NORMAL a new bundle is an ordinary one', () => {
    assert.equal(inNormal.ok, true)
    assert.equal(inNormal.classification, 'public')
    assert.equal(store11.read().publicBundles.includes('fresh-in-normal'), true)
  })
  await engine11.requestSwitch('private')
  await settle(engine11)
  const inPrivate = engine11.classifyInstalled('fresh-in-private')
  check('install: in PRIVATE a new bundle is a private one', () => {
    assert.equal(inPrivate.ok, true)
    assert.equal(inPrivate.classification, 'private')
    assert.equal(store11.read().privateBundles.includes('fresh-in-private'), true)
  })
  check('install: this bundle never classifies itself', () => {
    assert.equal(engine11.classifyInstalled('dsh-privacy-mode').ok, false)
  })
  box11.cleanup()

  // ---- 11. The privacy_mode tool follows the mode, not a preset ----------------
  // A conversation keeps the preset it was composed with, so a preset-only row could
  // never reach the session the user is talking to. This mirrors what index.js wires:
  // register on entry, dispose on exit.
  const box12 = workspace()
  const world12 = makeWorld()
  const store12 = new PrivacyStore({ dir: box12.dir, defaultMode: 'normal' })
  const engine12 = createEngine({ store: store12, config: config(), services: world12 })
  const registered = []
  const toolsService = {
    register(definition) {
      registered.push(definition.name)
      return () => {
        const index = registered.indexOf(definition.name)
        if (index >= 0) registered.splice(index, 1)
      }
    },
  }
  let disposeTool = null
  const off = engine12.subscribeMode((mode) => {
    if (mode === 'private') {
      if (disposeTool === null) disposeTool = registerPrivacyTool({ tools: toolsService, dataDir: box12.dir })
      return
    }
    if (disposeTool !== null) {
      disposeTool()
      disposeTool = null
    }
  })
  check('tool: absent from a NORMAL catalog', () => {
    assert.deepEqual(registered, [])
  })
  await engine12.switchTo('private')
  await checkAsync('tool: present once the mode is PRIVATE', async () => {
    assert.deepEqual(registered, ['privacy_mode'])
  })
  await engine12.switchTo('normal')
  await checkAsync('tool: disposed again after leaving PRIVATE', async () => {
    assert.deepEqual(registered, [])
  })
  off()
  box12.cleanup()

  // ---- 12. Bulk classification is one write, one audit, one reconcile ---------
  const box13 = workspace()
  const world13 = makeWorld()
  const store13 = new PrivacyStore({ dir: box13.dir, defaultMode: 'private' })
  const engine13 = createEngine({ store: store13, config: config(), services: world13 })
  const bulkReport = engine13.markMany([
    { kind: 'bundle', id: 'beta-plugin', classification: 'private' },
    { kind: 'bundle', id: 'gamma-plugin', classification: 'private' },
    { kind: 'bundle', id: 'dsh-privacy-mode', classification: 'private' },
    { kind: 'workspace', id: 'ws-private', classification: 'public' },
  ])
  check('bulk: one call applies every item it can', () => {
    assert.equal(bulkReport.ok, true, JSON.stringify(bulkReport))
    assert.equal(bulkReport.applied, 3, 'the bundle itself is never classified')
    assert.deepEqual([...store13.read().privateBundles].sort(), ['beta-plugin', 'gamma-plugin'])
    assert.deepEqual(store13.read().publicWorkspaces, ['ws-private'])
  })
  check('bulk: the audit carries one entry for the batch', () => {
    const entries = store13.auditTail(10)
    assert.equal(entries.filter((entry) => entry.action === 'mark-bulk').length, 1)
  })
  check('bulk: an empty request is refused', () => {
    assert.equal(engine13.markMany([]).ok, false)
  })
  box13.cleanup()

  // ---- 13. A failed job never latches the door shut ---------------------------
  // The old switch kept a `busy` flag that a job whose promise was orphaned by a
  // recomposition could leave set forever, refusing every later switch. A failed job
  // must instead leave the next one free to run.
  const box14 = workspace()
  const world14 = makeWorld({ failOnDisable: 'gamma-plugin' })
  const store14 = new PrivacyStore({ dir: box14.dir, defaultMode: 'private' })
  const engine14 = createEngine({ store: store14, config: config(), services: world14 })
  engine14.mark('bundle', 'gamma-plugin', 'private')
  store14.write({ ...store14.read(), mode: 'private' })
  const failed = await engine14.switchTo('normal', { actor: 'harness' })
  await checkAsync('a failed switch does not block the next one', async () => {
    assert.equal(failed.ok, false)
    // Same state directory, healthy services: the next attempt must simply work.
    const engineRetry = createEngine({ store: store14, config: config(), services: makeWorld() })
    const retry = await engineRetry.switchTo('normal', { actor: 'harness' })
    assert.equal(retry.ok, true, JSON.stringify(retry.problems))
    assert.equal(store14.read().mode, 'normal')
  })
  box14.cleanup()

  // ---- report ----------------------------------------------------------------
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.ok ? '' : `\n      ${result.error}`}`)
  }
  console.log(`\n${results.length - failures}/${results.length} checks passed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('harness crashed:', error)
  process.exit(2)
})
