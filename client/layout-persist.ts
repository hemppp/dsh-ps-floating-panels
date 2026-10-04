/**
 * dsh-ps-floating-panels — layout serialization and persistence.
 *
 * Dockview already serializes the whole grid (positions, sizes, groups, split
 * proportions and floating groups) through `api.toJSON()`. This module wraps
 * that with:
 *
 *  - {@link defaultLayoutJson} — the default split layout for the CURRENT
 *    native regions (left column, center column, right column), so a panel set
 *    discovered at runtime always has a sensible starting grid.
 *  - {@link captureLayout} — snapshot = `toJSON()` + collapsed flags + floating
 *    ids + version.
 *  - {@link applyLayout} — restore, tolerant of a corrupt / partial / outdated
 *    snapshot.
 *  - {@link createLayoutPersistence} — debounced save to a host bridge (when the
 *    host exposes one) AND a local snapshot (localStorage), plus `reset()`.
 *
 * The Dockview API is typed structurally ({@link DockviewApiLike}) so this file
 * carries no runtime dependency and can be unit-tested with a stub.
 *
 * @module dsh-ps-floating-panels/client/layout-persist
 */

import { LAYOUT_VERSION, NATIVE_COMPONENT, type PanelId, type PersistedLayout } from './config.ts'

/** The slice of `DockviewApi` this module uses. */
export interface DockviewApiLike {
  toJSON(): unknown
  fromJSON(data: unknown): void
  clear(): void
  /** Present on dockview; used to enumerate floating groups when available. */
  groups?: readonly { id?: string; api?: { location?: { type?: string } } }[]
}

/** The slice of a generic panel the module reads for ids/params. */
interface PanelLike {
  id?: string
  params?: Record<string, unknown>
}

/** One region as the layout factory needs to see it. */
export interface LayoutRegion {
  readonly id: string
  readonly title: string
  readonly column: 'left' | 'center' | 'right'
}

/** localStorage key for the local snapshot. */
export const LOCAL_SNAPSHOT_KEY = 'dsh-ps-floating-panels:layout'

/** Column weight used to lay out the default split. */
const COLUMN_WEIGHT: Record<LayoutRegion['column'], number> = { left: 26, center: 48, right: 26 }

/** Read the region id out of a panel's params (v2 key, then the v1 key). */
export function regionIdOfParams(params: Record<string, unknown> | undefined): PanelId | undefined {
  const value = params?.regionId ?? params?.panelId
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Build a fresh default split layout for `regions`. Returned as a new object
 * every call so a reset can never be defeated by a mutated cached constant.
 *
 * The grid mirrors the shell it replaces — left column, center column, right
 * column — with the regions of each column stacked vertically (alternating
 * orientation per depth in Dockview):
 *
 * ```
 * ┌────────┬──────────────────┬──────────┐
 * │ sidebar│  main            │ pane A   │
 * │        │                  ├──────────┤
 * │        │                  │ pane B   │
 * └────────┴──────────────────┴──────────┘
 * ```
 */
export function defaultLayoutJson(regions: readonly LayoutRegion[]): Record<string, unknown> {
  const panels: Record<string, unknown> = {}
  for (const region of regions) {
    panels[region.id] = {
      id: region.id,
      contentComponent: NATIVE_COMPONENT,
      tabComponent: undefined,
      title: region.title,
      params: { regionId: region.id, collapsed: false },
    }
  }

  const leaf = (column: LayoutRegion['column'], members: readonly LayoutRegion[], size: number): Record<string, unknown> => ({
    type: 'leaf',
    size,
    data: {
      id: `group-${column}`,
      views: members.map((region) => region.id),
      activeView: members[0]?.id,
    },
  })

  const columns: { column: LayoutRegion['column']; members: LayoutRegion[] }[] = (
    ['left', 'center', 'right'] as const
  )
    .map((column) => ({ column, members: regions.filter((region) => region.column === column) }))
    .filter((entry) => entry.members.length > 0)

  const totalWeight = columns.reduce((sum, entry) => sum + COLUMN_WEIGHT[entry.column], 0)

  const columnNode = (entry: { column: LayoutRegion['column']; members: LayoutRegion[] }, size: number): Record<string, unknown> => {
    if (entry.members.length === 1) return leaf(entry.column, entry.members, size)
    const each = size / entry.members.length
    return {
      type: 'branch',
      size,
      data: entry.members.map((region) => leaf(entry.column, [region], each)),
    }
  }

  const nodes = columns.map((entry) => columnNode(entry, (COLUMN_WEIGHT[entry.column] / totalWeight) * 100))
  const root = nodes.length === 1
    ? nodes[0]
    : { type: 'branch', size: 100, data: nodes }

  return {
    grid: {
      root,
      width: 1280,
      height: 800,
      orientation: 'HORIZONTAL',
    },
    panels,
    floatingGroups: [],
  }
}

/**
 * Read the collapsed flags currently held in each panel's `params`. Reading
 * params (not local React state) is what keeps the flags round-trippable
 * through `toJSON()`.
 */
export function readCollapsed(api: DockviewApiLike): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  const panels = (api as unknown as { panels?: readonly PanelLike[] }).panels
  if (!Array.isArray(panels)) return out
  for (const panel of panels) {
    const panelId = regionIdOfParams(panel?.params)
    if (typeof panelId === 'string' && panelId.length > 0) {
      out[panelId] = panel?.params?.collapsed === true
    }
  }
  return out
}

