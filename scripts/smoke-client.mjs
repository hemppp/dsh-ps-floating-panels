/**
 * Loader-level smoke test for the built client bundle.
 *
 * Boots a fake `window.__ModuleLoader__`, runs the built `client/client.js`
 * factory with a `require` bound to the machine's real React, then asserts the
 * client contract:
 *   - the factory registers under id === 'dsh-ps-floating-panels'
 *   - module.exports has the named exports name / inject / apply (no default)
 *   - apply() injects into the `shell.overlay` slot and registers a component
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
ok(typeof mod.apply === 'function', 'named export apply is a function')
ok(!('default' in mod), 'no default export (loader unwraps named exports)')

/** Read the published activation record through the module's own reader. */
const report = () => (typeof mod.readActivation === 'function' ? mod.readActivation(globalThis.window) : undefined)

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
let threw = null
try { mod.apply(mockCtx, { enabled: true }) } catch (error) { threw = error }
ok(threw === null, 'apply() returns normally on a good host')

ok(overlayInjected, "apply() injects into the 'shell.overlay' slot")
ok(registered !== null && registered.meta && registered.meta.name === 'shell.overlay', "register() targets slot 'shell.overlay'")
ok(typeof registered?.comp === 'function', 'register() receives a React component function')

// ---------------------------------------------------------------------------
// Activation guard: a hostile host must degrade, never abort the Web boot.
// ---------------------------------------------------------------------------
const happy = report()
ok(happy !== undefined, 'activate publishes an activation record')
ok(happy?.ok === true, `…ok === true on a good host (got ${JSON.stringify(happy && { ok: happy.ok, stage: happy.stage })})`)
ok(happy?.stage === 'active', `…stage === 'active' (got ${happy?.stage})`)
ok(happy?.build === mod.CLIENT_BUILD, `…build === CLIENT_BUILD (got ${happy?.build})`)

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
