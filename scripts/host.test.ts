/**
 * Host-half smoke/unit tests: contract + apply() wiring against a mock settings
 * service. Bundled by esbuild and run under node (see scripts/smoke-host.mjs).
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as host from '../host/index.ts'

// Isolate the durable snapshot store in a temp dir BEFORE apply() runs.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-ps-'))

const fails: string[] = []
function ok(cond: boolean, msg: string): void {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg)
  if (!cond) fails.push(msg)
}

/* ---- contract ---- */
ok(host.name === 'dsh-ps-floating-panels', `name === 'dsh-ps-floating-panels' (got ${host.name})`)
ok(Array.isArray(host.inject) && host.inject.includes('settings'), `inject includes 'settings' (got ${JSON.stringify(host.inject)})`)
ok(typeof host.apply === 'function', 'apply is a function')
const configDefaults = typeof host.Config === 'function' ? (host.Config as unknown as (v: unknown) => Record<string, unknown>)({}) : null
ok(!!host.Config && (typeof host.Config === 'object' || typeof host.Config === 'function'), 'Config is a Schemastery schema')
ok(!!configDefaults && configDefaults.showStatusBadge === true, 'Config resolves defaults (showStatusBadge defaults true)')
ok(!!configDefaults && configDefaults.nativeAdopt === true, 'Config resolves defaults (nativeAdopt defaults true)')
ok(!!configDefaults && !('layoutMode' in configDefaults), 'layoutMode is gone from the host config surface')
ok(host.LAYOUT_VERSION === 2, `LAYOUT_VERSION matches the client snapshot version (got ${host.LAYOUT_VERSION})`)
ok(host.LAYOUT_NAMESPACE === 'dsh-ps-floating-panels', 'LAYOUT_NAMESPACE equals the package name')
ok(host.snapshotPath().endsWith('layout.json'), 'snapshotPath() points at the layout file')
ok(!('default' in host), 'no default export')

/* ---- apply() wiring ---- */
let registered: { ns: string; options: any } | null = null
let current: any = { ...(host.Config as any)({}), layout: '' }
const watchers: Array<(n: any, p: any) => void> = []
const scope = {
  get: () => current,
  watch: (cb: (n: any, p: any) => void) => { watchers.push(cb); return () => { const i = watchers.indexOf(cb); if (i >= 0) watchers.splice(i, 1) } },
  update: async (patch: any) => { const prev = current; current = { ...current, ...patch }; watchers.forEach((w) => w(current, prev)) },
  replace: async (s: any) => { const prev = current; current = { ...s }; watchers.forEach((w) => w(current, prev)) },
}

let provided: any = null
let effectRan = false
const mockCtx = {
  effect: (cb: () => unknown) => { effectRan = true; return cb() },
  provide: (key: string, value: unknown) => { if (key === 'psPanelsPersist') provided = value; return () => { provided = null } },
  settings: {
    register: (ns: string, schema: unknown, options: any) => { registered = { ns, options }; return scope },
  },
}

host.apply(mockCtx as never, { ...(host.Config as any)({}) })

ok(registered !== null && registered!.ns === 'dsh-ps-floating-panels', 'apply() registers the settings namespace')
ok(effectRan, 'apply() wires the layout seam through ctx.effect')
ok(provided !== null && typeof provided.loadLayout === 'function' && typeof provided.saveLayout === 'function', 'apply() provides the psPanelsPersist service (loadLayout/saveLayout)')

/* ---- validation: cross-field layout guard ---- */
const validate = registered!.options.validate as (v: any) => void
let validateThrew = false
try { validate({ ...current, layout: 'not-json' }) } catch { validateThrew = true }
ok(validateThrew, 'validate() rejects a non-JSON layout string')
let validateOk = true
try { validate({ ...current, layout: '{"version":2,"dockview":{}}' }) } catch { validateOk = false }
ok(validateOk, 'validate() accepts a valid JSON-object layout')

/* ---- mirror on commit + loadLayout resolution ---- */
void scope.update({ layout: '{"version":2,"dockview":{"root":true}}' })
ok(provided.loadLayout() !== null && (provided.loadLayout() as any).dockview.root === true, 'a committed settings layout is readable back through loadLayout()')

// The committed write is mirrored into the durable file (this is the path the
// browser reaches through the settings document), and the file survives a
// settings reset only until the reset clears it.
await new Promise((resolve) => setTimeout(resolve, 60))
ok(readFileSync(host.snapshotPath(), 'utf8').includes('"root":true'), 'a committed layout is mirrored to the durable snapshot file')

provided.saveLayout({ version: 2, dockview: { root: false }, collapsed: {}, floating: [], updatedAt: 1 })
await new Promise((resolve) => setTimeout(resolve, 60))
ok(readFileSync(host.snapshotPath(), 'utf8').includes('"root":false'), 'saveLayout() writes the durable snapshot file')

await provided.resetLayout()
ok(true, 'resetLayout() completes without throwing')

console.log('\n' + (fails.length ? `HOST FAILED (${fails.length})` : 'HOST PASSED'))
if (fails.length) process.exit(1)
