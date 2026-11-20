/**
 * Render the client half outside a browser: fake slot registry, fake React hooks and
 * a canned `/state`. It answers what a page console would answer — did the module
 * load, did apply() register every surface, and does each surface behave as promised
 * in NORMAL, in PRIVATE, and when things go wrong — without needing the GUI.
 *
 * Run: node scripts/check-client.mjs
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginDir = resolve(here, '..')
let importCounter = 0
/** When set, registering the grouped sidebar throws — the plugin must survive it. */
let failGroupRegistration = false

const React = {
  Fragment: 'Fragment',
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.flat(Infinity) } }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect(fn) {
    try {
      return fn()
    } catch {
      return undefined
    }
  },
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}

function textOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, out)
    return out
  }
  if (typeof node === 'object' && node.props) {
    if (node.type === 'style') return out
    if (typeof node.type === 'function') {
      try {
        textOf(node.type(node.props), out)
      } catch (error) {
        out.push(`<render error: ${error?.message ?? error}>`)
      }
      return out
    }
    textOf(node.props.children, out)
  }
  return out
}

function findNodes(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findNodes(child, predicate, out)
    return out
  }
  if (typeof node.type === 'function') {
    try {
      findNodes(node.type(node.props), predicate, out)
    } catch {
      // A throwing component is reported by textOf; nothing to collect here.
    }
    return out
  }
  if (predicate(node)) out.push(node)
  if (node.props) findNodes(node.props.children, predicate, out)
  return out
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function baseState(mode, jobStatus) {
  return {
    mode,
    hasPin: true,
    hasCredential: false,
    credential: null,
    settingsEditable: mode === 'private',
    job: jobStatus === 'running'
      ? { id: 'switch-private-x', kind: 'switch-private', status: 'running', startedAt: Date.now() }
      : null,
    bundlesReady: true,
    bundles: [
      { name: 'alpha-plugin', title: 'Alpha', version: '1.0.0', enabled: true, classification: 'unclassified', self: false },
      { name: 'dsh-privacy-mode', title: 'Privacy', version: '0.2.0', enabled: true, classification: 'public', self: true },
    ],
    workspaces: [
      { id: 'ws-1', title: 'Demo', path: '/demo', sessionCount: 2, sessionIds: ['s-1', 's-3'], classification: 'unclassified' },
      { id: 'ws-2', title: 'Secret', path: '/secret', sessionCount: 1, sessionIds: ['s-2'], classification: 'private' },
    ],
    sessions: [
      { id: 's-1', title: 'Chat', workspaceId: 'ws-1', archived: false, classification: 'unclassified' },
      { id: 's-3', title: 'Hidden chat', workspaceId: 'ws-1', archived: false, classification: 'private' },
      { id: 's-2', title: 'Secret chat', workspaceId: 'ws-2', archived: false, classification: 'private' },
      { id: 's-4', title: 'Workspace chat', workspaceId: 'ws-2', archived: false, classification: 'unclassified' },
    ],
    sets: {
      privateBundles: [],
      publicBundles: [],
      privateWorkspaces: ['ws-2'],
      publicWorkspaces: [],
      privateSessions: ['s-2', 's-3'],
      publicSessions: [],
    },
    config: { requirePin: true, keepPrivateAcrossRestart: false, hideWorkspaceRows: true },
    archived: [],
    auditPath: '',
    statePath: '',
    lastError: '',
  }
}

