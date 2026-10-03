/**
 * Unit tests for the client half's pure logic (no React, no DOM, no host).
 * Bundled by esbuild and run under node — see scripts/run-logic-tests.mjs.
 */
import { PANEL_IDS, DEFAULT_CONFIG, normalizeConfig, PANEL_META } from '../client/config.ts'
import { detectConflicts } from '../client/conflict-detect.ts'
import {
  defaultLayoutJson,
  captureLayout,
  applyLayout,
  isPersistedLayout,
  createLayoutPersistence,
  type DockviewApiLike,
} from '../client/layout-persist.ts'

const fails: string[] = []
function ok(cond: boolean, msg: string): void {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg)
  if (!cond) fails.push(msg)
}

/* ---- config ---- */
ok(PANEL_IDS.length === 7, `PANEL_IDS has 7 panels (got ${PANEL_IDS.length})`)
ok(Object.keys(PANEL_META).length === 7, 'PANEL_META has 7 entries')
ok(DEFAULT_CONFIG.showStatusBadge === true, 'showStatusBadge defaults to true')
ok(normalizeConfig(null).showStatusBadge === true, 'normalizeConfig(null) keeps showStatusBadge true')
ok(normalizeConfig({ showStatusBadge: false }).showStatusBadge === false, 'normalizeConfig honours showStatusBadge=false')
ok(normalizeConfig({ enabled: 'nope' as never }).enabled === true, 'normalizeConfig falls back on bad boolean')
ok(normalizeConfig({ minDesktopWidth: -5 }).minDesktopWidth === DEFAULT_CONFIG.minDesktopWidth, 'normalizeConfig rejects negative width')
ok(normalizeConfig({ collapsedPanels: ['conversation', 'bogus'] as never }).collapsedPanels.length === 1, 'normalizeConfig filters unknown collapsed ids')

/* ---- conflict-detect ---- */
const graph = { entries: [{ id: 'dsh-ps-floating-panels' }, { id: '@someone/my-dock-plugin' }, { id: 'other-layout-helper' }, { id: 'totally-unrelated' }] }
const conflicts = detectConflicts(graph)
ok(conflicts.length === 2, `detectConflicts finds 2 (got ${conflicts.length}: ${conflicts.map(c => c.id).join(',')})`)
ok(!conflicts.some(c => c.id === 'dsh-ps-floating-panels'), 'detectConflicts never reports self')
ok(detectConflicts(undefined).length === 0, 'detectConflicts tolerates missing graph')
ok(detectConflicts({ entries: 'x' }).length === 0, 'detectConflicts tolerates non-array entries')

/* ---- layout-persist ---- */
const def = defaultLayoutJson()
ok((def as any).panels && Object.keys((def as any).panels).length === 7, 'default layout has 7 panels')
ok((def as any).grid?.root?.type === 'branch', 'default layout root is a branch')

// stub Dockview api
function stubApi(): DockviewApiLike & { _json: unknown } {
  const panels = PANEL_IDS.map((id) => ({ id: PANEL_META[id].component, params: { panelId: id, collapsed: id === 'workspace' } }))
  return {
    _json: def,
    toJSON() { return this._json },
    fromJSON(data) { this._json = data },
    clear() {},
    groups: [{ id: 'g', api: { location: { type: 'floating' } }, panels: [{ id: 'ps.panel.composer' }] } as never],
    panels,
  } as never
}

const api = stubApi()
const snap = captureLayout(api, () => 123)
ok(snap.version === 1, 'captureLayout stamps version')
ok(snap.updatedAt === 123, 'captureLayout uses injected clock')
ok(snap.collapsed.workspace === true && snap.collapsed.conversation === false, 'captureLayout reads collapsed flags from params')
ok(snap.floating.includes('ps.panel.composer'), 'captureLayout collects floating panel ids')
ok(isPersistedLayout(snap), 'isPersistedLayout accepts a real snapshot')
ok(!isPersistedLayout({ foo: 1 }), 'isPersistedLayout rejects junk')

const api2 = stubApi()
ok(applyLayout(api2, null) === true, 'applyLayout(null) applies the default layout')
// corrupt payload falls back to default rather than throwing
const api3 = { toJSON: () => ({}), fromJSON: (d: unknown) => { if (d === 'BAD') throw new Error('bad'); }, clear() {}, groups: [], panels: [] } as unknown as DockviewApiLike
const threwRef = { value: false }
try { applyLayout(api3, { version: 1, dockview: 'BAD', collapsed: {}, floating: [], updatedAt: 0 }) }
catch { threwRef.value = true }
ok(threwRef.value === false, 'applyLayout never throws on a corrupt payload')

// reset clears collapsed flags and re-applies the default layout
const persists = createLayoutPersistence({
  api: () => api,
  storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  debounceMs: 0,
  now: () => 7,
})
const afterReset = persists.reset()
ok(!!afterReset && afterReset.updatedAt === 7, 'persistence.reset() writes a snapshot')
ok((api as any).panels.every((p: any) => p.params.collapsed === false), 'reset() expands every panel')

console.log('\n' + (fails.length ? `LOGIC FAILED (${fails.length})` : 'LOGIC PASSED'))
if (fails.length) process.exit(1)
