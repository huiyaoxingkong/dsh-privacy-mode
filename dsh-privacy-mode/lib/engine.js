/**
 * The mode engine: one function decides what NORMAL and PRIVATE mean, and the
 * switch is a transaction with a rollback that restores every step it applied.
 *
 * Two planes are driven from one mode value:
 *
 *  - Plugins. A bundle marked private is *deselected* in the profile, so its rows
 *    never load: no tools, no prompt sections, no plugin-list row. That is a
 *    profile-level fact, which is exactly what the requirement asks for.
 *  - Visibility. A session marked private, and every session of a workspace
 *    marked private, is archived through DSH's own registry. Archiving writes one
 *    id into the registry's archived set, never the session file, and unarchiving
 *    restores the recording position exactly.
 *
 * Everything here goes through injected callbacks rather than importing DSH
 * services, so the same engine runs against real services in the Host and against
 * fakes in the cold-start harness (`scripts/selfcheck-coldstart.mjs`).
 */
import { hashPin, verifyPin } from './store.js'
import { createChallenge, verifyAssertion, verifyRegistration } from './webauthn.js'

/** Our own bundle never becomes part of its own private set: that would unload the switch. */
export const SELF_BUNDLE = 'dsh-privacy-mode'

/** `listBundles()` is the expensive call in a poll, so its answer is reused briefly. */
const BUNDLE_CACHE_MS = 5000

/** Titles are decoration; a profile with hundreds of sessions must not pay for them.
 *  Each request fills in a bounded slice, so the rest arrive on the next one. */
const TITLE_LIMIT = 25
const TITLE_TTL_MS = 60_000

/** A switch waits this long for the calling session to finish its turn.
 *  Toggling a bundle recomposes the profile and disposes live agents, so a switch
 *  fired from a running turn would kill the turn it was asked from. Two minutes
 *  covers an ordinary turn; the cap only exists so a runaway agent loop cannot park
 *  the queue forever, and the audit records when the cap was hit. */
const IDLE_WAIT_MS = 120_000
const IDLE_POLL_MS = 250

const CLASSIFICATIONS = new Set(['private', 'public', 'unclassified'])

function unique(list) {
  return [...new Set(list.filter((item) => typeof item === 'string' && item.trim() !== ''))]
}

function without(list, value) {
  return list.filter((item) => item !== value)
}

function push(list, value) {
  return list.includes(value) ? list : [...list, value]
}

function messageOf(error) {
  if (error === null || error === undefined) return 'unknown error'
  if (typeof error === 'string') return error
  if (typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error)
}

/**
 * @param {object} options
 * @param {import('./store.js').PrivacyStore} options.store
 * @param {object} options.config resolved plugin config
 * @param {object} options.services DSH services, all optional except the manager and registry
 * @param {(message: string) => void} [options.log]
 */
