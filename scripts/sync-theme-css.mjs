/**
 * Regenerate client/theme-css.ts from client/theme.css.
 *
 * `theme.css` is the canonical, human-auditable colour layer; the bundle needs
 * the same rules as a JS string (the loader serves this bundle's JS but never a
 * separate CSS file). Keeping the two in step by hand is error-prone, so this
 * script is the single writer of `theme-css.ts`.
 *
 * Run:  node scripts/sync-theme-css.mjs            (rewrite)
 *       node scripts/sync-theme-css.mjs --check    (exit 1 when stale)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'client', 'theme.css')
const TARGET = join(ROOT, 'client', 'theme-css.ts')

const HEADER =
  '/* AUTO-GENERATED from theme.css (canonical colour layer). Do not edit by hand; edit theme.css. */\n'

const css = readFileSync(SOURCE, 'utf8')
const next = `${HEADER}export const THEME_CSS: string = ${JSON.stringify(css)}\n`

const check = process.argv.includes('--check')
const current = (() => {
  try {
    return readFileSync(TARGET, 'utf8')
  } catch {
    return ''
  }
})()

if (next === current) {
  console.log(`THEME IN SYNC (${Buffer.byteLength(css, 'utf8')} bytes)`)
  process.exit(0)
}

if (check) {
  console.error('THEME OUT OF SYNC: client/theme-css.ts does not match client/theme.css')
  console.error('Run: node scripts/sync-theme-css.mjs')
  process.exit(1)
}

writeFileSync(TARGET, next)
console.log(
  `theme-css.ts regenerated from theme.css (${Buffer.byteLength(css, 'utf8')} bytes -> ${Buffer.byteLength(next, 'utf8')} bytes)`,
)
