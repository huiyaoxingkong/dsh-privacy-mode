/**
 * The `privacy_mode` tool: read-only, and mounted by the mode rather than by a preset.
 *
 * It used to live only inside the PRIVATE preset row, which meant an *already open*
 * conversation never got it — a session keeps the preset it was composed with. The
 * Host now registers it when the mode becomes PRIVATE and disposes it when the mode
 * returns to NORMAL, so the current conversation gains the tool on entry and loses it
 * on exit. A NORMAL catalog cannot contain it because nothing registers it there.
 *
 * The tool reports what the mode hides. Authority stays with the user, so it cannot
 * switch modes, mark items, or touch the PIN.
 */
import { defaultDataDir, PrivacyStore } from './lib/store.js'

export const name = 'dsh-privacy-mode/tools'

export const inject = ['tools']

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string' },
    privateBundles: { type: 'array', items: { type: 'string' } },
    privateWorkspaces: { type: 'integer' },
    privateSessions: { type: 'integer' },
    archived: { type: 'integer' },
    hasPin: { type: 'boolean' },
  },
  required: ['mode', 'privateBundles', 'privateWorkspaces', 'privateSessions', 'archived', 'hasPin'],
  additionalProperties: false,
}

/**
 * Register the tool through a tools service the caller already holds.
 * Passing the service in (instead of reading `ctx.tools` here) keeps a caller without
 * `tools` in its `inject` list from tripping Cordis' "cannot get property without
 * inject" guard.
 * @param {{ tools: object, dataDir?: string }} options tools service and state directory
 * @returns {() => void} disposer
 */
export function registerPrivacyTool(options = {}) {
  const { tools } = options
  if (tools === undefined || typeof tools.register !== 'function') {
    throw new Error('the DSH tools service is unavailable')
  }
  const dir = typeof options.dataDir === 'string' && options.dataDir !== '' ? options.dataDir : defaultDataDir()
  const store = new PrivacyStore({ dir })
  return tools.register({
    name: 'privacy_mode',
    description:
      'Report the current visibility mode and what it hides. Read-only: this tool cannot switch modes or change markings. It exists only while the profile is in private mode.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      const state = store.read()
      return {
        mode: state.mode,
        privateBundles: [...state.privateBundles],
        privateWorkspaces: state.privateWorkspaces.length,
        privateSessions: state.privateSessions.length,
        archived: state.archived.length,
        hasPin: state.pin !== null,
      }
    },
  })
}

/** Kept for a profile that still mounts `dsh-privacy-mode/tools` as its own row. */
export function apply(ctx, rawConfig) {
  const config = rawConfig !== null && typeof rawConfig === 'object' ? rawConfig : {}
  ctx.effect(() => registerPrivacyTool({ tools: ctx.tools, dataDir: config.dataDir }), 'privacy-mode: privacy_mode tool')
}
