/**
 * Preset drift check.
 *
 * Both mode presets restate the shipped `standard` tool set on purpose: a preset
 * replaces the complete child list, so a mode preset that named only a privacy row
 * would hand the session a nearly empty catalog. That copy drifts silently when DSH
 * adds or renames a row, so this script compares the two lists and reports the
 * difference instead of letting a mode quietly lose a tool.
 *
 * The `privacy_mode` tool is no longer a preset row — the Host registers it while the
 * mode is PRIVATE — so both presets must equal `standard` exactly.
 *
 * Run: node scripts/check-presets.mjs [--standard PATH]
 *
 * The shipped file lives inside the DSH installation, which is not a dependency of
 * this bundle: pass `--standard`, set `DSH_INSTALL_DIR`, or accept the skip. A skip
 * is not a failure — a machine without DSH installed cannot drift.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')

/** Row ids of a preset's `plugins:` list, read by indentation rather than a YAML parser. */
function presetRows(text, presetId) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^\\s*- id:\\s*['"]?${presetId}['"]?\\s*$`).test(line))
  if (start < 0) return null
  const end = lines.findIndex((line, index) => index > start && /^\s*- id:\s*preset-/.test(line))
  const block = lines.slice(start, end < 0 ? lines.length : end)
  const pluginsAt = block.findIndex((line) => /^\s*plugins:\s*$/.test(line))
  if (pluginsAt < 0) return []
  const rows = []
  let indent = -1
  for (let index = pluginsAt + 1; index < block.length; index += 1) {
    const line = block[index]
    if (line.trim() === '') continue
    const currentIndent = line.length - line.trimStart().length
    const match = /^(\s*)- id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (indent < 0) {
      if (match === null) return rows
      indent = currentIndent
    }
    if (currentIndent < indent) return rows
    if (currentIndent !== indent || match === null) continue
    const nameLine = block[index + 1] ?? ''
    const nameMatch = /^\s*name:\s*['"]?([^'"\n]+?)['"]?\s*$/.exec(nameLine)
    rows.push({ id: match[2], name: nameMatch === null ? '' : nameMatch[1].trim() })
  }
  return rows
}

function shippedStandard() {
  const explicit = process.argv.indexOf('--standard')
  if (explicit > 0 && process.argv[explicit + 1] !== undefined) {
    return resolve(process.argv[explicit + 1])
  }
  const roots = [process.env.DSH_INSTALL_DIR, process.env.DSH_APP_DIR].filter((value) => typeof value === 'string' && value !== '')
  for (const root of roots) {
    const candidate = join(root, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', 'standard.patch.yml')
    if (existsSync(candidate)) return candidate
  }
  return null
}

function describe(rows) {
  return rows.map((row) => `  ${row.id} → ${row.name}`).join('\n')
}

function compare(label, actual, expected) {
  const problems = []
  if (actual.length !== expected.length) {
    problems.push(`${label}: ${actual.length} rows, expected ${expected.length}`)
  }
  const shared = Math.min(actual.length, expected.length)
  for (let index = 0; index < shared; index += 1) {
    const a = actual[index]
    const e = expected[index]
    if (a.id !== e.id || a.name !== e.name) {
      problems.push(`${label}: row ${index + 1} is "${a.id} → ${a.name}", expected "${e.id} → ${e.name}"`)
    }
  }
  return problems
}

const standardPath = shippedStandard()
if (standardPath === null) {
  console.log('SKIP  the installed standard preset was not found; pass --standard PATH or set DSH_INSTALL_DIR')
  process.exit(0)
}

const standardRows = presetRows(readFileSync(standardPath, 'utf8'), 'preset-standard')
const ours = readFileSync(join(packageRoot, 'cordis.patch.yml'), 'utf8')
const normalRows = presetRows(ours, 'preset-privacy-normal')
const privateRows = presetRows(ours, 'preset-privacy-private')

if (standardRows === null || normalRows === null || privateRows === null) {
  console.error('FAIL  a preset declaration could not be read (standard, privacy-normal, privacy-private)')
  process.exit(1)
}

const problems = [
  ...compare('privacy-normal', normalRows, standardRows),
  ...compare('privacy-private', privateRows, standardRows),
]

if (problems.length === 0) {
  console.log(`PASS  both presets match standard (${standardRows.length} rows)`)
  process.exit(0)
}

console.error('FAIL  preset drift against the installed standard preset')
for (const problem of problems) console.error(`      ${problem}`)
console.error('\nstandard:\n' + describe(standardRows))
console.error('\nprivacy-normal:\n' + describe(normalRows))
console.error('\nprivacy-private:\n' + describe(privateRows))
process.exit(1)