async function render(mode, host = 'localhost', jobStatus = null, options = {}) {
  const state = baseState(mode, jobStatus)
  failGroupRegistration = options.failGroups === true
  const sessionId = options.sessionId ?? (mode === 'private' ? 's-3' : 's-1')
  const entries = []
  const problems = []
  const calls = []
  const requests = []
  let captured = null

  globalThis.window = {
    __ModuleLoader__: { load: (mod) => { captured = mod } },
    location: { hostname: host },
    PublicKeyCredential: function PublicKeyCredential() {},
    isSecureContext: true,
    addEventListener() {},
  }
  globalThis.document = {
    documentElement: { lang: 'zh-CN' },
    head: { appendChild() {} },
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ id: '', textContent: '', remove() {} }),
    addEventListener() {},
  }
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body })
    return {
      ok: true,
      status: 200,
      json: async () => (String(url).includes('/audit') ? { path: '', entries: [] } : state),
    }
  }

  await import(`${pathToFileURL(resolve(pluginDir, 'client.js')).href}?run=${importCounter++}`)
  const mod = captured.factory(() => React)
  const ctx = {
    effect: (fn) => {
      try {
        return fn()
      } catch (error) {
        problems.push(`effect: ${error?.message}`)
        return undefined
      }
    },
    slots: {
      inject(name, register) {
        try {
          return register()
        } catch (error) {
          problems.push(`inject(${name}): ${error?.message}`)
          return undefined
        }
      },
      register(options2, component) {
        if (failGroupRegistration && options2.id === 'dsh-privacy-mode-groups') throw new Error('injected slot conflict')
        const entry = { options: options2, component, disposed: false }
        entries.push(entry)
        return () => { entry.disposed = true }
      },
      onEntryError: () => () => {},
    },
    locale: { getLocale: () => ({ active: 'zh-CN', locales: [], revision: 1 }), subscribe: () => () => {} },
    uiWorkspace: {
      openSession: (id) => calls.push(['session', id]),
      openWorkspace: (id) => { calls.push(['workspace', id]); return Promise.resolve() },
    },
  }
  mod.apply(ctx)
  // First pass: mounting triggers the store subscription and the first `/state`
  // fetch (the fake effects run synchronously). Second pass renders with data.
  for (const entry of entries) {
    try {
      entry.component({ sessionId })
    } catch {
      // The warm-up pass exists only for its side effects.
    }
  }
  await sleep(60)

  const rendered = new Map()
  for (const entry of entries) {
    if (entry.disposed === true) continue
    const id = `${entry.options.name}#${entry.options.id ?? entry.options.key ?? 'single'}`
    try {
      rendered.set(id, entry.component({ sessionId }))
    } catch (error) {
      problems.push(`${id}: ${error?.message}`)
      rendered.set(id, null)
    }
  }
  return { entries, rendered, problems, calls, requests }
}

function marks(requests) {
  return requests.filter((request) => request.url.includes('/mark') && request.method === 'POST')
}