export function createEngine({ store, config, services, log = () => {} }) {
  const presets = config.presets
  const titleCache = new Map()
  let lastError = ''
  let unlockedAt = 0
  /**
   * The one switch that may be in flight. The HTTP surface answers before the work
   * starts: a toggle deselects or reselects a bundle, which recomposes the profile
   * and disposes the live agents — including the caller's own turn when the request
   * came from inside it. Answering first keeps the browser honest and keeps a tool
   * call from being aborted under the client; the poll shows the result.
   */
  let job = null
  let queue = Promise.resolve()
  /** Set while a job holds its toggle back for a running turn, so the UI can say so. */
  let idleWait = null
  /** A newer request asks the current job to stop before it touches any bundle. */
  let cancelRequested = false
  /** Past this age a "running" job is treated as abandoned, not as a reason to refuse. */
  const STALE_JOB_MS = 30_000

  function jobStale(record) {
    return record !== null && record.status === 'running' && Date.now() - record.startedAt > STALE_JOB_MS
  }

  function jobSummary() {
    if (job === null) return null
    const summary = { ...job, result: job.result === undefined ? undefined : { ...job.result } }
    if (idleWait !== null) summary.waiting = { sessionId: idleWait.sessionId, ms: Date.now() - idleWait.startedAt }
    if (cancelRequested && job.status === 'running') summary.cancelling = true
    if (jobStale(job)) summary.stale = true
    return summary
  }

  function scheduleJob(kind, task) {
    const record = {
      id: `${kind}-${Date.now().toString(36)}`,
      kind,
      status: 'queued',
      startedAt: Date.now(),
    }
    job = record
    const run = queue.then(async () => {
      job = { ...record, status: 'running', startedAt: Date.now() }
      cancelRequested = false
      try {
        const result = await task()
        const failed = result !== null && typeof result === 'object' && result.ok === false
        job = {
          ...job,
          status: failed ? 'failed' : 'done',
          finishedAt: Date.now(),
          timings: Array.isArray(result?.timings) ? result.timings : [],
          ...failed ? { error: result.error ?? 'failed' } : {},
          result: summarizeResult(result),
        }
        return result
      } catch (error) {
        job = { ...job, status: 'failed', finishedAt: Date.now(), error: messageOf(error) }
        return { ok: false, error: messageOf(error) }
      } finally {
        cancelRequested = false
      }
    })
    queue = run.then(() => undefined, () => undefined)
    return { ...record }
  }

  /**
   * Take the place of a job that stopped making progress.
   *
   * A recomposition can tear down the very promise a job is waiting on, which would
   * otherwise leave it "running" forever — and a running job used to block the next
   * request, which is how an exit button turns into a dead end. An abandoned job is
   * left to unwind on its own while the queue moves on.
   */
  function abandonStaleJob() {
    if (!jobStale(job)) return false
    job = { ...job, status: 'abandoned', finishedAt: Date.now(), error: 'stale' }
    cancelRequested = true
    queue = Promise.resolve()
    return true
  }

  /** What the poll may see about a finished job: no internal objects, no secrets. */
  function summarizeResult(result) {
    if (result === null || typeof result !== 'object') return {}
    const summary = {
      ok: result.ok !== false,
      mode: result.mode,
      bundles: Array.isArray(result.bundles) ? result.bundles : [],
      archived: Array.isArray(result.archived) ? result.archived : [],
      unarchived: Array.isArray(result.unarchived) ? result.unarchived : [],
      problems: Array.isArray(result.problems) ? result.problems : [],
    }
    if (typeof result.tempSessionId === 'string') summary.tempSessionId = result.tempSessionId
    if (typeof result.error === 'string') summary.error = result.error
    return summary
  }

  /**
   * Let the calling session finish its turn before a profile recomposition runs.
   * The check is the same turn boundary `openTempSession` reads; a session that is
   * not live has nothing to interrupt.
   */
  async function awaitIdle(sessionId) {
    const agents = services.agents
    if (agents === undefined || typeof sessionId !== 'string' || sessionId === '') return { idle: true, waited: 0 }
    const started = Date.now()
    idleWait = { sessionId, startedAt: started }
    try {
      for (;;) {
        // A newer request supersedes this one; bail out before any bundle moves.
        if (cancelRequested) return { idle: true, waited: Date.now() - started, cancelled: true }
        let open = false
        try {
          const agent = agents.get(sessionId)
          if (agent !== undefined) open = agents.turnBoundaryOf(agent.session).openTurnStartSeq !== null
        } catch {
          open = false
        }
        const waited = Date.now() - started
        if (!open) return { idle: true, waited }
        if (waited >= IDLE_WAIT_MS) return { idle: false, waited }
        await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS))
      }
    } finally {
      idleWait = null
    }
  }

  function state() {
    return store.read()
  }

  /** One-shot WebAuthn handshakes, keyed by the challenge the client must echo back. */
  const challenges = new Map()
  const CHALLENGE_TTL_MS = 120_000

  function pruneChallenges() {
    const now = Date.now()
    for (const [key, record] of challenges) if (record.expiresAt <= now) challenges.delete(key)
  }

  function issueChallenge(kind) {
    pruneChallenges()
    const challenge = createChallenge()
    challenges.set(challenge.value, { kind, expiresAt: challenge.expiresAt })
    return challenge.value
  }

  function takeChallenge(value, kind) {
    const key = String(value ?? '')
    const record = challenges.get(key)
    if (record === undefined) return false
    challenges.delete(key)
    return record.kind === kind && record.expiresAt > Date.now()
  }

  function publicCredential(credential) {
    if (credential === null || credential === undefined) return null
    return { id: credential.id, label: credential.label, createdAt: credential.createdAt }
  }

  /** Listeners told about the persisted mode; the tool row is mounted from here. */
  const modeListeners = new Set()

  function emitMode(mode) {
    for (const listener of [...modeListeners]) {
      try {
        listener(mode)
      } catch (error) {
        log(`mode listener failed: ${messageOf(error)}`)
      }
    }
  }

  /** Subscribe to mode changes; the listener runs once with the current mode. */
  function subscribeMode(listener) {
    modeListeners.add(listener)
    try {
      listener(state().mode)
    } catch (error) {
      log(`mode listener failed: ${messageOf(error)}`)
    }
    return () => modeListeners.delete(listener)
  }

  function actorRecord(actor, origin) {
    return { actor: actor || 'ui', origin: origin || '' }
  }

  function audit(actor, origin, action, detail) {
    return store.audit({ ...actorRecord(actor, origin), action, detail })
  }

  function hiddenSessionIds(current) {
    const ids = unique(current.privateSessions)
    const registry = services.workspaceRegistry
    if (registry === undefined) return ids
    for (const workspaceId of current.privateWorkspaces) {
      const workspace = registry.get(workspaceId)
      if (workspace === undefined) continue
      for (const sessionId of workspace.sessionIds ?? []) ids.push(sessionId)
    }
    return unique(ids)
  }

  function archivedByRegistry() {
    const registry = services.workspaceRegistry
    if (registry === undefined) return []
    const ids = registry.archivedSessionIds
    return Array.isArray(ids) ? ids : []
  }

  /**
   * The desired plugin enablement for one bundle.
   *
   * The rule is deliberately narrow: this plugin only ever changes a bundle it is
   * responsible for — one marked private, or one it deselected itself. Everything
   * else keeps whatever selection the user gave it, so a NORMAL reconciliation can
   * never turn on a bundle the user turned off.
   */
  function desiredBundleEnabled(current, bundle) {
    if (bundle.name === SELF_BUNDLE) return bundle.enabled
    if (current.privateBundles.includes(bundle.name)) return current.mode === 'private'
    if (current.disabledByMode.includes(bundle.name)) return true
    return bundle.enabled
  }

  let bundleCache = { at: 0, value: [] }
  let bundleRefresh = null

  /**
   * `listBundles()` costs seconds in this profile, and the browser half polls the
   * state every few seconds, so a poll never waits for it: the cache answers, and a
   * stale cache refreshes in the background.
   */
  async function bundleSnapshot({ fresh = false } = {}) {
    if (services.pluginManager === undefined) return []
    if (!fresh) {
      if (bundleCache.at === 0) return refreshBundles()
      if (Date.now() - bundleCache.at > BUNDLE_CACHE_MS) void refreshBundles()
      return bundleCache.value
    }
    return refreshBundles()
  }

  /**
   * The answer a poll is allowed to get: whatever is cached, with a refresh started
   * in the background. `listBundles()` is a multi-second call in a loaded profile and
   * a poll must never inherit that latency.
   */
  function bundlesNow() {
    if (services.pluginManager === undefined) return []
    if (bundleCache.at === 0 || Date.now() - bundleCache.at > BUNDLE_CACHE_MS) void refreshBundles()
    return bundleCache.value
  }

  function invalidateBundles() {
    bundleCache = { at: 0, value: [] }
  }

  async function refreshBundles() {
    if (bundleRefresh !== null) return bundleRefresh
    const manager = services.pluginManager
    if (manager === undefined) return []
    bundleRefresh = (async () => {
      try {
        const bundles = await manager.listBundles()
        const value = bundles
          .filter((bundle) => bundle !== null && typeof bundle === 'object')
          .filter((bundle) => bundle.installed !== false && bundle.availability !== 'missing')
          .map((bundle) => ({
            name: bundle.name,
            version: bundle.version ?? '',
            enabled: bundle.enabled === true,
            removable: bundle.removable === true,
            rowCount: Array.isArray(bundle.rows) ? bundle.rows.length : 0,
            title: localized(bundle.meta?.title) || bundle.name,
            self: bundle.name === SELF_BUNDLE,
          }))
        bundleCache = { at: Date.now(), value }
        return value
      } catch (error) {
        log(`bundle listing failed: ${messageOf(error)}`)
        return bundleCache.value
      } finally {
        bundleRefresh = null
      }
    })()
    return bundleRefresh
  }

  function localized(value) {
    if (typeof value === 'string') return value
    if (value !== null && typeof value === 'object') {
      return typeof value['zh-CN'] === 'string' ? value['zh-CN'] : typeof value.en === 'string' ? value.en : ''
    }
    return ''
  }

  function workspaceSnapshot() {
    const registry = services.workspaceRegistry
    if (registry === undefined) return []
    let workspaces = []
    try {
      workspaces = registry.list()
    } catch (error) {
      log(`workspace listing failed: ${messageOf(error)}`)
      return []
    }
    return workspaces.map((workspace) => ({
      id: workspace.id,
      title: workspace.title || workspace.path || workspace.id,
      path: workspace.path ?? '',
      sessionCount: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0,
      sessionIds: Array.isArray(workspace.sessionIds) ? [...workspace.sessionIds] : [],
    }))
  }

  async function sessionSnapshot(current, withTitles = false) {
    const registry = services.workspaceRegistry
    if (registry === undefined) return []
    const byId = new Map()
    for (const workspace of workspaceSnapshot()) {
      for (const sessionId of workspace.sessionIds) {
        byId.set(sessionId, { id: sessionId, workspaceId: workspace.id, workspaceTitle: workspace.title })
      }
    }
    for (const sessionId of current.privateSessions) {
      if (!byId.has(sessionId)) byId.set(sessionId, { id: sessionId, workspaceId: '', workspaceTitle: '' })
    }
    const titles = new Map()
    const query = services.sessionQuery
    if (withTitles && query !== undefined && typeof query.readTitleSnapshots === 'function') {
      const ids = [...byId.keys()]
      const missing = ids.filter((id) => {
        const cached = titleCache.get(id)
        return cached === undefined || Date.now() - cached.at > TITLE_TTL_MS
      })
      const batch = missing.slice(0, TITLE_LIMIT)
      if (batch.length > 0) {
        try {
          const snapshots = await query.readTitleSnapshots(batch)
          for (const snapshot of snapshots ?? []) {
            const id = snapshot?.sessionId ?? snapshot?.id
            const title = snapshot?.title?.title ?? snapshot?.title ?? snapshot?.value?.title
            if (typeof id === 'string') {
              titleCache.set(id, { at: Date.now(), title: typeof title === 'string' ? title : '' })
            }
          }
        } catch (error) {
          log(`session titles unavailable: ${messageOf(error)}`)
        }
        // A read that returned nothing for an id still counts as "asked", so a poll
        // never re-asks for the same rows.
        for (const id of batch) {
          const cached = titleCache.get(id)
          if (cached === undefined || Date.now() - cached.at > TITLE_TTL_MS) {
            titleCache.set(id, { at: Date.now(), title: '' })
          }
        }
      }
    }
    for (const id of byId.keys()) {
      const cached = titleCache.get(id)
      if (cached !== undefined && cached.title !== '') titles.set(id, cached.title)
    }
    const archived = new Set(archivedByRegistry())
    return [...byId.values()].map((entry) => ({
      ...entry,
      title: titles.get(entry.id) ?? entry.id,
      archived: archived.has(entry.id),
    }))
  }

  function classify(privateList, publicList, id) {
    if (privateList.includes(id)) return 'private'
    if (publicList.includes(id)) return 'public'
    return 'unclassified'
  }

  /**
   * Everything the UI needs in one payload; no secrets, no plaintext PIN.
   * Session titles are opt-in because reading them is the one expensive part; the
   * polling surface does not need them, the management list asks once.
   */
  async function snapshot(options = {}) {
    const current = state()
    const withTitles = options.titles === true
    // `wait` is for the management page, which needs the real list on first paint.
    // The polling surface takes the cached answer and lets the refresh land later.
    const bundles = options.wait === true ? await bundleSnapshot() : bundlesNow()
    const sessions = await sessionSnapshot(current, withTitles)
    const workspaces = workspaceSnapshot()
    return {
      mode: current.mode,
      hasPin: current.pin !== null,
      hasCredential: current.credential !== null,
      credential: publicCredential(current.credential),
      /** The classification page is only reachable — and only accepted — in PRIVATE. */
      settingsEditable: current.mode === 'private',
      job: jobSummary(),
      bundlesReady: bundleCache.at !== 0,
      requirePin: config.requirePin === true,
      unlocked: current.mode === 'private' && (current.pin === null || unlockedAt > 0),
      config: {
        presets,
        keepPrivateAcrossRestart: config.keepPrivateAcrossRestart === true,
        hideWorkspaceRows: config.hideWorkspaceRows !== false,
        adoptDefaultPreset: config.adoptDefaultPreset === true,
      },
      sets: {
        privateBundles: current.privateBundles,
        publicBundles: current.publicBundles,
        privateWorkspaces: current.privateWorkspaces,
        publicWorkspaces: current.publicWorkspaces,
        privateSessions: current.privateSessions,
        publicSessions: current.publicSessions,
      },
      bundles: bundles.map((bundle) => ({
        ...bundle,
        classification: classify(current.privateBundles, current.publicBundles, bundle.name),
      })),
      workspaces: workspaces.map((workspace) => ({
        ...workspace,
        classification: classify(current.privateWorkspaces, current.publicWorkspaces, workspace.id),
      })),
      sessions: sessions.map((session) => ({
        ...session,
        classification: classify(current.privateSessions, current.publicSessions, session.id),
      })),
      archived: current.archived,
      auditPath: store.auditPath,
      statePath: store.statePath,
      lastError,
    }
  }

  /**
   * Reconcile the profile with the stored mode. Idempotent: it applies only the
   * differences, and rolls back the bundle selections it changed when a later
   * step fails. Used by a switch, by a marking change, and by a cold start.
   */
  async function reconcile({ actor = 'system', origin = '', reason = 'reconcile', sessionId } = {}) {
    const current = state()
    const manager = services.pluginManager
    const registry = services.workspaceRegistry
    const applied = []
    const archivedNow = []
    const unarchived = []
    const problems = []
    const next = { ...current }
    // Timing is diagnostic, not decoration: a profile reload per bundle is the one
    // step that can make a switch feel like a hang.
    const startedAt = Date.now()
    const timings = []
    // A bundle toggle disposes live agents, so the calling session gets to finish its
    // turn first. Bounded: a long agent run must not park the queue forever.
    const idle = await awaitIdle(sessionId)
    if (idle.waited > 0) timings.push({ step: 'await-idle', ms: idle.waited })
    if (idle.cancelled === true) {
      // Nothing was toggled yet, so a superseding request can take over cleanly.
      return { ok: false, cancelled: true, error: 'superseded', mode: current.mode, problems: [], timings }
    }

    try {
      if (manager !== undefined) {
        const listingAt = Date.now()
        const bundles = await bundleSnapshot({ fresh: true })
        timings.push({ step: 'listBundles', ms: Date.now() - listingAt })
        let disabledByMode = [...current.disabledByMode]
        for (const bundle of bundles) {
          const want = desiredBundleEnabled(current, bundle)
          if (want === bundle.enabled) continue
          const stepAt = Date.now()
          const result = await manager.setBundleEnabled(bundle.name, want)
          timings.push({ step: `${want ? 'enable' : 'disable'}:${bundle.name}`, ms: Date.now() - stepAt })
          const application = result?.application ?? 'unknown'
          applied.push({ name: bundle.name, to: want, application })
          if (application === 'failed' || application === 'cancelled') {
            throw new Error(`bundle "${bundle.name}" ${want ? 'enable' : 'disable'} ${application}`)
          }
          if (application === 'restart-required') {
            problems.push(`${bundle.name}: saved, needs a restart (${result.restartReason ?? 'unknown'})`)
          }
          disabledByMode = want ? without(disabledByMode, bundle.name) : push(disabledByMode, bundle.name)
        }
        next.disabledByMode = disabledByMode
        // Refill the cache from the listing that was just read plus the toggles that
        // were just applied. Invalidating here would make the immediate state read
        // pay a second multi-second `listBundles()` for information already in hand.
        if (applied.length > 0) {
          const toggled = new Map(applied.map((item) => [item.name, item.to]))
          bundleCache = {
            at: Date.now(),
            value: bundleCache.value.map((bundle) => toggled.has(bundle.name)
              ? { ...bundle, enabled: toggled.get(bundle.name) }
              : bundle),
          }
        }
      } else {
        problems.push('pluginManager is unavailable, so no plugin was switched')
      }

      if (registry !== undefined) {
        const hidden = hiddenSessionIds(current)
        const already = new Set(archivedByRegistry())
        // Records we created are ours to restore. A session the user archived by hand
        // is remembered only so a later switch does not try to restore it.
        const owned = current.archived.filter((record) => record.reason !== 'already-archived')
        const foreign = current.archived.filter((record) => record.reason === 'already-archived')

        if (current.mode === 'private') {
          for (const record of owned) {
            try {
              if (already.has(record.sessionId)) await registry.unarchiveSession(record.sessionId)
              unarchived.push(record.sessionId)
            } catch (error) {
              problems.push(`unarchive ${record.sessionId}: ${messageOf(error)}`)
            }
          }
          next.archived = []
        } else {
          const keep = foreign.filter((record) => hidden.includes(record.sessionId))
          // A marking that was removed while NORMAL must give the session back.
          for (const record of owned) {
            if (hidden.includes(record.sessionId)) {
              keep.push(record)
              continue
            }
            try {
              if (already.has(record.sessionId)) await registry.unarchiveSession(record.sessionId)
              unarchived.push(record.sessionId)
            } catch (error) {
              problems.push(`restore ${record.sessionId}: ${messageOf(error)}`)
            }
          }
          for (const sessionId of hidden) {
            if (keep.some((record) => record.sessionId === sessionId)) continue
            if (already.has(sessionId)) {
              keep.push({ sessionId, archivedAt: new Date().toISOString(), reason: 'already-archived' })
              continue
            }
            const stepAt = Date.now()
            try {
              await registry.archiveSession(sessionId)
              keep.push({ sessionId, archivedAt: new Date().toISOString(), reason: 'private' })
              archivedNow.push(sessionId)
            } catch (error) {
              problems.push(`archive ${sessionId}: ${messageOf(error)}`)
            }
            timings.push({ step: `archive:${sessionId}`, ms: Date.now() - stepAt })
          }
          next.archived = keep
        }
      } else {
        problems.push('workspaceRegistry is unavailable, so no session was archived')
      }

      store.write(next)
      emitMode(next.mode)
      timings.push({ step: 'total', ms: Date.now() - startedAt })
      audit(actor, origin, reason, {
        mode: next.mode,
        bundles: applied,
        archived: archivedNow,
        unarchived,
        problems,
        timings,
        ...idle.waited > 0 ? { idle } : {},
      })
      lastError = problems.length === 0 ? '' : problems.join('; ')
      return { ok: true, mode: next.mode, bundles: applied, archived: archivedNow, unarchived, problems, timings }
    } catch (error) {
      for (const step of [...applied].reverse()) {
        try {
          await services.pluginManager.setBundleEnabled(step.name, !step.to)
        } catch (rollbackError) {
          problems.push(`rollback ${step.name}: ${messageOf(rollbackError)}`)
        }
      }
      for (const sessionId of archivedNow) {
        try {
          await registry.unarchiveSession(sessionId)
        } catch (rollbackError) {
          problems.push(`rollback unarchive ${sessionId}: ${messageOf(rollbackError)}`)
        }
      }
      for (const sessionId of unarchived) {
        try {
          await registry.archiveSession(sessionId)
        } catch (rollbackError) {
          problems.push(`rollback archive ${sessionId}: ${messageOf(rollbackError)}`)
        }
      }
      store.write(current)
      emitMode(current.mode)
      lastError = messageOf(error)
      audit(actor, origin, `${reason}-failed`, { error: lastError, problems })
      return { ok: false, rolledBack: true, mode: current.mode, error: lastError, problems }
    }
  }

  /** Create or reuse the one-shot session that carries a mode into a started conversation. */
  async function openTempSession(target, sessionId) {
    const controller = services.sessionController
    const agents = services.agents
    if (controller === undefined || agents === undefined) return { skipped: 'no agent services' }
    if (typeof sessionId !== 'string' || sessionId === '') return { skipped: 'no session' }
    let agent
    try {
      agent = agents.get(sessionId)
    } catch {
      agent = undefined
    }
    if (agent === undefined) return { skipped: 'session is not live' }

    let started = false
    try {
      const boundary = agents.turnBoundaryOf(agent.session)
      started = boundary.openTurnStartSeq !== null || boundary.lastTurn > 0
    } catch {
      started = false
    }
    const presetId = target === 'private' ? presets.private : presets.normal

    if (!started) {
      try {
        const applied = await services.agentPresets?.select(agent, presetId)
        return { selectedPreset: applied ?? presetId }
      } catch (error) {
        return { skipped: `preset select refused: ${messageOf(error)}` }
      }
    }

    let cwd
    try {
      cwd = services.workingDirectory?.get(agent.session)
    } catch {
      cwd = undefined
    }
    try {
      const created = await controller.create({ cwd, agentPreset: presetId })
      const tempSessionId = created?.sessionId
      if (typeof tempSessionId !== 'string') return { skipped: 'create returned no session id' }
      const current = state()
      const previous = current.tempSessions.filter((id) => id !== tempSessionId)
      for (const stale of previous) {
        try {
          await services.workspaceRegistry?.archiveSession(stale)
        } catch (error) {
          log(`temp session ${stale} not archived: ${messageOf(error)}`)
        }
      }
      store.write({ ...current, tempSessions: [tempSessionId] })
      return { tempSessionId, archivedPrevious: previous }
    } catch (error) {
      return { skipped: `temp session failed: ${messageOf(error)}` }
    }
  }

  /**
   * Switch the profile-wide mode. `pin` is required to enter PRIVATE when a PIN is
   * stored and `requirePin` is on; leaving never asks, because leaving is what
   * hides things again.
   */
  async function switchTo(target, { pin, sessionId, actor = 'ui', origin = '', unlocked = false } = {}) {
    if (target !== 'normal' && target !== 'private') return { ok: false, error: `unknown mode "${target}"` }
    const current = state()
    if (target === 'private' && config.requirePin === true && current.pin !== null && unlocked !== true) {
      if (!verifyPin(String(pin ?? ''), current.pin)) {
        audit(actor, origin, 'switch-rejected', { target, reason: 'pin' })
        return { ok: false, error: 'pin-mismatch' }
      }
      unlockedAt = Date.now()
    }
    // No `busy` latch here on purpose: the job queue is what serializes switches, and a
    // latch set by a job whose promise a recomposition orphaned would refuse every
    // later switch — the same dead end the exit button had.
    store.write({ ...current, mode: target })
    const result = await reconcile({ actor, origin, reason: `switch-${target}`, sessionId })
    if (!result.ok) {
      store.write({ ...state(), mode: current.mode })
      return result
    }
    // A mode with a PIN never survives a restart unlocked unless asked to.
    if (target === 'private') unlockedAt = Date.now()
    else unlockedAt = 0
    const temp = await openTempSession(target, sessionId)
    return { ...result, ...temp }
  }

  /**
   * The job that is still going to do something, or null. A job that has been
   * "running" for longer than any switch can take is abandoned first: an exit button
   * must never be blocked forever by a promise a recomposition orphaned.
   */
  function pendingJob() {
    if (job === null) return null
    if (job.status === 'running' && jobStale(job)) {
      abandonStaleJob()
      return null
    }
    return job.status === 'queued' || job.status === 'running' ? job : null
  }

  /**
   * Accept a switch and return before it runs.
   *
   * The route answers 202 and the browser poll sees the result, because the switch
   * itself recomposes the profile: doing that under a live request is what aborted
   * the caller's own tool call in the first place. The PIN is still checked here, on
   * the request path, so a wrong PIN never becomes a queued job.
   *
   * A request that arrives while another job runs is queued (and the running one is
   * asked to stand down before it touches a bundle) instead of being refused: a
   * refusal left the user clicking a button that could never do anything.
   */
  function requestSwitch(target, { pin, sessionId, actor = 'ui', origin = '', unlocked = false } = {}) {
    if (target !== 'normal' && target !== 'private') return { ok: false, error: `unknown mode "${target}"` }
    const pending = pendingJob()
    if (pending !== null && pending.kind === `switch-${target}`) {
      return { ok: true, accepted: true, duplicate: true, job: jobSummary() }
    }
    const current = state()
    if (target === 'private' && config.requirePin === true && current.pin !== null && unlocked !== true) {
      if (!verifyPin(String(pin ?? ''), current.pin)) {
        audit(actor, origin, 'switch-rejected', { target, reason: 'pin' })
        return { ok: false, error: 'pin-mismatch' }
      }
    }
    const accepted = scheduleJob(`switch-${target}`, () => switchTo(target, { pin, sessionId, actor, origin, unlocked }))
    // Ask the job ahead of us to stop at its idle wait; scheduling it first means a
    // task that starts immediately clears the flag again.
    if (pending !== null) cancelRequested = true
    return { ok: true, accepted: true, queued: pending !== null, mode: target, job: accepted }
  }

  /** Accept a reconcile (a marking change, a manual retry) without waiting for it. */
  function requestReconcile({ reason = 'mark', sessionId, actor = 'ui', origin = '' } = {}) {
    const pending = pendingJob()
    const accepted = scheduleJob(reason, () => reconcile({ actor, origin, reason, sessionId }))
    if (pending !== null) cancelRequested = true
    return { ok: true, accepted: true, queued: pending !== null, job: accepted }
  }

  function mark(kind, id, classification, { actor = 'ui', origin = '' } = {}) {
    if (!CLASSIFICATIONS.has(classification)) return { ok: false, error: `unknown classification "${classification}"` }
    if (typeof id !== 'string' || id === '') return { ok: false, error: 'missing id' }
    if (kind === 'bundle' && id === SELF_BUNDLE) return { ok: false, error: 'this bundle cannot be marked private' }
    const current = state()
    const next = { ...current }
    const pairs = {
      bundle: ['privateBundles', 'publicBundles'],
      workspace: ['privateWorkspaces', 'publicWorkspaces'],
      session: ['privateSessions', 'publicSessions'],
    }
    const pair = pairs[kind]
    if (pair === undefined) return { ok: false, error: `unknown kind "${kind}"` }
    const [privateKey, publicKey] = pair
    next[privateKey] = without(current[privateKey], id)
    next[publicKey] = without(current[publicKey], id)
    if (classification === 'private') next[privateKey] = push(next[privateKey], id)
    if (classification === 'public') next[publicKey] = push(next[publicKey], id)
    store.write(next)
    audit(actor, origin, 'mark', { kind, id, classification })
    return { ok: true }
  }

  /**
   * Recovering a forgotten password.
   *
   * The authority is the computer itself: a platform-authenticator gesture
   * (Windows Hello, which accepts the PC PIN or a fingerprint) either matches the
   * registered credential or registers one on the spot. A successful gesture issues
   * a single-use token that lets the caller replace the password without the old
   * one. Nothing here weakens the normal path: without a gesture there is no token.
   */
  const recoveryTokens = new Map()
  const RECOVERY_TTL_MS = 5 * 60_000

  function issueRecovery() {
    const now = Date.now()
    for (const [token, expiresAt] of recoveryTokens) if (expiresAt <= now) recoveryTokens.delete(token)
    const token = createChallenge().value
    recoveryTokens.set(token, now + RECOVERY_TTL_MS)
    return token
  }

  function consumeRecovery(token) {
    const key = String(token ?? '')
    if (key === '') return false
    const expiresAt = recoveryTokens.get(key)
    if (expiresAt === undefined) return false
    recoveryTokens.delete(key)
    return expiresAt > Date.now()
  }

  function setPin(pin, { confirm, currentPin, recovery, actor = 'ui', origin = '' } = {}) {
    const current = state()
    const recovered = current.pin !== null && consumeRecovery(recovery)
    if (current.pin !== null && !recovered && !verifyPin(String(currentPin ?? ''), current.pin)) {
      return { ok: false, error: 'current-pin-mismatch' }
    }
    const text = typeof pin === 'string' ? pin : ''
    if (text.length < 4) return { ok: false, error: 'pin-too-short' }
    // The confirmation is checked here as well as in the form: a second field the
    // server ignores is a field that can be dropped by any caller.
    if (confirm !== undefined && String(confirm) !== text) return { ok: false, error: 'pin-confirm-mismatch' }
    store.write({ ...current, pin: hashPin(text) })
    audit(actor, origin, recovered ? 'pin-recovered' : 'pin-set', { algorithm: 'scrypt', ...recovered ? { via: 'platform-authenticator' } : {} })
    return { ok: true, recovered }
  }

  function clearPin({ currentPin, actor = 'ui', origin = '' } = {}) {
    const current = state()
    if (current.pin !== null && !verifyPin(String(currentPin ?? ''), current.pin)) {
      return { ok: false, error: 'current-pin-mismatch' }
    }
    store.write({ ...current, pin: null })
    audit(actor, origin, 'pin-cleared', {})
    return { ok: true }
  }

  /**
   * Classify many items in one write.
   *
   * A per-item loop over `/mark` would queue one reconcile per item, and the queue
   * refuses a second job — so a "set all" button would silently do nothing after the
   * first item. This applies the whole set, writes once, audits once, and leaves the
   * single reconcile to the caller.
   */
  function markMany(items, { actor = 'ui', origin = '' } = {}) {
    if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'nothing-to-apply' }
    if (items.length > 1000) return { ok: false, error: 'too-many-items' }
    const pairs = {
      bundle: ['privateBundles', 'publicBundles'],
      workspace: ['privateWorkspaces', 'publicWorkspaces'],
      session: ['privateSessions', 'publicSessions'],
    }
    const next = { ...state() }
    const counts = { private: 0, public: 0, unclassified: 0 }
    let applied = 0
    for (const item of items) {
      const pair = pairs[item?.kind]
      if (pair === undefined) continue
      const id = typeof item?.id === 'string' ? item.id : ''
      if (id === '') continue
      if (item.kind === 'bundle' && id === SELF_BUNDLE) continue
      const classification = CLASSIFICATIONS.has(item.classification) ? item.classification : 'unclassified'
      const [privateKey, publicKey] = pair
      next[privateKey] = without(next[privateKey], id)
      next[publicKey] = without(next[publicKey], id)
      if (classification === 'private') {
        next[privateKey] = push(next[privateKey], id)
        counts.private += 1
      } else if (classification === 'public') {
        next[publicKey] = push(next[publicKey], id)
        counts.public += 1
      } else {
        counts.unclassified += 1
      }
      applied += 1
    }
    if (applied === 0) return { ok: false, error: 'nothing-to-apply' }
    store.write(next)
    audit(actor, origin, 'mark-bulk', { applied, ...counts })
    return { ok: true, applied, counts }
  }

  /**
   * Fingerprint / passkey unlock.
   *
   * The fingerprint never reaches the Host: the browser asks the platform
   * authenticator for an assertion, and `lib/webauthn.js` checks it against the
   * public key stored at registration time. A verified assertion unlocks the same
   * front lock the PIN opens, then queues the PRIVATE switch like any other request.
   */
  function beginRegistration() {
    return {
      challenge: issueChallenge('register'),
      user: { name: 'dsh-privacy-mode', displayName: 'DSH 隐私模式' },
      rp: { name: 'DeepSeek Harness' },
    }
  }

  function finishRegistration({
    challenge, clientDataJSON, attestationObject, host, purpose,
    actor = 'ui', origin = '',
  } = {}) {
    if (!takeChallenge(challenge, 'register')) return { ok: false, error: 'challenge-expired' }
    let parsed
    try {
      parsed = verifyRegistration({ attestationObject, clientDataJSON, challenge, host })
    } catch (error) {
      audit(actor, origin, 'credential-rejected', { reason: messageOf(error) })
      return { ok: false, error: messageOf(error) }
    }
    const credential = { ...parsed, createdAt: new Date().toISOString(), label: 'platform' }
    store.write({ ...state(), credential })
    audit(actor, origin, 'credential-set', { id: `${String(credential.id).slice(0, 12)}…` })
    // The gesture that registered the credential is the same PC-PIN check that
    // recovery asks for, so it may authorize a password reset.
    if (purpose === 'recover') return { ok: true, credential: publicCredential(credential), recovery: issueRecovery() }
    return { ok: true, credential: publicCredential(credential) }
  }

  function beginAssertion() {
    const current = state()
    if (current.credential === null) return { ok: false, error: 'no-credential' }
    return {
      ok: true,
      challenge: issueChallenge('assert'),
      allowCredentials: [{ type: 'public-key', id: current.credential.id }],
    }
  }

  function finishAssertion({
    challenge, clientDataJSON, authenticatorData, signature, host, purpose,
    actor = 'ui', origin = '', sessionId,
  } = {}) {
    const current = state()
    if (current.credential === null) return { ok: false, error: 'no-credential' }
    if (!takeChallenge(challenge, 'assert')) return { ok: false, error: 'challenge-expired' }
    let signCount
    try {
      ({ signCount } = verifyAssertion({
        credential: current.credential,
        authenticatorData,
        clientDataJSON,
        signature,
        challenge,
        host,
      }))
    } catch (error) {
      audit(actor, origin, purpose === 'recover' ? 'recover-rejected' : 'unlock-rejected', { reason: messageOf(error) })
      return { ok: false, error: messageOf(error) }
    }
    store.write({ ...current, credential: { ...current.credential, signCount } })
    if (purpose === 'recover') {
      audit(actor, origin, 'recover-verified', {})
      return { ok: true, recovery: issueRecovery() }
    }
    unlockedAt = Date.now()
    audit(actor, origin, 'unlock-credential', {})
    return { ...requestSwitch('private', { actor, origin, sessionId, unlocked: true }), unlocked: true }
  }

  /**
   * A bundle installed now belongs to the mode it was installed in: installed in
   * PRIVATE it is a private plugin (and disappears when the profile returns to
   * NORMAL), installed in NORMAL it is an ordinary one. No bundle is toggled here —
   * the classification only changes what a later switch does.
   */
  function classifyInstalled(name) {
    if (typeof name !== 'string' || name.trim() === '' || name === SELF_BUNDLE) {
      return { ok: false, error: 'not-classifiable' }
    }
    const current = state()
    const classification = current.mode === 'private' ? 'private' : 'public'
    const key = classification === 'private' ? 'privateBundles' : 'publicBundles'
    const otherKey = classification === 'private' ? 'publicBundles' : 'privateBundles'
    if (current[key].includes(name)) return { ok: true, classification, unchanged: true }
    const next = {
      ...current,
      [key]: push(current[key], name),
      [otherKey]: without(current[otherKey], name),
    }
    store.write(next)
    audit('system', 'install', 'install-classified', { bundle: name, classification })
    return { ok: true, classification }
  }

  function clearCredential({ actor = 'ui', origin = '' } = {}) {
    const current = state()
    if (current.credential === null) return { ok: false, error: 'no-credential' }
    store.write({ ...current, credential: null })
    audit(actor, origin, 'credential-cleared', {})
    return { ok: true }
  }

  /**
   * Read-only self-description for the acceptance checks: whether each mode preset
   * composed, and what the mode currently owns. Never mutates anything.
   */
  async function diagnostics() {
    const current = state()
    const registry = services.agentPresets
    const presetReport = []
    for (const [mode, id] of Object.entries(presets)) {
      const entry = { mode, id, broken: '', found: false }
      if (registry === undefined) {
        entry.broken = 'agentPresets is unavailable'
        presetReport.push(entry)
        continue
      }
      try {
        const resolved = await registry.resolve(id)
        entry.found = true
        entry.broken = typeof resolved?.broken === 'string' ? resolved.broken : ''
      } catch (error) {
        entry.broken = messageOf(error)
      }
      presetReport.push(entry)
    }
    return {
      mode: current.mode,
      presets: presetReport,
      marked: {
        privateBundles: current.privateBundles,
        privateWorkspaces: current.privateWorkspaces,
        privateSessions: current.privateSessions,
        disabledByMode: current.disabledByMode,
      },
      archived: current.archived.length,
      hasPin: current.pin !== null,
      hasCredential: current.credential !== null,
      statePath: store.statePath,
      auditPath: store.auditPath,
      lastError,
    }
  }

  /**
   * Cold start: a profile that was left in PRIVATE comes back NORMAL when a PIN
   * guards it, because an unlocked private profile after a restart is a leak, not
   * a convenience. `keepPrivateAcrossRestart` opts out.
   */
  async function bootstrap() {
    const current = state()
    if (current.mode === 'private' && current.pin !== null && config.keepPrivateAcrossRestart !== true) {
      store.write({ ...current, mode: 'normal' })
      audit('system', 'boot', 'boot-relock', { from: 'private', reason: 'pin-guarded-private-does-not-survive-restart' })
    }
    unlockedAt = 0
    return reconcile({ actor: 'system', origin: 'boot', reason: 'boot' })
  }

  return {
    state,
    snapshot,
    reconcile,
    switchTo,
    requestSwitch,
    requestReconcile,
    job: jobSummary,
    mark,
    markMany,
    setPin,
    clearPin,
    beginRegistration,
    finishRegistration,
    beginAssertion,
    finishAssertion,
    clearCredential,
    classifyInstalled,
    /** Whether entering PRIVATE has a lock at all. */
    requiresPin: () => config.requirePin === true,
    subscribeMode,
    bootstrap,
    diagnostics,
    invalidateBundles,
    auditTail: (limit) => store.auditTail(limit),
    auditPath: store.auditPath,
    statePath: store.statePath,
    hiddenSessionIds,
    bundleSnapshot,
    workspaceSnapshot,
  }
}
