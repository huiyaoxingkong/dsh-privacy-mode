/**
 * Host half of the privacy bundle.
 *
 * Responsibility split:
 *  - this file wires the mode engine to the running DSH services;
 *  - `lib/engine.js` owns what NORMAL and PRIVATE mean and the transactional switch;
 *  - `lib/routes.js` is the browser half's only channel;
 *  - `tools.js` is a separate row mounted *only* inside the PRIVATE preset.
 *
 * The row declares no `Config` schema on purpose: every value below is boot-time
 * only, and an unvalidated row config keeps the bundle free of dependencies that a
 * profile-installed package cannot resolve (the shipped `@deepseek-ai/*` packages
 * are resolved by the Loader for plugin *rows*, not by Node for `import`).
 */
import { createEngine } from './lib/engine.js'
import { registerRoutes } from './lib/routes.js'
import { defaultDataDir, PrivacyStore } from './lib/store.js'
import { registerPrivacyTool } from './tools.js'

export const name = 'dsh-privacy-mode'

/** Hard dependencies: without the manager or a workspace registry a switch is meaningless. */
export const inject = ['pluginManager', 'webServer', 'workspaceRegistry']

/** Boot delay before the first reconciliation, so the Loader has settled. */
const BOOTSTRAP_DELAY_MS = 400

function normalizeConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {}
  const presets = config.presets !== null && typeof config.presets === 'object' ? config.presets : {}
  return {
    defaultMode: config.defaultMode === 'private' ? 'private' : 'normal',
    requirePin: config.requirePin !== false,
    keepPrivateAcrossRestart: config.keepPrivateAcrossRestart === true,
    hideWorkspaceRows: config.hideWorkspaceRows !== false,
    adoptDefaultPreset: config.adoptDefaultPreset === true,
    basePreset: typeof config.basePreset === 'string' ? config.basePreset : 'standard',
    dataDir: typeof config.dataDir === 'string' && config.dataDir !== '' ? config.dataDir : defaultDataDir(),
    presets: {
      normal: typeof presets.normal === 'string' ? presets.normal : 'privacy-normal',
      private: typeof presets.private === 'string' ? presets.private : 'privacy-private',
    },
  }
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const log = (message) => {
    try {
      ctx.logger?.debug?.(`[privacy-mode] ${message}`)
    } catch {
      // A logging failure never changes the outcome of a switch.
    }
  }
  const store = new PrivacyStore({
    dir: config.dataDir,
    defaultMode: config.defaultMode,
    log,
  })
  const services = {
    pluginManager: ctx.pluginManager,
    workspaceRegistry: ctx.get('workspaceRegistry'),
    sessionQuery: ctx.get('sessionQuery'),
    sessionController: ctx.get('sessionController'),
    agentPresets: ctx.get('agentPresets'),
    agents: ctx.get('agents'),
    workingDirectory: ctx.get('workingDirectory'),
    settings: ctx.get('settings'),
  }
  const engine = createEngine({ store, config, services, log })

  ctx.effect(() => registerRoutes(ctx, { engine, log }), 'privacy-mode: routes')

  // Another writer (the Plugins page, the tools API, a retry of our own toggle) can
  // change the bundle list at any time; the cached listing stops being true then.
  ctx.effect(() => {
    if (typeof ctx.on !== 'function') return () => {}
    const dispose = ctx.on('plugin-manager/changed', () => engine.invalidateBundles())
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'privacy-mode: bundle cache')

  // The `privacy_mode` tool follows the mode, not a preset: a conversation that is
  // already open keeps its preset forever, so a preset-only row could never appear in
  // the session the user is actually talking to. Registered on entry, disposed on
  // exit — which is also why a NORMAL catalog cannot contain it.
  ctx.effect(() => {
    let disposeTool = null
    const off = engine.subscribeMode((mode) => {
      if (mode === 'private') {
        if (disposeTool !== null) return
        const tools = ctx.get('tools')
        if (tools === undefined || typeof tools.register !== 'function') return
        try {
          disposeTool = registerPrivacyTool({ tools, dataDir: config.dataDir })
        } catch (error) {
          log(`privacy_mode tool registration failed: ${String(error)}`)
        }
        return
      }
      if (disposeTool !== null) {
        try {
          disposeTool()
        } catch (error) {
          log(`privacy_mode tool disposal failed: ${String(error)}`)
        }
        disposeTool = null
      }
    })
    return () => {
      off()
      if (disposeTool !== null) {
        try {
          disposeTool()
        } catch {
          // Unloading is the end of the row either way.
        }
        disposeTool = null
      }
    }
  }, 'privacy-mode: privacy_mode tool')

  // A bundle installed in PRIVATE is a private bundle from the start; installed in
  // NORMAL it is an ordinary one. No bundle is toggled at install time — this only
  // records what the next switch should do.
  ctx.effect(() => {
    if (typeof ctx.on !== 'function') return () => {}
    const dispose = ctx.on('plugin-manager/operation', (operation) => {
      try {
        if (operation?.phase !== 'settled' || operation?.reason !== 'install') return
        if (operation?.application === 'failed' || operation?.application === 'cancelled') return
        if (typeof operation?.target !== 'string') return
        const result = engine.classifyInstalled(operation.target)
        if (result.ok && result.unchanged !== true) {
          engine.invalidateBundles()
          log(`installed bundle ${operation.target} classified ${result.classification}`)
        }
      } catch (error) {
        log(`install classification failed: ${String(error)}`)
      }
    })
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'privacy-mode: install classification')

  ctx.effect(() => {
    const timer = setTimeout(() => {
      engine.bootstrap().then(
        (report) => {
          if (report.problems?.length > 0) log(`bootstrap reported: ${report.problems.join('; ')}`)
        },
        (error) => log(`bootstrap failed: ${String(error)}`),
      )
    }, BOOTSTRAP_DELAY_MS)
    return () => clearTimeout(timer)
  }, 'privacy-mode: bootstrap')

  log(`state at ${store.statePath}, mode ${store.read().mode}`)
}

/** Exported for the cold-start harness; not part of the plugin contract. */
export { createEngine, PrivacyStore }
