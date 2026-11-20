/**
 * WebAuthn verification for the front lock.
 *
 * The browser half may unlock PRIVATE with a platform authenticator (Windows Hello,
 * Touch ID) instead of the PIN. The client is not trusted to say "the fingerprint
 * matched": it hands over the authenticator's own assertion and this module checks
 * it against the public key stored at registration time.
 *
 * What is verified, and why each check earns its place:
 *
 *  - `clientDataJSON.type` — a registration answer cannot be replayed as an unlock.
 *  - `clientDataJSON.challenge` — the caller answered *this* handshake, so an
 *    assertion captured earlier is worthless.
 *  - `clientDataJSON.origin` must be the origin that is serving the request, so the
 *    answer came from this page and not from another site that borrowed the key.
 *  - `rpIdHash` in the authenticator data must be SHA-256 of that origin's host,
 *    which is what binds the credential to this RP rather than to any origin.
 *  - the user-presence and user-verification flags, because a "fingerprint" unlock
 *    that skipped the fingerprint is not an unlock.
 *  - the ECDSA signature over `authenticatorData || SHA-256(clientDataJSON)` with
 *    the stored ES256 key.
 *
 * Only ES256 P-256 credentials are accepted: that is what platform authenticators
 * produce, and narrowing the accepted algorithms keeps the parser small.
 */
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_AT = 0x40

const CHALLENGE_TTL_MS = 120_000

export function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

export function fromBase64Url(text) {
  const normalized = String(text).replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64')
}

/**
 * Minimal CBOR reader: the attestation object and the COSE key inside the
 * authenticator data are the only CBOR this bundle ever sees. Definite lengths
 * only — that is what browsers and authenticators emit here.
 * @param {Buffer} buffer source
 * @param {number} offset first byte
 * @returns {{ value: unknown, offset: number }} decoded value and the next offset
 */
export function readCbor(buffer, offset) {
  if (offset >= buffer.length) throw new Error('CBOR ended unexpectedly')
  const initial = buffer[offset]
  const major = initial >> 5
  const info = initial & 0x1f
  let cursor = offset + 1
  let length = info
  if (info === 24) {
    length = buffer[cursor]
    cursor += 1
  } else if (info === 25) {
    length = buffer.readUInt16BE(cursor)
    cursor += 2
  } else if (info === 26) {
    length = buffer.readUInt32BE(cursor)
    cursor += 4
  } else if (info === 27) {
    length = Number(buffer.readBigUInt64BE(cursor))
    cursor += 8
  } else if (info === 31) {
    throw new Error('indefinite-length CBOR is not supported')
  }
  switch (major) {
    case 0:
      return { value: length, offset: cursor }
    case 1:
      return { value: -1 - length, offset: cursor }
    case 2: {
      const end = cursor + length
      if (end > buffer.length) throw new Error('CBOR byte string is truncated')
      return { value: buffer.subarray(cursor, end), offset: end }
    }
    case 3: {
      const end = cursor + length
      if (end > buffer.length) throw new Error('CBOR text is truncated')
      return { value: buffer.subarray(cursor, end).toString('utf8'), offset: end }
    }
    case 4: {
      const items = []
      for (let index = 0; index < length; index += 1) {
        const item = readCbor(buffer, cursor)
        items.push(item.value)
        cursor = item.offset
      }
      return { value: items, offset: cursor }
    }
    case 5: {
      const map = new Map()
      for (let index = 0; index < length; index += 1) {
        const key = readCbor(buffer, cursor)
        const value = readCbor(buffer, key.offset)
        map.set(key.value, value.value)
        cursor = value.offset
      }
      return { value: map, offset: cursor }
    }
    case 6: {
      // Tags carry no meaning for the fields read here.
      return readCbor(buffer, cursor)
    }
    case 7: {
      if (info === 20) return { value: false, offset: cursor }
      if (info === 21) return { value: true, offset: cursor }
      if (info === 22) return { value: null, offset: cursor }
      throw new Error(`unsupported CBOR simple value ${info}`)
    }
    default:
      throw new Error(`unsupported CBOR major type ${major}`)
  }
}

function coseToJwk(cose) {
  if (!(cose instanceof Map)) throw new Error('the credential public key is not a COSE map')
  const kty = cose.get(1)
  const alg = cose.get(3)
  const crv = cose.get(-1)
  if (kty !== 2 || alg !== -7 || crv !== 1) throw new Error('only ES256 P-256 credentials are supported')
  const x = cose.get(-2)
  const y = cose.get(-3)
  if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y)) throw new Error('the credential public key is malformed')
  return { kty: 'EC', crv: 'P-256', x: toBase64Url(x), y: toBase64Url(y) }
}

