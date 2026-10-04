/**
 * Unit tests for the client half's pure logic (no React, no host).
 *
 * Bundled by esbuild and run under node — see scripts/run-logic-tests.mjs.
 * Everything here is DOM-free: the native-region discovery is exercised against
 * a hand-written {@link QueryRoot} stub, and the settings bridge against a stub
 * config form.
 */
import { DEFAULT_CONFIG, LAYOUT_VERSION, NATIVE_COMPONENT, normalizeConfig, readNativeAdopted } from '../client/config.ts'
import { detectConflicts, isHostPackage, matchesConflictKeyword } from '../client/conflict-detect.ts'
import {
  defaultLayoutJson,
  captureLayout,
  applyLayout,
  isPersistedLayout,
  createLayoutPersistence,
  type DockviewApiLike,
  type LayoutRegion,
} from '../client/layout-persist.ts'
import {
  discoverRegions,
  readPaneTitle,
  regionIdForPane,
  regionIdForSlot,
  regionSignature,
  type QueryRoot,
} from '../client/native-regions.ts'
import { createHostLayoutBridge, readLayoutSnapshot, resolveSettingsBridge } from '../client/host-bridge.ts'

const fails: string[] = []
function ok(cond: boolean, msg: string): void {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg)
  if (!cond) fails.push(msg)
}

/* ---- config ---- */
ok(LAYOUT_VERSION === 2, `LAYOUT_VERSION is 2 (got ${LAYOUT_VERSION})`)
ok(DEFAULT_CONFIG.nativeAdopt === true, 'nativeAdopt defaults to true')
ok(normalizeConfig(null).nativeAdopt === true, 'normalizeConfig(null) keeps nativeAdopt true')
ok(normalizeConfig({ nativeAdopt: false }).nativeAdopt === false, 'normalizeConfig honours nativeAdopt=false')
ok(DEFAULT_CONFIG.showStatusBadge === true, 'showStatusBadge defaults to true')
ok(normalizeConfig(null).showStatusBadge === true, 'normalizeConfig(null) keeps showStatusBadge true')
ok(normalizeConfig({ showStatusBadge: false }).showStatusBadge === false, 'normalizeConfig honours showStatusBadge=false')
ok(normalizeConfig({ enabled: 'nope' as never }).enabled === true, 'normalizeConfig falls back on bad boolean')
ok(normalizeConfig({ minDesktopWidth: -5 }).minDesktopWidth === DEFAULT_CONFIG.minDesktopWidth, 'normalizeConfig rejects negative width')
ok(normalizeConfig({ collapsedPanels: ['slot-sidebar', 'bogus id!'] as never }).collapsedPanels.length === 1, 'normalizeConfig filters malformed collapsed ids')
ok((normalizeConfig(null) as Record<string, unknown>).layoutMode === undefined, 'layoutMode is gone from the config surface')

// The adoption preference survives a storage round-trip and degrades to its
// fallback when storage is unavailable/frozen.
const memoryStore = (() => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
  }
})()
ok(readNativeAdopted(memoryStore, true) === true, 'readNativeAdopted falls back to the default when unset')
ok(readNativeAdopted({ getItem: () => 'false' }, true) === false, 'readNativeAdopted reads a stored false')
ok(readNativeAdopted({ getItem: () => { throw new Error('nope') } }, true) === true, 'readNativeAdopted tolerates a throwing store')

/* ---- conflict-detect ---- */
const graph = { entries: [{ id: 'dsh-ps-floating-panels' }, { id: '@someone/my-dock-plugin' }, { id: 'other-layout-helper' }, { id: 'totally-unrelated' }] }
const conflicts = detectConflicts(graph)
ok(conflicts.length === 2, `detectConflicts finds 2 (got ${conflicts.length}: ${conflicts.map(c => c.id).join(',')})`)
ok(!conflicts.some(c => c.id === 'dsh-ps-floating-panels'), 'detectConflicts never reports self')
ok(detectConflicts(undefined).length === 0, 'detectConflicts tolerates missing graph')
ok(detectConflicts({ entries: 'x' }).length === 0, 'detectConflicts tolerates non-array entries')

