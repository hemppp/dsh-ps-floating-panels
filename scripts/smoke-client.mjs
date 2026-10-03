/**
 * Loader-level smoke test for the built client bundle.
 *
 * Boots a fake `window.__ModuleLoader__`, runs the built `client/client.js`
 * factory with a `require` bound to the machine's real React, then asserts the
 * client contract:
 *   - the factory registers under id === 'dsh-ps-floating-panels'
 *   - module.exports has the named exports name / inject / apply (no default)
 *   - apply() injects into the `shell.overlay` slot and registers a component
 *
 * Run:  node scripts/smoke-client.mjs
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const ROOT = 'F:/DSH pulls/dsh-ps-floating-panels'
const hostRequire = createRequire('F:/new1.2/node_modules/')

// Real React, resolved through the host module table stand-in.
const react = hostRequire('react')
const reactDom = hostRequire('react-dom')
const jsxRuntime = hostRequire('react/jsx-runtime')

const moduleTable = {
  react,
  'react-dom': reactDom,
  'react/jsx-runtime': jsxRuntime,
  '@deepseek-ai/dsh-client-ui-primitives': {},
}

let captured = null
globalThis.window = {
  __ModuleLoader__: { load: (def) => { captured = def } },
  innerWidth: 1600,
  addEventListener() {},
  removeEventListener() {},
}

const code = readFileSync(`${ROOT}/client/client.js`, 'utf8')
// eslint-disable-next-line no-new-func
new Function(code)()

const fails = []
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg) }

ok(captured !== null, 'ModuleLoader.load called')
ok(captured && captured.id === 'dsh-ps-floating-panels', `bundle id === 'dsh-ps-floating-panels' (got ${captured && captured.id})`)

const mod = captured.factory((spec) => {
  if (spec in moduleTable) return moduleTable[spec]
  throw new Error('unexpected require: ' + spec)
})

ok(typeof mod === 'object' && mod !== null, 'factory returns an object')
ok(mod.name === 'dsh-ps-floating-panels', `named export name === 'dsh-ps-floating-panels' (got ${mod.name})`)
ok(Array.isArray(mod.inject) && mod.inject.includes('slots'), `named export inject includes 'slots' (got ${JSON.stringify(mod.inject)})`)
ok(typeof mod.apply === 'function', 'named export apply is a function')
ok(!('default' in mod), 'no default export (loader unwraps named exports)')

// Exercise apply() with a mock client ctx.
let overlayInjected = false
let registered = null
const mockCtx = {
  slots: {
    inject(name, cb) { if (name === 'shell.overlay') { overlayInjected = true; cb() } },
    register(meta, comp) { registered = { meta, comp }; return () => {} },
  },
  effect(cb) { return cb() },
  on() { return () => {} },
}
mod.apply(mockCtx, { enabled: true })

ok(overlayInjected, "apply() injects into the 'shell.overlay' slot")
ok(registered !== null && registered.meta && registered.meta.name === 'shell.overlay', "register() targets slot 'shell.overlay'")
ok(typeof registered?.comp === 'function', 'register() receives a React component function')

console.log('\n' + (fails.length ? `SMOKE FAILED (${fails.length})` : 'SMOKE PASSED'))
process.exit(fails.length ? 1 : 0)
