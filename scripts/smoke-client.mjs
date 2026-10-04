/**
 * Loader-level smoke test for the built client bundle.
 *
 * Boots a fake `window.__ModuleLoader__`, runs the built `client/client.js`
 * factory with a `require` bound to the machine's real React, then asserts the
 * client contract:
 *   - the factory registers under id === 'dsh-ps-floating-panels'
 *   - module.exports has the named exports name / inject / apply (no default)
 *   - apply() injects into the `shell.overlay` slot and registers a component
 *   - the native-region bridge (`window.__DSH_NATIVE_PANELS__`) is published and
 *     is empty without a DOM (nothing to adopt)
 *   - the settings transport is joined through `ctx.inject(['configForms'])`
 *   - the activation guard: apply() never throws, records its stage in
 *     `window.__DSH_PS_PANELS_ACTIVATION__`, and survives a host that refuses
 *     the locale registration or whose slots service explodes
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
ok(mod.inject.includes('locale') && mod.inject.includes('theme'), 'named export inject includes the locale and theme services')
ok(typeof mod.apply === 'function', 'named export apply is a function')
ok(!('default' in mod), 'no default export (loader unwraps named exports)')
ok(typeof mod.CLIENT_BUILD === 'string' && mod.CLIENT_BUILD.startsWith('0.2.0'), `CLIENT_BUILD is the v0.2.0 build (got ${mod.CLIENT_BUILD})`)

/** Read the published activation record through the module's own reader. */
const report = () => (typeof mod.readActivation === 'function' ? mod.readActivation(globalThis.window) : undefined)

// Exercise apply() with a mock client ctx. `inject` stands in for the client
// Cordis nested injection used to join the settings document.
let overlayInjected = false
let registered = null
let injectedDeps = null
let scopedCallbacks = 0
const settingsForm = { getSnapshot: () => ({ status: 'ready', writable: true, value: {} }), set: () => true }
const mockCtx = {
  slots: {
    inject(name, cb) { if (name === 'shell.overlay') { overlayInjected = true; cb() } },
    register(meta, comp) { registered = { meta, comp }; return () => {} },
  },
  effect(cb) { return cb() },
  on() { return () => {} },
  inject(deps, cb) { injectedDeps = deps; scopedCallbacks += 1; cb({ configForms: { get: () => settingsForm } }) },
}
let threw = null
try { mod.apply(mockCtx, { enabled: true }) } catch (error) { threw = error }
ok(threw === null, 'apply() returns normally on a good host')

ok(overlayInjected, "apply() injects into the 'shell.overlay' slot")
ok(registered !== null && registered.meta && registered.meta.name === 'shell.overlay', "register() targets slot 'shell.overlay'")
ok(typeof registered?.comp === 'function', 'register() receives a React component function')
ok(Array.isArray(injectedDeps) && injectedDeps.includes('configForms'), `apply() asks for the settings service (got ${JSON.stringify(injectedDeps)})`)
ok(scopedCallbacks === 1, 'the settings injection callback ran exactly once')

// The native-region bridge is published by the plugin itself (the Host has no
// such global), and with no DOM there is nothing to adopt.
const bridge = globalThis.window['__DSH_NATIVE_PANELS__']
ok(bridge !== null && typeof bridge === 'object', 'apply() publishes window.__DSH_NATIVE_PANELS__')
ok(bridge?.version === 1 && bridge?.plugin === 'dsh-ps-floating-panels', 'the bridge carries its version and plugin id')
ok(typeof bridge?.list === 'function' && bridge.list().length === 0, 'the bridge lists no regions without a DOM')
ok(bridge?.getElement('slot-sidebar') === null, 'getElement returns null for an unknown region')
ok(typeof bridge?.subscribe === 'function' && typeof bridge.subscribe(() => {}) === 'function', 'the bridge hands out a subscription disposer')
ok(typeof bridge?.adopt === 'function' && bridge.adopt('slot-sidebar', {}) === false, 'adopt() refuses an unknown region instead of throwing')

