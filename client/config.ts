/**
 * dsh-ps-floating-panels — client-side contract types shared by the whole
 * client half.
 *
 * This module is deliberately dependency-free (no host imports): the browser
 * bundle is built with the host's React as the only external, so the client
 * half must not import any `@deepseek-ai/*` runtime value. The host context is
 * described structurally at its use site (see index.tsx) exactly as dsh-market
 * does, so a scoped/unscoped Cordis split can never make the bundle fail to
 * load.
 *
 * Since 0.2.0 a panel is not a fixed product name: the panel set IS the set of
 * native DSH regions the shell currently exposes (see native-regions.ts), so a
 * panel id is a region id and the component name is a single constant.
 *
 * @module dsh-ps-floating-panels/client/config
 */

/**
 * A Dockview panel id. In this plugin it is always a native region id
 * (`slot-sidebar`, `slot-main`, `pane-files`, …) — see native-regions.ts.
 */
export type PanelId = string

/** Dockview component name every panel is rendered with. */
export const NATIVE_COMPONENT = 'ps.panel.native'

/** localStorage key remembering whether the native shell is currently taken apart. */
export const NATIVE_ADOPTED_KEY = 'dsh-ps-floating-panels:native-adopted'

/**
 * The layout persistence snapshot. It deliberately mirrors the shape the
 * settings namespace exposes so the host page and the local snapshot use one
 * schema:
 *
 * - `dockview`   — the opaque `DockviewApi.toJSON()` grid (positions, sizes,
 *                  groups, floating groups and split proportions).
 * - `collapsed`  — per-panel collapsed flag, serialized INTO the layout so a
 *                  reload restores the folded state.
 * - `floating`   — ids currently living in a floating group (kept beside the
 *                  grid so a reset can clear them deterministically).
 * - `version`    — schema version, so a future shape change can be migrated
 *                  instead of throwing on an old snapshot.
 */
export interface PersistedLayout {
  readonly version: number
  readonly dockview: unknown
  readonly collapsed: Record<string, boolean>
  readonly floating: readonly string[]
  /** Set by an explicit user action; a reset clears it. */
  readonly updatedAt: number
}

/**
 * Schema version written into every snapshot.
 *
 * v2: panels are native regions, and the collapsed map is keyed by region id.
 * A v1 snapshot describes the old fixed seven-panel grid, so it is discarded
 * rather than applied to a panel set it cannot describe.
 */
export const LAYOUT_VERSION = 2

/**
 * Runtime options for the client half. Field names mirror the Schemastery
 * config the host half exposes; `showStatusBadge` / `showLauncher` are read
 * live from the settings snapshot when the host provides one, otherwise the
 * defaults here apply.
 */
export interface PsPanelsConfig {
  /** Master switch: when false the whole panel system is not mounted. */
  enabled: boolean
  /**
   * Take the native shell apart and re-host its real regions in floating
   * panels. When false the plugin leaves the host layout completely alone and
   * only publishes its bridge (useful to verify the host in isolation).
   */
  nativeAdopt: boolean
  /** Show the toolbar controls (restore / reset / expand). */
  showLauncher: boolean
  /** Show the bottom-right status badge. When false, no DOM is emitted. */
  showStatusBadge: boolean
  /** Below this viewport width the plugin renders nothing (native mobile). */
  minDesktopWidth: number
  /** Debounce for layout snapshots; 0 saves synchronously on every change. */
  persistDebounceMs: number
  /** Panels collapsed on first mount (before any snapshot exists). */
  collapsedPanels: readonly PanelId[]
  /** When true, hovering a collapsed panel peeks its content without pinning. */
  autoHideOnHover: boolean
}

/** Defaults used when the host supplies no config (or an older host). */
export const DEFAULT_CONFIG: PsPanelsConfig = {
  enabled: true,
  nativeAdopt: true,
  showLauncher: true,
  showStatusBadge: true,
  minDesktopWidth: 768,
  persistDebounceMs: 250,
  collapsedPanels: [],
  autoHideOnHover: false,
}

/** Region ids are our own slugs; anything else in a snapshot is ignored. */
const PANEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i

/**
 * Coerce a possibly-partial / possibly-untrusted config object into a complete
 * {@link PsPanelsConfig}. Older hosts hand back `{}` or omit keys; a settings
 * edit may hand back a value of the wrong type. Every field is validated and
 * falls back to the default rather than letting a bad value blank the UI.
 */
export function normalizeConfig(raw: Partial<PsPanelsConfig> | null | undefined): PsPanelsConfig {
  const r = (raw ?? {}) as Partial<Record<keyof PsPanelsConfig, unknown>>
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)
  const collapsed = Array.isArray(r.collapsedPanels)
    ? r.collapsedPanels.filter((id): id is PanelId => typeof id === 'string' && PANEL_ID_PATTERN.test(id))
    : DEFAULT_CONFIG.collapsedPanels
  return {
    enabled: bool(r.enabled, DEFAULT_CONFIG.enabled),
    nativeAdopt: bool(r.nativeAdopt, DEFAULT_CONFIG.nativeAdopt),
    showLauncher: bool(r.showLauncher, DEFAULT_CONFIG.showLauncher),
    showStatusBadge: bool(r.showStatusBadge, DEFAULT_CONFIG.showStatusBadge),
    minDesktopWidth: num(r.minDesktopWidth, DEFAULT_CONFIG.minDesktopWidth),
    persistDebounceMs: typeof r.persistDebounceMs === 'number' && r.persistDebounceMs >= 0
      ? r.persistDebounceMs
      : DEFAULT_CONFIG.persistDebounceMs,
    collapsedPanels: collapsed,
    autoHideOnHover: bool(r.autoHideOnHover, DEFAULT_CONFIG.autoHideOnHover),
  }
}

/** Read the remembered "native shell taken apart" flag (defaults to `fallback`). */
export function readNativeAdopted(store?: Pick<Storage, 'getItem'> | null, fallback = true): boolean {
  const target = store === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : store
  if (target === null) return fallback
  try {
    const raw = target.getItem(NATIVE_ADOPTED_KEY)
    return raw === null ? fallback : raw === 'true'
  } catch {
    return fallback
  }
}

/** Remember the flag; failures are irrelevant (it is a preference, not state). */
export function writeNativeAdopted(adopted: boolean, store?: Pick<Storage, 'setItem'> | null): void {
  const target = store === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : store
  if (target === null) return
  try {
    target.setItem(NATIVE_ADOPTED_KEY, adopted ? 'true' : 'false')
  } catch {
    /* private mode / quota — the in-memory flag still works this session */
  }
}
