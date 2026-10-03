/**
 * dsh-ps-floating-panels — root component: the Photoshop-style split/floating
 * panel system.
 *
 * Responsibilities:
 *  - Viewport gate: below `minDesktopWidth` it renders NOTHING, leaving the
 *    host's native mobile layout untouched.
 *  - Split mode: mount a DockviewReact grid of the seven panels from
 *    `api.fromJSON(defaultLayoutJson())` (or a saved layout). This is a real
 *    split layout, not an in-place overlay of the old composition.
 *  - PS Dock: floating groups stay enabled, dragging docks/splits/tears out,
 *    dropping near an edge snaps, and panels merge into tab groups.
 *  - Collapse: each panel's tab header carries the fold button; folded panels
 *    keep their title bar and the flag lives in Dockview `params`, so it is
 *    serialized with the layout.
 *  - Persistence: `onDidLayoutChange` (debounced) → `toJSON()` → host bridge +
 *    local snapshot; the reset control restores the default layout, expanded.
 *  - Conflict warning + status badge.
 *
 * @module dsh-ps-floating-panels/client/PsFloatingPanelsApp
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import { DockviewReact } from 'dockview-react'
import type { DockviewApi } from 'dockview'
import {
  PANEL_IDS,
  PANEL_META,
  type PanelId,
  type PersistedLayout,
  type PsPanelsConfig,
} from './config.ts'
import type { ConfigSource } from './config-source.ts'
import { buildDockviewComponents } from './panels/registry.tsx'
import { PsDefaultTab } from './panels/tabs.tsx'
import { PsPanelsProvider, type PsPanelsContextValue } from './panels/panel-shell.tsx'
import {
  applyLayout,
  createLayoutPersistence,
  isPersistedLayout,
  readFloating,
  type LayoutHostBridge,
  type LayoutPersistence,
} from './layout-persist.ts'
import { StatusBadge } from './status-badge.tsx'
import { ConflictDialog } from './conflict-dialog.tsx'
import type { ConflictEntry } from './conflict-detect.ts'
import type { Translate } from './locales.ts'

/** Dockview panel shape this file pokes (params mirror for the collapse flag). */
interface PanelWithParams {
  id?: string
  params?: Record<string, unknown>
  api?: { updateParameters?: (p: Record<string, unknown>) => void }
}

/** Write the collapse flag into a panel so `toJSON()` carries it. */
function writePanelCollapsed(api: DockviewApi, component: string, collapsed: boolean): void {
  const panel = (api as unknown as { getPanel?: (id: string) => PanelWithParams | undefined }).getPanel?.(component)
  if (!panel) return
  const next = { ...(panel.params ?? {}), collapsed }
  if (typeof panel.api?.updateParameters === 'function') {
    panel.api.updateParameters(next)
  } else {
    panel.params = next
  }
}

/** Mirror a whole collapsed map into every panel's params. */
function syncCollapsedToParams(api: DockviewApi, collapsed: Record<string, boolean>): void {
  for (const id of PANEL_IDS) {
    writePanelCollapsed(api, PANEL_META[id].component, collapsed[id] === true)
  }
}

/** Read the panel id out of a dockview panel's params. */
function panelIdFromParams(params: Record<string, unknown> | undefined): PanelId | undefined {
  const id = params?.panelId
  return typeof id === 'string' && id in PANEL_META ? (id as PanelId) : undefined
}

/** Initial collapsed map: config defaults, overlaid by any saved snapshot. */
function initCollapsed(config: PsPanelsConfig, persisted: PersistedLayout | null): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const id of PANEL_IDS) map[id] = false
  for (const id of config.collapsedPanels) map[id] = true
  if (persisted?.collapsed && typeof persisted.collapsed === 'object') {
    for (const [key, value] of Object.entries(persisted.collapsed)) {
      if (key in map) map[key] = value === true
    }
  }
  return map
}

/** Count floating panels for the badge. */
function floatingCount(api: DockviewApi | undefined): number {
  if (!api) return 0
  // DockviewApiLike is a structural subset of DockviewApi, so it passes directly.
  return readFloating(api).length
}