async function report(mode) {
  const { entries, rendered, problems, calls, requests } = await render(mode)
  console.log(`\n=== ${mode.toUpperCase()} (${entries.length} slot registrations) ===`)
  for (const [id, node] of rendered) {
    const text = textOf(node).join(' ').replace(/\s+/g, ' ').trim()
    console.log(`  ${id}`)
    console.log(`    ${node === null ? 'null' : text.slice(0, 160)}`)
  }
  const settings = textOf(rendered.get('settings.section#privacy-mode')).join(' ')
  const groups = rendered.get('sidebar.workspaces#dsh-privacy-mode-groups')
  const groupsText = textOf(groups).join(' ')
  const chip = rendered.get('conversation.input.left#dsh-privacy-mode-chip')
  const chipText = textOf(chip).join(' ').trim()
  const settingsChip = rendered.get('conversation.input.left#dsh-privacy-mode-settings')
  const footerToggle = rendered.get('sidebar.footer.action#dsh-privacy-mode-toggle')
  const footerSettings = rendered.get('sidebar.footer.action#dsh-privacy-mode-settings')
  const overlay = rendered.get('shell.overlay#dsh-privacy-mode-overlay')
  const overlayText = textOf(overlay).join(' ')

  const checks = []
  if (mode === 'normal') {
    checks.push(['the chip reports this chat as regular', chip?.props?.['data-mode'] === 'normal' && /常规对话/u.test(chipText)])
    checks.push(['composer settings chip is hidden', settingsChip === null])
    checks.push(['sidebar toggle exists', footerToggle !== null])
    checks.push(['sidebar settings button is hidden', footerSettings === null])
    checks.push(['settings page stays closed', rendered.get('settings.section#privacy-mode') === null])
    checks.push(['the shipped workspace list is not shadowed', groups === undefined])
    checks.push(['an unmarked chat is not frosted', !/恢复显示/u.test(overlayText)])
    const before = marks(requests).length
    try {
      chip?.props?.onClick?.()
    } catch (error) {
      problems.push(`chip click threw: ${error?.message}`)
    }
    await sleep(20)
    checks.push(['clicking in NORMAL asks for the unlock, it does not mark', marks(requests).length === before])
  } else {
    checks.push(['the chip reports this chat as private', chip?.props?.['data-mode'] === 'private' && /隐私对话/u.test(chipText)])
    checks.push(['composer settings chip exists', settingsChip !== null])
    checks.push(['sidebar toggle exists', footerToggle !== null])
    checks.push(['sidebar settings button exists', footerSettings !== null])
    checks.push(['plugin classes are selectable', /隐私插件/u.test(settings) && /常规插件/u.test(settings)])
    checks.push(['bulk actions are offered', /全部设为隐私/u.test(settings) && /全部设为常规/u.test(settings)])
    checks.push(['workspaces are split into two groups', /隐私工作区/u.test(groupsText) && /常规工作区/u.test(groupsText)])
    checks.push(['the private workspace is grouped on its own', /隐私工作区[\s\S]*Secret/u.test(groupsText)])
    checks.push(['a private chat leaves the workspace tree', !/Hidden chat/u.test(groupsText)])
    checks.push(['hidden chats stay reachable from one list', /已隐藏的对话/u.test(groupsText)])
    checks.push(['there is a way back to the built-in list', /还原原生工作区列表/u.test(groupsText)])
    checks.push(['a private chat is readable inside PRIVATE', !/已磨砂遮挡/u.test(overlayText) && !/恢复显示/u.test(overlayText)])

    const wsButtons = findNodes(groups, (node) => node.type === 'button' && String(node.props.className ?? '').includes('dsh-privacy-ws-main'))
    const sessionButtons = findNodes(groups, (node) => node.type === 'button' && String(node.props.className ?? '').includes('dsh-privacy-session'))
    try {
      wsButtons[0]?.props?.onClick?.()
      sessionButtons[0]?.props?.onClick?.()
    } catch (error) {
      problems.push(`navigation click threw: ${error?.message}`)
    }
    checks.push(['a workspace row opens the workspace', calls.some(([kind]) => kind === 'workspace')])
    checks.push(['a session row opens the session', calls.some(([kind]) => kind === 'session')])

    const before = marks(requests).length
    try {
      chip?.props?.onClick?.()
    } catch (error) {
      problems.push(`chip click threw: ${error?.message}`)
    }
    await sleep(20)
    const posted = marks(requests).slice(before)
    checks.push(['clicking the chip marks this conversation', posted.length === 1 && String(posted[0].body).includes('s-3')])
    checks.push(['the chip never switches the profile mode', !requests.some((request) => request.url.includes('/switch'))])
  }
  for (const [label, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (problems.length > 0) for (const problem of problems) console.log(`  ! ${problem}`)
  return checks.every(([, ok]) => ok) && problems.length === 0
}

const normal = await report('normal')
const privateMode = await report('private')

// If the shadow cannot be registered, the shipped list stays and every other surface
// must keep working — a failed nicety may never take the plugin down.
const warn = console.warn
console.warn = () => {}
const conflict = await render('private', 'localhost', null, { failGroups: true })
console.warn = warn
const conflictChip = conflict.rendered.get('conversation.input.left#dsh-privacy-mode-chip')
const conflictChecks = [
  ['a slot conflict leaves the built-in list in place', conflict.rendered.get('sidebar.workspaces#dsh-privacy-mode-groups') === undefined],
  ['a slot conflict does not take the mode button with it', conflictChip?.props?.['data-mode'] === 'private'],
  ['a slot conflict is not reported as a render problem', conflict.problems.length === 0],
]
console.log('\n=== PRIVATE when the grouped list cannot register ===')
for (const [label, ok] of conflictChecks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)

// The switch card is the click's immediate answer while the profile recomposes.
const busy = await render('private', 'localhost', 'running')
const busyText = textOf(busy.rendered.get('shell.overlay#dsh-privacy-mode-overlay')).join(' ')
const busyShield = busy.rendered.get('sidebar.footer.action#dsh-privacy-mode-toggle')
const busyChecks = [
  ['a running switch shows the transition card', /正在应用更改/u.test(busyText)],
  ['the exit button stays clickable while a switch runs', busyShield?.props?.disabled !== true],
]
console.log('\n=== PRIVATE while a switch runs ===')
for (const [label, ok] of busyChecks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)

// Chromium refuses WebAuthn on an IP origin; the page must say so in words that name
// the address instead of surfacing "Public-key credentials are only available to ...".
const ipRender = await render('private', '127.0.0.1')
const ipSettings = textOf(ipRender.rendered.get('settings.section#privacy-mode')).join(' ')
const ipChecks = [
  ['the fingerprint hint names the IP origin', /127\.0\.0\.1/u.test(ipSettings)],
  ['the fingerprint hint points at localhost', /localhost/u.test(ipSettings)],
]
console.log('\n=== PRIVATE on 127.0.0.1 ===')
for (const [label, ok] of ipChecks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)

// Leaving PRIVATE must cover a marked chat; opening it again inside PRIVATE must not.
const markedCase = await render('normal', 'localhost', null, { sessionId: 's-3' })
const markedOverlay = textOf(markedCase.rendered.get('shell.overlay#dsh-privacy-mode-overlay')).join(' ')
const markedChecks = [
  ['a marked chat is frosted outside PRIVATE', /已磨砂遮挡/u.test(markedOverlay) && /恢复显示/u.test(markedOverlay)],
]
console.log('\n=== NORMAL with a marked chat open ===')
for (const [label, ok] of markedChecks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)

// Leaving PRIVATE with a private workspace's chat on screen must keep it covered: the
// workspace is what hides it, so the card offers the way back in instead of an unmark.
const workspaceCase = await render('normal', 'localhost', null, { sessionId: 's-4' })
const workspaceOverlay = textOf(workspaceCase.rendered.get('shell.overlay#dsh-privacy-mode-overlay')).join(' ')
const workspaceChip = workspaceCase.rendered.get('conversation.input.left#dsh-privacy-mode-chip')
const workspaceChecks = [
  ['a private workspace chat is frosted in NORMAL', /属于隐私工作区/u.test(workspaceOverlay)],
  ['the card offers the way back into private mode', /进入隐私模式/u.test(workspaceOverlay)],
  ['the chip reports that chat as private', workspaceChip?.props?.['data-mode'] === 'private'],
]
console.log('\n=== NORMAL with a private workspace chat open ===')
for (const [label, ok] of workspaceChecks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)

const ok = normal && privateMode
  && markedChecks.every(([, passed]) => passed) && markedCase.problems.length === 0
  && workspaceChecks.every(([, passed]) => passed) && workspaceCase.problems.length === 0
  && conflictChecks.every(([, passed]) => passed)
  && busyChecks.every(([, passed]) => passed) && busy.problems.length === 0
  && ipChecks.every(([, passed]) => passed) && ipRender.problems.length === 0
console.log(`\nsummary: normal=${normal} private=${privateMode} conflict=${conflictChecks.every(([, passed]) => passed)} busy=${busyChecks.every(([, passed]) => passed) && busy.problems.length === 0} ip=${ipChecks.every(([, passed]) => passed) && ipRender.problems.length === 0}`)
process.exit(ok ? 0 : 1)
