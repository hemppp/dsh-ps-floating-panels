/**
 * dsh-ps-floating-panels — client-side contract types shared by the whole
 * client half.
 *
 * This module is deliberately dependency-free (no host imports): the browser
 * bundle is built by tsdown with the host's React as the only external, so the
 * client half must not import any `@deepseek-ai/*` runtime value. The host
 * context is described structurally at its use site (see index.tsx) exactly as
 * dsh-market does, so a scoped/unscoped Cordis split can never make the bundle
 * fail to load.
 *
 * @module dsh-ps-floating-panels/client/config
 */

/** The seven dockable panels the PS layout ships with. */
export type PanelId =
  | 'conversation'
  | 'conversation-tree'
  | 'code-preview'
  | 'composer'
  | 'workspace'
  | 'code-tree'
  | 'agent-team'

/** Canonical panel order — this is also the Dockview default layout order. */
export const PANEL_IDS: readonly PanelId[] = [
  'conversation',
  'conversation-tree',
  'code-preview',
  'composer',
  'workspace',
  'code-tree',
  'agent-team',
] as const

/**
 * Static descriptor for one panel: the Dockview component name, the locale key
 * for its title, and the default (uncollapsed) content height. Rendering lives
 * in panels/*.tsx; this table is the single place both the layout factory and
 * the status badge enumerate panels from.
 */
export interface PanelMeta {
  readonly id: PanelId
  /** Dockview component name (stable across serialization). */
  readonly component: string
  /** Locale key resolved through the plugin's `t`. */
  readonly titleKey: string
}

export const PANEL_META: Readonly<Record<PanelId, PanelMeta>> = {
  conversation: { id: 'conversation', component: 'ps.panel.conversation', titleKey: 'panel.conversation' },
  'conversation-tree': { id: 'conversation-tree', component: 'ps.panel.conversationTree', titleKey: 'panel.conversationTree' },
  'code-preview': { id: 'code-preview', component: 'ps.panel.codePreview', titleKey: 'panel.codePreview' },
  composer: { id: 'composer', component: 'ps.panel.composer', titleKey: 'panel.composer' },
  workspace: { id: 'workspace', component: 'ps.panel.workspace', titleKey: 'panel.workspace' },
  'code-tree': { id: 'code-tree', component: 'ps.panel.codeTree', titleKey: 'panel.codeTree' },
  'agent-team': { id: 'agent-team', component: 'ps.panel.agentTeam', titleKey: 'panel.agentTeam' },
}

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

/** Schema version written into every snapshot. */
export const LAYOUT_VERSION = 1

/**
 * Runtime options for the client half. Field names mirror the Schemastery
 * config A 组 exposes on the host side; `showStatusBadge` / `showLauncher` are
 * read live from the settings snapshot when the host provides one, otherwise
 * the defaults here apply.
 */
export interface PsPanelsConfig {
  /** Master switch: when false the whole panel system is not mounted. */
  enabled: boolean
  /** Show the floating launcher chip (hide-all / reset / show-all). */
  showLauncher: boolean
  /** Show the bottom-right status badge. When false, no DOM is emitted. */
  showStatusBadge: boolean
  /** Below this viewport width the plugin renders nothing (native mobile). */
  minDesktopWidth: number
  /**
   * How the split layout coexists with the host's own panels.
   * - `overlay` — the Dockview root floats above the shell, native layout intact.
   * - `replace` — the shell's main region is hidden while the split is active.
   */
  layoutMode: 'overlay' | 'replace'
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
  showLauncher: true,
  showStatusBadge: true,
  minDesktopWidth: 768,
  layoutMode: 'overlay',
  persistDebounceMs: 250,
  collapsedPanels: [],
  autoHideOnHover: false,
}

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
    ? r.collapsedPanels.filter((id): id is PanelId => typeof id === 'string' && (PANEL_IDS as readonly string[]).includes(id))
    : DEFAULT_CONFIG.collapsedPanels
  return {
    enabled: bool(r.enabled, DEFAULT_CONFIG.enabled),
    showLauncher: bool(r.showLauncher, DEFAULT_CONFIG.showLauncher),
    showStatusBadge: bool(r.showStatusBadge, DEFAULT_CONFIG.showStatusBadge),
    minDesktopWidth: num(r.minDesktopWidth, DEFAULT_CONFIG.minDesktopWidth),
    layoutMode: r.layoutMode === 'replace' ? 'replace' : 'overlay',
    persistDebounceMs: typeof r.persistDebounceMs === 'number' && r.persistDebounceMs >= 0
      ? r.persistDebounceMs
      : DEFAULT_CONFIG.persistDebounceMs,
    collapsedPanels: collapsed,
    autoHideOnHover: bool(r.autoHideOnHover, DEFAULT_CONFIG.autoHideOnHover),
  }
}