/** Collect the ids of panels that currently live in a floating group. */
export function readFloating(api: DockviewApiLike): string[] {
  const out: string[] = []
  try {
    const groups = api.groups
    if (!Array.isArray(groups)) return out
    for (const group of groups) {
      if (group?.api?.location?.type !== 'floating') continue
      for (const panel of ((group as unknown as { panels?: readonly PanelLike[] }).panels ?? [])) {
        if (typeof panel?.id === 'string') out.push(panel.id)
      }
    }
  } catch (err) {
    // A future Dockview shape change must not break layout capture.
    console.warn('[dsh-ps-floating-panels] readFloating failed', err)
  }
  return out
}

/**
 * Snapshot the live API into a serializable {@link PersistedLayout}.
 *
 * @param api - the Dockview api (or a structurally-compatible stub).
 * @param now - timestamp supplier (injectable for deterministic tests).
 */
export function captureLayout(api: DockviewApiLike, now: () => number = Date.now): PersistedLayout {
  let dockview: unknown
  try {
    dockview = api.toJSON()
  } catch {
    dockview = undefined
  }
  return {
    version: LAYOUT_VERSION,
    dockview,
    collapsed: readCollapsed(api),
    floating: readFloating(api),
    updatedAt: now(),
  }
}

/**
 * Type guard for a persisted layout coming from untrusted storage.
 *
 * A snapshot from an older schema is NOT a layout this panel set can restore
 * (v1 described a fixed seven-panel grid), so the version is part of the
 * contract: an outdated payload is discarded and the caller falls back to the
 * default split.
 */
export function isPersistedLayout(value: unknown): value is PersistedLayout {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.version === LAYOUT_VERSION && 'dockview' in v
}

/**
 * Restore a snapshot into the API.
 *
 * A snapshot whose `dockview` payload is missing/`undefined`, or which was
 * written by an older schema (a fixed seven-panel grid this panel set cannot
 * describe), falls back to the default split for `regions` — a stale snapshot
 * degrades to "default layout" rather than a blank grid.
 *
 * @returns true when a snapshot (or the default) was applied.
 */
export function applyLayout(api: DockviewApiLike, persisted: PersistedLayout | null, regions: readonly LayoutRegion[]): boolean {
  const usable = persisted !== null && persisted.version === LAYOUT_VERSION && persisted.dockview !== undefined
  const payload = usable ? persisted.dockview : defaultLayoutJson(regions)
  try {
    api.clear()
  } catch {
    /* clear is best-effort; fromJSON below replaces the grid anyway */
  }
  try {
    api.fromJSON(payload)
    return true
  } catch (err) {
    // A corrupt payload must not kill the panel system: fall back to default.
    console.warn('[dsh-ps-floating-panels] fromJSON failed, using default layout', err)
    try {
      api.fromJSON(defaultLayoutJson(regions))
      return true
    } catch (err2) {
      console.error('[dsh-ps-floating-panels] default layout also failed', err2)
      return false
    }
  }
}

