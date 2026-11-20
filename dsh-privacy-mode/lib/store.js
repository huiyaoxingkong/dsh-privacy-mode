/**
 * Durable state and the audit log for the privacy bundle.
 *
 * Nothing here talks to DSH: it is a small, dependency-free store so the mode
 * state survives a cold start even when a Host service it would prefer is
 * missing. Writes are atomic (temp file + rename) because a half-written state
 * file would lose the set of items a switch has to restore.
 *
 * The PIN is stored as a scrypt derivation with a per-PIN salt. The plain PIN
 * lives only in the browser request that carries it.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const STATE_VERSION = 1

/** scrypt cost. Kept explicit in the record so a later change stays verifiable. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }

/** `$DSH_HOME`, or the default location when the Host did not export it. */
export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function defaultDataDir() {
  return path.join(dshHome(), 'privacy-mode')
}

export function emptyState(defaultMode = 'normal') {
  return {
    version: STATE_VERSION,
    mode: defaultMode,
    pin: null,
    // A platform-authenticator credential (fingerprint / passkey) that may unlock
    // PRIVATE instead of the PIN. Holds only the public key and the credential id.
    credential: null,
    privateBundles: [],
    publicBundles: [],
    privateWorkspaces: [],
    publicWorkspaces: [],
    privateSessions: [],
    publicSessions: [],
    // Sessions this bundle archived, so a switch back restores exactly these and
    // never unarchives something the user archived by hand.
    archived: [],
    // Bundles this bundle itself deselected. Re-enabling is limited to these, so a
    // bundle the user turned off is never turned on by a reconciliation.
    disabledByMode: [],
    // One-shot sessions created to carry a mode into a started conversation.
    tempSessions: [],
    updatedAt: new Date().toISOString(),
  }
}

function asStringList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function asArchived(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    if (typeof item.sessionId !== 'string' || item.sessionId === '') continue
    out.push({
      sessionId: item.sessionId,
      archivedAt: typeof item.archivedAt === 'string' ? item.archivedAt : new Date().toISOString(),
      reason: typeof item.reason === 'string' ? item.reason : 'private-session',
    })
  }
  return out
}

/** Accept only the fields this version understands, with their declared types. */
export function normalizeState(raw, defaultMode = 'normal') {
  const base = emptyState(defaultMode)
  if (raw === null || typeof raw !== 'object') return base
  const mode = raw.mode === 'private' ? 'private' : raw.mode === 'normal' ? 'normal' : base.mode
  return {
    version: STATE_VERSION,
    mode,
    pin: isPinRecord(raw.pin) ? raw.pin : null,
    credential: isCredential(raw.credential) ? {
      id: raw.credential.id,
      publicKey: { kty: 'EC', crv: 'P-256', x: raw.credential.publicKey.x, y: raw.credential.publicKey.y },
      signCount: Number.isFinite(raw.credential.signCount) ? raw.credential.signCount : 0,
      createdAt: typeof raw.credential.createdAt === 'string' ? raw.credential.createdAt : new Date().toISOString(),
      label: typeof raw.credential.label === 'string' && raw.credential.label !== '' ? raw.credential.label : 'platform',
    } : null,
    privateBundles: asStringList(raw.privateBundles),
    publicBundles: asStringList(raw.publicBundles),
    privateWorkspaces: asStringList(raw.privateWorkspaces),
    publicWorkspaces: asStringList(raw.publicWorkspaces),
    privateSessions: asStringList(raw.privateSessions),
    publicSessions: asStringList(raw.publicSessions),
    archived: asArchived(raw.archived),
    disabledByMode: asStringList(raw.disabledByMode),
    tempSessions: asStringList(raw.tempSessions),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
  }
}

function isPinRecord(value) {
  if (value === null || typeof value !== 'object') return false
  return (
    value.algo === 'scrypt' &&
    typeof value.salt === 'string' &&
    value.salt !== '' &&
    typeof value.hash === 'string' &&
    value.hash !== '' &&
    typeof value.N === 'number' &&
    typeof value.r === 'number' &&
    typeof value.p === 'number'
  )
}