/** Track the viewport width and whether we are in the desktop range. */
function useDesktopViewport(minWidth: number): boolean {
  const read = useCallback((): boolean => {
    if (typeof window === 'undefined') return true
    return window.innerWidth >= minWidth
  }, [minWidth])
  const [desktop, setDesktop] = useState(read)
  useEffect(() => {
    setDesktop(read())
    if (typeof window === 'undefined') return
    const onChange = (): void => setDesktop(read())
    window.addEventListener('resize', onChange)
    window.addEventListener('orientationchange', onChange)
    return () => {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('orientationchange', onChange)
    }
  }, [read])
  return desktop
}

export interface PsFloatingPanelsAppProps {
  /** Translator from the plugin entry. */
  readonly t: Translate
  /** LIVE config source — settings edits re-render without a restart. */
  readonly configSource: ConfigSource
  /** Optional host bridge for layout persistence (ctx.config-backed). */
  readonly host?: LayoutHostBridge
  /** Boot-time conflicts discovered by the plugin entry (rendered as a dialog). */
  readonly conflicts?: readonly ConflictEntry[]
}

/**
 * The panel system root. Mounted once into `shell.overlay` by the plugin entry.
 */
export function PsFloatingPanelsApp({ t, configSource, host, conflicts = [] }: PsFloatingPanelsAppProps): ReactElement | null {
  // Subscribe to the live config: a `showStatusBadge`/`enabled`/width edit
  // re-renders immediately (requirement: no restart). `config` below is the
  // current snapshot on every render.
  const config: PsPanelsConfig = useSyncExternalStore(
    useCallback((cb) => configSource.subscribe(cb), [configSource]),
    () => configSource.getSnapshot(),
    () => configSource.getSnapshot(),
  )
  const isDesktop = useDesktopViewport(config.minDesktopWidth)
  const apiRef = useRef<DockviewApi | null>(null)
  const dirtyRef = useRef(false)
  const collapsedRef = useRef<Record<string, boolean>>({})

  const persistence = useMemo<LayoutPersistence>(() => createLayoutPersistence({
    api: () => apiRef.current ?? undefined,
    host,
    debounceMs: config.persistDebounceMs,
  }), [host, config.persistDebounceMs])

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => initCollapsed(config, persistence.loadLocal()))
  collapsedRef.current = collapsed

  const [plateFloating, setPlateFloating] = useState(0)
  const [conflictDismissed, setConflictDismissed] = useState(false)
  const [replacedHostMain, setReplacedHostMain] = useState(false)

  const components = useMemo(() => buildDockviewComponents(), [])

  /** Refresh badge counts after any layout mutation. */
  const refreshDerived = useCallback((): void => {
    setPlateFloating(floatingCount(apiRef.current ?? undefined))
  }, [])

  /** Persist a layout change (debounced) unless nothing has changed yet. */
  const onLayoutChanged = useCallback((): void => {
    refreshDerived()
    dirtyRef.current = true
    persistence.scheduleSave()
  }, [persistence, refreshDerived])

  /** Dockview ready: restore the saved layout (or the default split) and wire events. */
  const onReady = useCallback((event: { api: DockviewApi }): void => {
    const api = event.api
    apiRef.current = api

    // Local snapshot first (synchronous), then a host snapshot if it is newer.
    const local = persistence.loadLocal()
    applyLayout(api as unknown as Parameters<typeof applyLayout>[0], local)
    syncCollapsedToParams(api, collapsedRef.current)

    void persistence.load().then((remote) => {
      if (!remote || dirtyRef.current) return
      const localStamp = local?.updatedAt ?? 0
      if (remote.updatedAt > localStamp) {
        applyLayout(api as unknown as Parameters<typeof applyLayout>[0], remote)
        const next = initCollapsed(config, remote)
        collapsedRef.current = next
        setCollapsed(next)
        syncCollapsedToParams(api, next)
        refreshDerived()
      }
    })

    api.onDidLayoutChange(onLayoutChanged)
    const addSub = (api as unknown as { onDidAddPanel?: (fn: () => void) => { dispose?: () => void } }).onDidAddPanel
    if (typeof addSub === 'function') {
      addSub.call(api, () => syncCollapsedToParams(api, collapsedRef.current))
    }
    refreshDerived()
  }, [persistence, config, onLayoutChanged, refreshDerived])

  /** Flip a panel's collapsed flag and mirror it into Dockview params. */
  const toggleCollapse = useCallback((panelId: PanelId): void => {
    const next = { ...collapsedRef.current, [panelId]: !collapsedRef.current[panelId] }
    collapsedRef.current = next
    setCollapsed(next)
    const api = apiRef.current
    if (api) writePanelCollapsed(api, PANEL_META[panelId].component, next[panelId])
    dirtyRef.current = true
    persistence.scheduleSave()
  }, [persistence])

  /** Reset: default split layout, every panel expanded, snapshot rewritten. */
  const resetLayout = useCallback((): void => {
    const next: Record<string, boolean> = {}
    for (const id of PANEL_IDS) next[id] = false
    collapsedRef.current = next
    setCollapsed(next)
    persistence.reset()
    dirtyRef.current = true
    refreshDerived()
  }, [persistence, refreshDerived])

  /** Expand every panel without touching the grid. */
  const expandAll = useCallback((): void => {
    const next: Record<string, boolean> = {}
    for (const id of PANEL_IDS) next[id] = false
    collapsedRef.current = next
    setCollapsed(next)
    const api = apiRef.current
    if (api) syncCollapsedToParams(api, next)
    dirtyRef.current = true
    persistence.scheduleSave()
  }, [persistence])

  // Best-effort "replace" mode: hide the host's main region while the split is
  // active, and restore it on cleanup. Overlay mode (default) never touches it.
  useEffect(() => {
    if (!isDesktop || !config.enabled || config.layoutMode !== 'replace') return
    if (typeof document === 'undefined') return
    const main = document.querySelector('main')
    if (!(main instanceof HTMLElement)) return
    const previous = main.getAttribute('data-ps-replaced')
    main.setAttribute('data-ps-replaced', 'true')
    setReplacedHostMain(true)
    return () => {
      if (previous === null) main.removeAttribute('data-ps-replaced')
      else main.setAttribute('data-ps-replaced', previous)
      setReplacedHostMain(false)
    }
  }, [isDesktop, config.enabled, config.layoutMode])

  // Hard gates: disabled, or a mobile viewport → render nothing at all.
  if (!config.enabled) return null
  if (!isDesktop) return null

  const ctx: PsPanelsContextValue = { t, collapsed, toggleCollapse }
  const collapsedCount = PANEL_IDS.filter((id) => collapsed[id] === true).length

  return (
    <div
      className="ps-floating-root"
      data-ps-floating-panels="true"
      data-layout-mode={config.layoutMode}
      data-host-main-replaced={replacedHostMain ? 'true' : undefined}
    >
      <PsPanelsProvider value={ctx}>
        <section className="ps-dock-shell" aria-label={t('ui.launcher')}>
          <header className="ps-dock-toolbar">
            <span className="ps-dock-toolbar__title">{t('ui.launcher')}</span>
            <span className="ps-dock-toolbar__hint" title={t('ui.dockHint')}>{t('ui.dockHint')}</span>
            <span className="ps-dock-toolbar__actions">
              {config.showLauncher ? (
                <>
                  <button type="button" className="ps-dock-btn" data-ps-action="expand-all" onClick={expandAll}>
                    {t('ui.showAll')}
                  </button>
                  <button type="button" className="ps-dock-btn" data-ps-action="reset" title={t('ui.resetTitle')} onClick={resetLayout}>
                    {t('ui.reset')}
                  </button>
                </>
              ) : null}
            </span>
          </header>
          <div className="ps-dock-surface">
            <DockviewReact
              components={components}
              defaultTabComponent={PsDefaultTab}
              onReady={onReady}
              floatingGroupBounds="boundedWithinViewport"
              disableFloatingGroups={false}
              dndStrategy="auto"
              proportionalLayout
            />
          </div>
        </section>
      </PsPanelsProvider>

      <StatusBadge
        show={config.showStatusBadge}
        panelCount={PANEL_IDS.length}
        collapsedCount={collapsedCount}
        floatingCount={plateFloating}
        t={t}
      />

      {!conflictDismissed ? (
        <ConflictDialog conflicts={conflicts} t={t} onDismiss={() => setConflictDismissed(true)} />
      ) : null}
    </div>
  )
}