/** Optional host bridge that persists the layout outside the browser. */
export interface LayoutHostBridge {
  /** Load the last layout from the host (ctx.config / settings). */
  loadLayout?(): Promise<PersistedLayout | null> | PersistedLayout | null
  /** Persist a layout to the host. Fire-and-forget; errors are logged. */
  saveLayout?(layout: PersistedLayout): void
}

export interface LayoutPersistenceOptions {
  /** The Dockview api to snapshot/restore. */
  api: () => DockviewApiLike | undefined
  /** The regions the default layout is built from (re-read on every reset). */
  regions: () => readonly LayoutRegion[]
  /** Optional host bridge (ctx.config-backed). */
  host?: LayoutHostBridge
  /** localStorage-like store; defaults to the global one when present. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  /** Debounce window for saves (ms). */
  debounceMs?: number
  /** Timestamp supplier (tests). */
  now?: () => number
}

export interface LayoutPersistence {
  /** Load the best snapshot (host first, then local) without applying it. */
  load(): Promise<PersistedLayout | null>
  /** Load synchronously from the local snapshot only. */
  loadLocal(): PersistedLayout | null
  /** Debounced save of the current API state. */
  scheduleSave(): void
  /** Save immediately (bypasses the debounce). */
  saveNow(): PersistedLayout | null
  /** Restore the default split layout, expand every panel, persist it. */
  reset(): PersistedLayout | null
  /** Flush any pending save and detach. */
  dispose(): void
}

/**
 * Create the persistence controller. The controller never throws: every storage
 * and host interaction is guarded, because layout persistence must not be able
 * to take down the panel UI.
 */
export function createLayoutPersistence(options: LayoutPersistenceOptions): LayoutPersistence {
  const storage = options.storage !== undefined
    ? options.storage
    : (typeof localStorage === 'undefined' ? null : localStorage)
  const debounceMs = options.debounceMs ?? 250
  const now = options.now ?? (() => Date.now())
  let timer: ReturnType<typeof setTimeout> | undefined

  const loadLocal = (): PersistedLayout | null => {
    if (!storage) return null
    try {
      const raw = storage.getItem(LOCAL_SNAPSHOT_KEY)
      if (!raw) return null
      const parsed: unknown = JSON.parse(raw)
      return isPersistedLayout(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  const writeLocal = (layout: PersistedLayout): void => {
    if (!storage) return
    try {
      storage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify(layout))
    } catch {
      /* quota / private mode — the host bridge may still have it */
    }
  }

  const load = async (): Promise<PersistedLayout | null> => {
    const local = loadLocal()
    if (options.host?.loadLayout) {
      try {
        const remote = await options.host.loadLayout()
        if (isPersistedLayout(remote)) return remote
      } catch (err) {
        console.warn('[dsh-ps-floating-panels] host layout load failed; using local snapshot', err)
      }
    }
    return local
  }

  const flush = (): PersistedLayout | null => {
    const api = options.api()
    if (!api) return null
    const layout = captureLayout(api, now)
    writeLocal(layout)
    try {
      options.host?.saveLayout?.(layout)
    } catch (err) {
      console.warn('[dsh-ps-floating-panels] host layout save failed', err)
    }
    return layout
  }

  const saveNow = (): PersistedLayout | null => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    return flush()
  }

  return {
    load,
    loadLocal,
    scheduleSave: () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        flush()
      }, debounceMs)
    },
    saveNow,
    reset: () => {
      const api = options.api()
      if (api) {
        for (const panel of ((api as unknown as { panels?: readonly PanelLike[] }).panels ?? [])) {
          if (panel?.params && typeof panel.params === 'object') panel.params.collapsed = false
        }
      }
      try {
        api?.clear()
        api?.fromJSON(defaultLayoutJson(options.regions()))
      } catch (err) {
        console.warn('[dsh-ps-floating-panels] reset failed', err)
      }
      return saveNow()
    },
    dispose: () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    },
  }
}