// The real shell registers keyword-bearing client entries of its own. Reporting
// them would fire the dialog on every boot and tell the user to disable the
// very package that declares the `shell.overlay` slot this plugin mounts into.
const hostEntries = [
  { id: '@deepseek-ai/dsh-client-ui-layout' },
  { id: '@deepseek-ai/dsh-client-ui-dockkit' },
  { id: '@deepseek-ai/dsh-client-ui-conversation' },
]
ok(detectConflicts({ entries: hostEntries }).length === 0, 'detectConflicts never reports host packages')
ok(isHostPackage('@deepseek-ai/dsh-client-ui-layout') === true, 'isHostPackage recognises the host scope')
ok(isHostPackage('@someone/dsh-client-ui-layout') === false, 'isHostPackage rejects third-party scopes')
ok(matchesConflictKeyword('@deepseek-ai/dsh-client-ui-layout') === 'layout', 'host ids still match keywords (exclusion is the scope, not the name)')

// Mixed graph: host rows plus exactly one genuine third-party overlap.
const mixed = detectConflicts({ entries: [...hostEntries, { id: '@someone/my-dock-plugin' }, { id: 'dsh-ps-floating-panels' }] })
ok(mixed.length === 1 && mixed[0].id === '@someone/my-dock-plugin', `mixed graph reports only the third-party plugin (got ${mixed.map(c => c.id).join(',') || 'none'})`)

// Word-boundary matching: a name that merely CONTAINS a keyword is not evidence.
ok(matchesConflictKeyword('panelize-lint') === undefined, 'matchesConflictKeyword ignores a mere substring (panelize-lint)')
ok(matchesConflictKeyword('@scope/my-panel-dock') === 'dock', 'matchesConflictKeyword matches a hyphenated segment')
ok(matchesConflictKeyword('some.dockviewPanels') === 'panel', 'matchesConflictKeyword splits camelCase and accepts a plural segment')
ok(matchesConflictKeyword('ws-overlay-kit') === 'overlay', 'matchesConflictKeyword matches an overlay segment')
ok(matchesConflictKeyword('unrelated-helper') === undefined, 'matchesConflictKeyword returns undefined when nothing matches')

/* ---- native region discovery ---- */
interface FakePane { paneId: string; title?: string }
function fakePane({ paneId, title }: FakePane): never {
  const element = {
    getAttribute: (name: string) => (name === 'data-dockkit-pane' ? paneId : null),
    querySelector: (selector: string) => {
      if (!selector.includes('[role="tab"]')) return null
      if (title === undefined) return null
      if (selector.includes('aria-selected')) return { textContent: title }
      return { textContent: title }
    },
  }
  return element as never
}
function fakeDoc(options: { sidebar?: boolean; main?: boolean; panes?: readonly FakePane[]; panesOnDoc?: boolean }): QueryRoot {
  const paneElements = (options.panes ?? []).map(fakePane)
  const rightbar = options.panes === undefined ? null : { querySelectorAll: () => paneElements }
  return {
    querySelector: (selector: string) => {
      if (selector === '[data-slot="sidebar"]') return options.sidebar ? ({} as never) : null
      if (selector === '[data-slot="main"]') return options.main ? ({} as never) : null
      if (selector === '[data-slot="rightbar"]') return rightbar as never
      return null
    },
    querySelectorAll: () => (options.panesOnDoc === true ? paneElements : []),
  } as never
}

ok(discoverRegions(undefined).length === 0, 'discoverRegions tolerates a missing document')
ok(regionIdForSlot('sidebar') === 'slot-sidebar', 'regionIdForSlot slugs the slot key')
ok(regionIdForPane('Session! Panel') === 'pane-session-panel', 'regionIdForPane slugs arbitrary pane ids')