// ---------------------------------------------------------------------------
// Activation guard: a hostile host must degrade, never abort the Web boot.
// ---------------------------------------------------------------------------
const happy = report()
ok(happy !== undefined, 'activate publishes an activation record')
ok(happy?.ok === true, `…ok === true on a good host (got ${JSON.stringify(happy && { ok: happy.ok, stage: happy.stage })})`)
ok(happy?.stage === 'active', `…stage === 'active' (got ${happy?.stage})`)
ok(happy?.build === mod.CLIENT_BUILD, `…build === CLIENT_BUILD (got ${happy?.build})`)
ok(happy?.regions === 0, `…and counts the discovered native regions (got ${happy?.regions})`)

const realError = console.error
const realWarn = console.warn
const logs = { error: [], warn: [] }
console.error = (...args) => { logs.error.push(args.map(String).join(' ')) }
console.warn = (...args) => { logs.warn.push(args.map(String).join(' ')) }
try {
  // 1) The real host refuses a namespace+locale pair it already holds — the
  //    exact error the Web client locale service raises on a re-registration.
  let registered2 = null
  const duplicateLocaleCtx = {
    slots: {
      inject(name, cb) { if (name === 'shell.overlay') cb() },
      register(meta, comp) { registered2 = { meta, comp }; return () => {} },
    },
    effect(cb) { return cb() },
    locale: {
      register() { throw new Error('locale namespace "ps-panels" already has locale "zh"') },
      bind() { return (key) => key },
    },
  }
  threw = null
  try { mod.apply(duplicateLocaleCtx, { enabled: true }) } catch (error) { threw = error }
  ok(threw === null, 'apply() does not throw when the host refuses the locale registration')
  ok(report()?.ok === true, '…activation still reports ok')
  ok(registered2 !== null && registered2.meta.id === 'dsh-ps-floating-panels-root', '…and the overlay entry is still registered')
  ok(logs.warn.some((line) => line.includes('locale registration skipped')), '…and the skipped registration is logged as a warning')

  // 2) A slots service that explodes: the guard records the stage, logs it and
  //    still returns, so the boot audit sees an ACTIVE entry.
  const brokenSlotsCtx = {
    slots: {
      inject() { throw new Error('slots.inject exploded') },
      register() { throw new Error('slots.register exploded') },
    },
    effect(cb) { return cb() },
  }
  threw = null
  try { mod.apply(brokenSlotsCtx, { enabled: true }) } catch (error) { threw = error }
  ok(threw === null, 'apply() does not throw when the slots service explodes')
  const failed = report()
  ok(failed?.ok === false, '…activation reports ok === false')
  ok(failed?.stage === 'slot', `…and names the stage that failed (got ${failed?.stage})`)
  ok(failed?.error?.message === 'slots.inject exploded', `…and carries the original message (got ${failed?.error?.message})`)
  ok(logs.error.some((line) => line.includes('activation failed')), 'console.error carries the failure (DevTools / crash report)')
  ok(globalThis.window[mod.ACTIVATION_GLOBAL] === failed, 'ACTIVATION_GLOBAL publishes the record on window')

  // 3) The fallback banner is a guarded best effort, not a second failure mode.
  ok(logs.error.some((line) => line.includes('activation banner unavailable')), 'a broken slots service also kills the banner, and that too is swallowed')

  // 4) A host that switches the plugin off must not register anything.
  let offRegistered = false
  const offCtx = {
    slots: { inject(name, cb) { cb() }, register() { offRegistered = true; return () => {} } },
    effect(cb) { return cb() },
  }
  threw = null
  try { mod.apply(offCtx, { enabled: false }) } catch (error) { threw = error }
  ok(threw === null && !offRegistered, 'enabled: false returns early without registering')
  ok(report()?.stage === 'disabled', `…and records stage 'disabled' (got ${report()?.stage})`)
} finally {
  console.error = realError
  console.warn = realWarn
}

console.log('\n' + (fails.length ? `SMOKE FAILED (${fails.length})` : 'SMOKE PASSED'))
process.exit(fails.length ? 1 : 0)