/**
 * Split authenticator data into its parts.
 * @param {Buffer} data raw authenticator data
 * @returns {{ rpIdHash: Buffer, flags: number, signCount: number, credentialId: Buffer | null, publicKey: object | null }}
 */
export function parseAuthenticatorData(data) {
  if (data.length < 37) throw new Error('authenticator data is too short')
  const result = {
    rpIdHash: data.subarray(0, 32),
    flags: data[32],
    signCount: data.readUInt32BE(33),
    credentialId: null,
    publicKey: null,
  }
  if ((result.flags & FLAG_AT) !== 0) {
    if (data.length < 55) throw new Error('attested credential data is truncated')
    const idLength = data.readUInt16BE(53)
    const start = 55
    const end = start + idLength
    if (end > data.length) throw new Error('the credential id is truncated')
    result.credentialId = data.subarray(start, end)
    const key = readCbor(data, end)
    result.publicKey = coseToJwk(key.value)
  }
  return result
}

function readClientData(clientDataJSON, expectedType, challenge, host) {
  let parsed
  try {
    parsed = JSON.parse(fromBase64Url(clientDataJSON).toString('utf8'))
  } catch {
    throw new Error('clientDataJSON is not valid JSON')
  }
  if (parsed.type !== expectedType) throw new Error(`clientDataJSON type is "${parsed.type}", expected "${expectedType}"`)
  if (String(parsed.challenge) !== String(challenge)) throw new Error('the challenge does not match this handshake')
  let origin
  try {
    origin = new URL(parsed.origin)
  } catch {
    throw new Error('clientDataJSON origin is not a URL')
  }
  if (origin.hostname !== host) throw new Error(`the assertion came from "${origin.hostname}", not "${host}"`)
  return { type: parsed.type, origin: parsed.origin, hostname: origin.hostname }
}

function checkRpId(rpIdHash, hostname) {
  const expected = createHash('sha256').update(hostname).digest()
  if (!rpIdHash.equals(expected)) throw new Error('the authenticator answered for a different relying party')
}

/**
 * Check a registration answer and return what to persist.
 * @param {{ attestationObject: string, clientDataJSON: string, challenge: string, host: string }} input
 * @returns {{ id: string, publicKey: object, signCount: number }}
 */
export function verifyRegistration({ attestationObject, clientDataJSON, challenge, host }) {
  const decoded = readCbor(fromBase64Url(attestationObject), 0).value
  if (!(decoded instanceof Map)) throw new Error('the attestation object is not a CBOR map')
  const authData = decoded.get('authData')
  if (!Buffer.isBuffer(authData)) throw new Error('the attestation object carries no authenticator data')
  const parsed = parseAuthenticatorData(authData)
  if (parsed.credentialId === null || parsed.publicKey === null) {
    throw new Error('the authenticator returned no credential')
  }
  const client = readClientData(clientDataJSON, 'webauthn.create', challenge, host)
  checkRpId(parsed.rpIdHash, client.hostname)
  if ((parsed.flags & FLAG_UP) === 0) throw new Error('the authenticator did not report user presence')
  return { id: toBase64Url(parsed.credentialId), publicKey: parsed.publicKey, signCount: parsed.signCount }
}

/**
 * Check an unlock answer against the stored credential.
 * @param {{ credential: object, authenticatorData: string, clientDataJSON: string, signature: string, challenge: string, host: string }} input
 * @returns {{ signCount: number }}
 */
export function verifyAssertion({ credential, authenticatorData, clientDataJSON, signature, challenge, host }) {
  if (credential === null || typeof credential !== 'object') throw new Error('no credential is registered')
  const client = readClientData(clientDataJSON, 'webauthn.get', challenge, host)
  const data = fromBase64Url(authenticatorData)
  const parsed = parseAuthenticatorData(data)
  checkRpId(parsed.rpIdHash, client.hostname)
  if ((parsed.flags & FLAG_UP) === 0) throw new Error('the authenticator did not report user presence')
  if ((parsed.flags & FLAG_UV) === 0) throw new Error('the authenticator did not verify the user')
  const clientHash = createHash('sha256').update(fromBase64Url(clientDataJSON)).digest()
  const key = createPublicKey({ key: credential.publicKey, format: 'jwk' })
  const valid = verify('sha256', Buffer.concat([data, clientHash]), { key, dsaEncoding: 'der' }, fromBase64Url(signature))
  if (valid !== true) throw new Error('the assertion signature does not verify')
  return { signCount: parsed.signCount }
}

/** A fresh single-use challenge, keyed by its own base64url spelling. */
export function createChallenge() {
  const bytes = randomBytes(32)
  return { value: toBase64Url(bytes), expiresAt: Date.now() + CHALLENGE_TTL_MS }
}