const discovered = discoverRegions(fakeDoc({
  sidebar: true,
  main: true,
  panes: [{ paneId: 'session', title: '会话' }, { paneId: 'session', title: '会话(dup)' }, { paneId: 'files', title: '文件' }, { paneId: '' }],
}))
ok(discovered.length === 4, `discoverRegions returns 4 regions for sidebar+main+2 panes (got ${discovered.length})`)
ok(discovered.map(r => r.id).join(',') === 'slot-sidebar,slot-main,pane-session,pane-files', `discoverRegions dedupes panes by id (got ${discovered.map(r => r.id).join(',')})`)
ok(discovered[0].column === 'left' && discovered[1].column === 'center' && discovered[3].column === 'right', 'regions carry their native column')
ok(discovered[2].title === '会话' && discovered[3].title === '文件', 'pane regions take the pane tab label')
ok(discoverRegions(fakeDoc({})).length === 0, 'discoverRegions returns nothing for an empty shell')
ok(discovered[0].kind === 'slot' && discovered[2].kind === 'pane', 'regions carry their kind')
ok(regionSignature(discovered) === regionSignature(discoverRegions(fakeDoc({ sidebar: true, main: true, panes: [{ paneId: 'session', title: '会话' }, { paneId: 'files', title: '文件' }] }))), 'regionSignature is stable for the same regions')
ok(regionSignature(discovered) !== regionSignature(discovered.slice(1)), 'regionSignature changes when a region appears/disappears')
ok(readPaneTitle(fakePane({ paneId: 'x', title: '  spaced   title \n' })) === 'spaced title', 'readPaneTitle collapses whitespace')
ok(readPaneTitle(fakePane({ paneId: 'x' })) === undefined, 'readPaneTitle returns undefined without a label')

/* ---- layout-persist ---- */
const regions: readonly LayoutRegion[] = [
  { id: 'slot-sidebar', title: '侧栏', column: 'left' },
  { id: 'slot-main', title: '主区域', column: 'center' },
  { id: 'pane-session', title: '会话', column: 'right' },
]
const def = defaultLayoutJson(regions)
ok((def as any).panels && Object.keys((def as any).panels).length === 3, 'default layout has one panel per region')
ok((def as any).grid?.root?.type === 'branch', 'default layout root is a branch')
ok(!('version' in (def as any)), 'the default payload is a raw Dockview grid (the version is stamped by captureLayout)')
ok(Object.values((def as any).panels).every((p: any) => p.contentComponent === NATIVE_COMPONENT), 'every default panel renders the native region component')
ok(Object.values((def as any).panels).every((p: any) => typeof p.params?.regionId === 'string'), 'every default panel carries its regionId')

// stub Dockview api
function stubApi(): DockviewApiLike & { _json: unknown } {
  const panels = regions.map((r) => ({ id: NATIVE_COMPONENT, params: { regionId: r.id, collapsed: r.id === 'slot-main' } }))
  return {
    _json: def,
    toJSON() { return this._json },
    fromJSON(data) { this._json = data },
    clear() {},
    groups: [{ id: 'g', api: { location: { type: 'floating' } }, panels: [{ id: NATIVE_COMPONENT }] } as never],
    panels,
  } as never
}

const api = stubApi()
const snap = captureLayout(api, () => 123)
ok(snap.version === LAYOUT_VERSION, 'captureLayout stamps the current version')
ok(snap.updatedAt === 123, 'captureLayout uses injected clock')
ok(snap.collapsed['slot-main'] === true && snap.collapsed['slot-sidebar'] === false, 'captureLayout reads collapsed flags from params')
ok(snap.floating.length === 1, 'captureLayout collects floating panel ids')
ok(isPersistedLayout(snap), 'isPersistedLayout accepts a real snapshot')
ok(!isPersistedLayout({ foo: 1 }), 'isPersistedLayout rejects junk')
ok(!isPersistedLayout({ ...snap, version: 1 }), 'isPersistedLayout rejects a v1 snapshot')

const api2 = stubApi()
ok(applyLayout(api2, null, regions) === true, 'applyLayout(null) applies the default layout')
const v1 = { version: 1, dockview: { panels: {} }, collapsed: { conversation: true }, floating: [], updatedAt: 1 }
ok(applyLayout(api2, v1 as never, regions) === true, 'applyLayout discards a v1 snapshot')
ok(Object.keys(((api2 as any)._json as any).panels).length === 3, 'a discarded v1 snapshot falls back to the default layout')
// corrupt payload falls back to default rather than throwing
const api3 = { toJSON: () => ({}), fromJSON: (d: unknown) => { if (d === 'BAD') throw new Error('bad'); }, clear() {}, groups: [], panels: [] } as unknown as DockviewApiLike
const threwRef = { value: false }
try { applyLayout(api3, { version: LAYOUT_VERSION, dockview: 'BAD', collapsed: {}, floating: [], updatedAt: 0 }) }
catch { threwRef.value = true }
ok(threwRef.value === false, 'applyLayout never throws on a corrupt payload')