/** A stored WebAuthn credential: an id plus the ES256 public key it signs with. */
function isCredential(value) {
  if (value === null || typeof value !== 'object') return false
  const key = value.publicKey
  return (
    typeof value.id === 'string' &&
    value.id !== '' &&
    key !== null &&
    typeof key === 'object' &&
    key.kty === 'EC' &&
    typeof key.x === 'string' &&
    key.x !== '' &&
    typeof key.y === 'string' &&
    key.y !== ''
  )
}

export function hashPin(pin) {
  const salt = randomBytes(16)
  const keylen = SCRYPT.keylen
  const hash = scryptSync(String(pin), salt, keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 256 * SCRYPT.N * SCRYPT.r,
  })
  return {
    algo: 'scrypt',
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    keylen,
    updatedAt: new Date().toISOString(),
  }
}

export function verifyPin(pin, record) {
  if (!isPinRecord(record)) return false
  if (typeof pin !== 'string' || pin === '') return false
  const expected = Buffer.from(record.hash, 'hex')
  if (expected.length === 0) return false
  const actual = scryptSync(pin, Buffer.from(record.salt, 'hex'), expected.length, {
    N: record.N,
    r: record.r,
    p: record.p,
    maxmem: 256 * record.N * record.r,
  })
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export class PrivacyStore {
  constructor(options = {}) {
    this.dir = options.dir ?? defaultDataDir()
    this.defaultMode = options.defaultMode === 'private' ? 'private' : 'normal'
    this.auditMaxBytes = Number.isFinite(options.auditMaxBytes) ? options.auditMaxBytes : 512 * 1024
    this.log = options.log ?? (() => {})
  }

  get statePath() {
    return path.join(this.dir, 'state.json')
  }

  get auditPath() {
    return path.join(this.dir, 'audit.log')
  }

  ensureDir() {
    mkdirSync(this.dir, { recursive: true })
    return this.dir
  }

  /** Read the state, keeping an unreadable file aside instead of discarding it. */
  read() {
    try {
      if (!existsSync(this.statePath)) return emptyState(this.defaultMode)
      const raw = readFileSync(this.statePath, 'utf8')
      if (raw.trim() === '') return emptyState(this.defaultMode)
      return normalizeState(JSON.parse(raw), this.defaultMode)
    } catch (error) {
      try {
        const aside = `${this.statePath}.corrupt-${Date.now()}`
        renameSync(this.statePath, aside)
        this.log(`state file was unreadable and was kept at ${aside}: ${String(error)}`)
      } catch {
        // Nothing else to do: an unreadable state still yields a usable default.
      }
      return emptyState(this.defaultMode)
    }
  }

  write(state) {
    this.ensureDir()
    const next = normalizeState({ ...state, updatedAt: new Date().toISOString() }, this.defaultMode)
    const tmp = `${this.statePath}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    renameSync(tmp, this.statePath)
    return next
  }

  /**
   * Append one audit record. The log is local and bounded: when it passes the
   * limit it is rotated once, so a long-lived profile cannot grow it forever.
   */
  audit(entry) {
    this.ensureDir()
    const record = {
      at: new Date().toISOString(),
      actor: typeof entry.actor === 'string' && entry.actor !== '' ? entry.actor : 'ui',
      origin: typeof entry.origin === 'string' ? entry.origin : '',
      action: typeof entry.action === 'string' ? entry.action : 'unknown',
      detail: entry.detail ?? {},
    }
    try {
      if (existsSync(this.auditPath) && statSync(this.auditPath).size > this.auditMaxBytes) {
        try {
          unlinkSync(`${this.auditPath}.1`)
        } catch {
          // A missing previous rotation is the normal case.
        }
        renameSync(this.auditPath, `${this.auditPath}.1`)
      }
      appendFileSync(this.auditPath, `${JSON.stringify(record)}\n`, 'utf8')
    } catch (error) {
      this.log(`audit append failed: ${String(error)}`)
    }
    return record
  }

  auditTail(limit = 40) {
    try {
      if (!existsSync(this.auditPath)) return []
      const lines = readFileSync(this.auditPath, 'utf8').split('\n').filter((line) => line.trim() !== '')
      const tail = lines.slice(Math.max(0, lines.length - limit))
      return tail
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return { at: '', actor: 'ui', action: 'unreadable', detail: { line } }
          }
        })
        .reverse()
    } catch {
      return []
    }
  }
}
