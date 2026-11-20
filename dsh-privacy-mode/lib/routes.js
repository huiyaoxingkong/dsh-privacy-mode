/**
 * The Host half's HTTP surface. The browser half is a bundle Client module, and a
 * bundle Client module cannot call an ungenerated Remote namespace, so the two
 * halves talk over one prefix route registered through `ctx.webServer`. The route
 * is served by the loopback-bound Host, carries no credentials, and answers JSON
 * only; the profile's own connection admission still decides who reaches it.
 */
export const ROUTE_PREFIX = '/.dsh-privacy-mode'

const MAX_BODY = 64 * 1024

function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error(`invalid JSON body: ${String(error)}`))
      }
    })
    req.on('error', reject)
  })
}

/**
 * The audit log records who acted. A local desktop Peer has no identity to name, so
 * "who" is the transport facts available at the route: the origin header when a
 * browser sends one, and the peer address otherwise.
 */
function callerOf(req) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  const peer = req.socket?.remoteAddress ?? ''
  return { actor: origin === '' ? 'ui:local' : `ui:${origin}`, origin: peer }
}

/** The host the page was served from; WebAuthn binds an assertion to it. */
function hostOf(req) {
  const raw = typeof req.headers.host === 'string' ? req.headers.host : ''
  try {
    return new URL(`http://${raw}`).hostname
  } catch {
    return ''
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx host context
 * @param {{ engine: object, log: (message: string) => void }} options
 * @returns {() => void} disposer
 */
export function registerRoutes(ctx, { engine, log }) {
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const route = url.pathname
      const caller = callerOf(req)
      try {
        if (route === `${ROUTE_PREFIX}/state` && req.method === 'GET') {
          const titles = url.searchParams.get('titles') === '1'
          const wait = url.searchParams.get('wait') === '1'
          return send(res, 200, await engine.snapshot({ titles, wait }))
        }
        if (route === `${ROUTE_PREFIX}/diagnostics` && req.method === 'GET') {
          return send(res, 200, await engine.diagnostics())
        }
        if (route === `${ROUTE_PREFIX}/audit` && req.method === 'GET') {
          const limit = Number(url.searchParams.get('limit') ?? 40)
          return send(res, 200, {
            path: engine.auditPath,
            entries: engine.auditTail(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 40),
          })
        }
        if (route === `${ROUTE_PREFIX}/switch` && req.method === 'POST') {
          // 202, not 200: the toggle recomposes the profile, and waiting for that on
          // the request path is what aborted the caller's own tool call before.
          const body = await readBody(req)
          const current = engine.state()
          // Entering PRIVATE needs an unlock method. The client normally opens the
          // setup dialog first; this keeps a direct caller from walking in without one.
          if (body.target === 'private' && engine.requiresPin() && current.pin === null && current.credential === null) {
            return send(res, 409, { ok: false, error: 'setup-required' })
          }
          const result = engine.requestSwitch(body.target, {
            pin: body.pin,
            sessionId: body.sessionId,
            actor: caller.actor,
            origin: caller.origin,
          })
          return send(res, result.ok ? 202 : 409, result)
        }
        if (route === `${ROUTE_PREFIX}/mark` && req.method === 'POST') {
          // The classification page exists only in PRIVATE; the server keeps that
          // rule even when a caller talks to the route directly.
          if (engine.state().mode !== 'private') {
            return send(res, 409, { ok: false, error: 'settings-locked' })
          }
          const body = await readBody(req)
          const marked = engine.mark(body.kind, body.id, body.classification, {
            actor: caller.actor,
            origin: caller.origin,
          })
          if (!marked.ok) return send(res, 400, marked)
          const accepted = engine.requestReconcile({
            reason: 'mark',
            sessionId: body.sessionId,
            actor: caller.actor,
            origin: caller.origin,
          })
          return send(res, accepted.ok ? 202 : 409, { ...accepted, state: await engine.snapshot() })
        }
        if (route === `${ROUTE_PREFIX}/mark-bulk` && req.method === 'POST') {
          if (engine.state().mode !== 'private') {
            return send(res, 409, { ok: false, error: 'settings-locked' })
          }
          const body = await readBody(req)
          const marked = engine.markMany(body.items, { actor: caller.actor, origin: caller.origin })
          if (!marked.ok) return send(res, 400, marked)
          const accepted = engine.requestReconcile({
            reason: 'mark-bulk',
            sessionId: body.sessionId,
            actor: caller.actor,
            origin: caller.origin,
          })
          return send(res, accepted.ok ? 202 : 409, { ...accepted, ...marked, state: await engine.snapshot() })
        }
        if (route === `${ROUTE_PREFIX}/pin` && req.method === 'POST') {
          const body = await readBody(req)
          const result = body.clear === true
            ? engine.clearPin({ currentPin: body.currentPin, actor: caller.actor, origin: caller.origin })
            : engine.setPin(body.pin, {
              confirm: body.confirm,
              currentPin: body.currentPin,
              recovery: body.recovery,
              actor: caller.actor,
              origin: caller.origin,
            })
          return send(res, result.ok ? 200 : 400, result)
        }
        if (route === `${ROUTE_PREFIX}/webauthn/register/begin` && req.method === 'POST') {
          return send(res, 200, engine.beginRegistration())
        }
        if (route === `${ROUTE_PREFIX}/webauthn/register/finish` && req.method === 'POST') {
          const body = await readBody(req)
          const result = engine.finishRegistration({
            ...body,
            host: hostOf(req),
            actor: caller.actor,
            origin: caller.origin,
          })
          return send(res, result.ok ? 200 : 400, result)
        }
        if (route === `${ROUTE_PREFIX}/webauthn/assert/begin` && req.method === 'POST') {
          const result = engine.beginAssertion()
          return send(res, result.ok ? 200 : 400, result)
        }
        if (route === `${ROUTE_PREFIX}/webauthn/assert/finish` && req.method === 'POST') {
          const body = await readBody(req)
          const result = engine.finishAssertion({
            ...body,
            host: hostOf(req),
            actor: caller.actor,
            origin: caller.origin,
          })
          return send(res, result.ok ? 202 : result.busy === true ? 409 : 400, result)
        }
        if (route === `${ROUTE_PREFIX}/webauthn/remove` && req.method === 'POST') {
          const result = engine.clearCredential({ actor: caller.actor, origin: caller.origin })
          return send(res, result.ok ? 200 : 400, result)
        }
        if (route === `${ROUTE_PREFIX}/reconcile` && req.method === 'POST') {
          const body = await readBody(req)
          const accepted = engine.requestReconcile({
            reason: 'manual-reconcile',
            sessionId: body.sessionId,
            actor: caller.actor,
            origin: caller.origin,
          })
          return send(res, accepted.ok ? 202 : 409, accepted)
        }
        return send(res, 404, { error: 'not found' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`route ${route} failed: ${message}`)
        return send(res, 500, { error: message })
      }
    },
  })
  return dispose
}