// reset clears collapsed flags and re-applies the default layout
const persists = createLayoutPersistence({
  api: () => api,
  regions: () => regions,
  storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  debounceMs: 0,
  now: () => 7,
})
const afterReset = persists.reset()
ok(!!afterReset && afterReset.updatedAt === 7, 'persistence.reset() writes a snapshot')
ok((api as any).panels.every((p: any) => p.params.collapsed === false), 'reset() expands every panel')

/* ---- host-bridge (settings document) ---- */
const layoutFromHost = { ...snap, updatedAt: 5 }
ok(readLayoutSnapshot({ enabled: true, layout: JSON.stringify(layoutFromHost) })?.updatedAt === 5, 'readLayoutSnapshot reads the layout field of a namespace section')
ok(readLayoutSnapshot(JSON.stringify(layoutFromHost))?.updatedAt === 5, 'readLayoutSnapshot accepts a bare JSON string')
ok(readLayoutSnapshot({ layout: '   ' }) === null, 'readLayoutSnapshot ignores an empty field')
ok(readLayoutSnapshot({ layout: 'not json' }) === null, 'readLayoutSnapshot ignores malformed JSON')
ok(readLayoutSnapshot({ layout: JSON.stringify(v1) }) === null, 'readLayoutSnapshot ignores a v1 payload')
ok(readLayoutSnapshot(undefined) === null, 'readLayoutSnapshot tolerates undefined')

const setCalls: Array<{ field: string; value: unknown }> = []
const writableForm = {
  getSnapshot: () => ({ status: 'ready', writable: true, mode: 'host', value: { layout: JSON.stringify(layoutFromHost) } }),
  set: (field: string, value: unknown) => { setCalls.push({ field, value }); return Promise.resolve(true) },
}
const bridge = createHostLayoutBridge(writableForm, 'dsh-ps-floating-panels')
ok(bridge.loadLayout?.() instanceof Promise === false, 'settings loadLayout stays synchronous')
ok((bridge.loadLayout?.() as any)?.updatedAt === 5, 'the settings bridge reads the stored layout')
bridge.saveLayout?.({ ...snap, updatedAt: 9 })
ok(setCalls.length === 1 && setCalls[0].field === 'layout', 'the settings bridge writes the layout field')
ok(JSON.parse(String(setCalls[0].value)).updatedAt === 9, 'the settings bridge serializes the layout')

const readOnlyCalls: unknown[] = []
const readOnlyBridge = createHostLayoutBridge({
  getSnapshot: () => ({ status: 'ready', writable: false, value: {} }),
  set: (field: string, value: unknown) => { readOnlyCalls.push([field, value]); return false },
}, 'dsh-ps-floating-panels')
readOnlyBridge.saveLayout?.(snap)
ok(readOnlyCalls.length === 0, 'a read-only namespace is never written to')

const throwingBridge = createHostLayoutBridge({
  getSnapshot: () => { throw new Error('boom') },
  set: () => { throw new Error('boom') },
}, 'dsh-ps-floating-panels')
const bridgeThrew = { value: false }
try { throwingBridge.saveLayout?.(snap); throwingBridge.loadLayout?.() } catch { bridgeThrew.value = true }
ok(bridgeThrew.value === false, 'the settings bridge never throws into activation')

ok(resolveSettingsBridge({}, 'dsh-ps-floating-panels') === undefined, 'resolveSettingsBridge is undefined without the service')
ok(resolveSettingsBridge(undefined, 'ns') === undefined, 'resolveSettingsBridge tolerates a missing context')
const resolved = resolveSettingsBridge({ configForms: { get: () => writableForm } }, 'dsh-ps-floating-panels')
ok(!!resolved && (resolved.loadLayout?.() as any)?.updatedAt === 5, 'resolveSettingsBridge binds the namespace form')
ok(resolveSettingsBridge({ configForms: { get: () => ({}) } }, 'ns') === undefined, 'resolveSettingsBridge rejects an unusable form')
ok(resolveSettingsBridge({ configForms: { get: () => { throw new Error('nope') } } }, 'ns') === undefined, 'resolveSettingsBridge survives a throwing service')

console.log('\n' + (fails.length ? `LOGIC FAILED (${fails.length})` : 'LOGIC PASSED'))
if (fails.length) process.exit(1)
