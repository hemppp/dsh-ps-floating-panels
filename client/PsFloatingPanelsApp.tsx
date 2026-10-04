/**
 * dsh-ps-floating-panels — root component: the host's own UI, re-hosted in a
 * Photoshop-style split / floating panel system.
 *
 * This component does NOT draw any product surface of its own. It renders one
 * Dockview grid whose panels each hold a REAL piece of the DSH shell, taken
 * apart by {@link NativeAdopter} (see native-regions.ts) and revealed by
 * collapsing the now-empty native skeleton (see native-shell.ts):
 *
 * ```
 * ┌──────────┬────────────────────────┬──────────┐
 * │ sidebar  │  main (conversation)   │ pane A   │
 * │          │                        ├──────────┤
 * │          │                        │ pane B   │
 * └──────────┴────────────────────────┴──────────┘
 * ```
 *
 *  - Viewport gate: below `minDesktopWidth` nothing is adopted and nothing is
 *    rendered, so the native mobile layout stays untouched.
 *  - Dynamic panel set: the panels ARE the discovered regions. A region the host
 *    adds later (a new dockkit pane) gets a panel; a region the host closes
 *    loses it — a region can therefore never be stranded inside a hidden
 *    container.
 *  - Restore: the toolbar's "restore native layout" puts every real node back
 *    where it came from, un-collapses the shell and leaves a single pill to
 *    adopt again.
 *  - Persistence: `onDidLayoutChange` (debounced) → `toJSON()` → host bridge +
 *    local snapshot; the reset control restores the default split, expanded.
 *
 * @module dsh-ps-floating-panels/client/PsFloatingPanelsApp
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import { DockviewReact } from 'dockview-react'
import type { DockviewApi } from 'dockview'
import {
  NATIVE_COMPONENT,
  readNativeAdopted,
  writeNativeAdopted,
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
  regionIdOfParams,
  readFloating,
  type LayoutHostBridge,
  type LayoutPersistence,
} from './layout-persist.ts'
import { teardownNativeShell, type ShellTeardown } from './native-shell.ts'
import type { NativeAdopter, NativeRegion, QueryRoot } from './native-regions.ts'
import { StatusBadge } from './status-badge.tsx'
import { ConflictDialog } from './conflict-dialog.tsx'
import type { ConflictEntry } from './conflict-detect.ts'
import type { Translate } from './locales.ts'

/** Dockview panel shape this file pokes (params mirror the collapse flag). */
interface PanelWithParams {
  id?: string
  params?: Record<string, unknown>
  api?: {
    updateParameters?: (p: Record<string, unknown>) => void
    close?: () => void
  }
}

/** The subset of `DockviewApi` this file mutates panels through. */
interface PanelHost {
  panels?: readonly PanelWithParams[]
  getPanel?: (id: string) => PanelWithParams | undefined
  addPanel?: (options: Record<string, unknown>) => PanelWithParams | undefined
  removePanel?: (panel: PanelWithParams) => void
}

function panelsOf(api: DockviewApi): readonly PanelWithParams[] {
  return (api as unknown as PanelHost).panels ?? []
}

/** Dockview panel id for a discovered region (`params.regionId`). */
function panelRegionId(panel: PanelWithParams): PanelId | undefined {
  return panel.id ?? regionIdOfParams(panel.params)
}

/** Write the collapse flag into one panel so `toJSON()` carries it. */
function writePanelCollapsed(api: DockviewApi, regionId: PanelId, collapsed: boolean): void {
  const panel = (api as unknown as PanelHost).getPanel?.(regionId)
  if (!panel) return
  const next = { ...(panel.params ?? {}), regionId, collapsed }
  if (typeof panel.api?.updateParameters === 'function') panel.api.updateParameters(next)
  else panel.params = next
}

/** Mirror a whole collapsed map into every panel's params. */
function syncCollapsedToParams(api: DockviewApi, collapsed: Readonly<Record<string, boolean>>): void {
  for (const panel of panelsOf(api)) {
    const regionId = panelRegionId(panel)
    if (regionId !== undefined) writePanelCollapsed(api, regionId, collapsed[regionId] === true)
  }
}

/** Initial collapsed map: config defaults, overlaid by any saved snapshot. */
function initCollapsed(
  regions: readonly NativeRegion[],
  config: PsPanelsConfig,
  persisted: PersistedLayout | null,
): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const region of regions) map[region.id] = false
  for (const id of config.collapsedPanels) map[id] = true
  if (persisted?.collapsed && typeof persisted.collapsed === 'object') {
    for (const [key, value] of Object.entries(persisted.collapsed)) {
      map[key] = value === true
    }
  }
  return map
}

/**
 * Make the panel set agree with the discovered regions: a region without a
 * panel gets one (next to its own column when possible), and a panel whose
 * region the host removed is closed. Without this, a region would either be
 * invisible or be hidden inside the collapsed skeleton with nowhere to live.
 */
function syncPanels(
  api: DockviewApi,
  regions: readonly NativeRegion[],
  collapsed: Readonly<Record<string, boolean>>,
): void {
  if (regions.length === 0) return
  const host = api as unknown as PanelHost
  const existing = new Map<string, PanelWithParams>()
  for (const panel of panelsOf(api)) {
    const regionId = panelRegionId(panel)
    if (regionId !== undefined) existing.set(regionId, panel)
  }

  for (const [regionId, panel] of [...existing]) {
    if (regions.some((region) => region.id === regionId)) continue
    existing.delete(regionId)
    try {
      if (typeof host.removePanel === 'function') host.removePanel(panel)
      else panel.api?.close?.()
    } catch (error) {
      console.warn(`[dsh-ps-floating-panels] closing the panel for a gone region failed (${regionId})`, error)
    }
  }

  for (const region of regions) {
    if (existing.has(region.id)) continue
    const sameColumn = regions.find((other) => other.column === region.column && existing.has(other.id))
    const reference = sameColumn?.id ?? existing.keys().next().value
    try {
      const added = host.addPanel?.({
        id: region.id,
        component: NATIVE_COMPONENT,
        title: region.title,
        params: { regionId: region.id, collapsed: collapsed[region.id] === true },
        position: reference === undefined
          ? undefined
          : { referencePanel: reference, direction: sameColumn === undefined ? 'right' : 'within' },
      }) as PanelWithParams | undefined
      if (added !== undefined && added !== null) existing.set(region.id, added)
    } catch (error) {
      console.warn(`[dsh-ps-floating-panels] adding a panel for a new region failed (${region.id})`, error)
    }
  }
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
  /** Discovery + adoption engine shared with the plugin entry / page bridge. */
  readonly adopter: NativeAdopter
  /** Optional host bridge for layout persistence (ctx.config-backed). */
  readonly host?: LayoutHostBridge
  /** Boot-time conflicts discovered by the plugin entry (rendered as a dialog). */
  readonly conflicts?: readonly ConflictEntry[]
}

/**
 * The panel system root. Mounted once into `shell.overlay` by the plugin entry.
 */
export function PsFloatingPanelsApp({ t, configSource, adopter, host, conflicts = [] }: PsFloatingPanelsAppProps): ReactElement | null {
  const config: PsPanelsConfig = useSyncExternalStore(
    useCallback((cb) => configSource.subscribe(cb), [configSource]),
    () => configSource.getSnapshot(),
    () => configSource.getSnapshot(),
  )
  const regions = useSyncExternalStore(
    useCallback((cb) => adopter.subscribe(cb), [adopter]),
    () => adopter.regions(),
    () => adopter.regions(),
  )
  const isDesktop = useDesktopViewport(config.minDesktopWidth)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<DockviewApi | null>(null)
  const dirtyRef = useRef(false)
  const collapsedRef = useRef<Record<string, boolean>>({})
  const regionsRef = useRef<readonly NativeRegion[]>(regions)
  regionsRef.current = regions

  const [dockReady, setDockReady] = useState(false)
  const [adopted, setAdopted] = useState<boolean>(() => config.nativeAdopt && readNativeAdopted())
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => initCollapsed(regions, config, null))
  collapsedRef.current = collapsed
  const [plateFloating, setPlateFloating] = useState(0)
  const [conflictDismissed, setConflictDismissed] = useState(false)

  const components = useMemo(() => buildDockviewComponents(), [])

  const persistence = useMemo<LayoutPersistence>(() => createLayoutPersistence({
    api: () => apiRef.current ?? undefined,
    regions: () => regionsRef.current.map((region) => ({ id: region.id, title: region.title, column: region.column })),
    host,
    debounceMs: config.persistDebounceMs,
  }), [host, config.persistDebounceMs])

  const setAdoptedPersisted = useCallback((next: boolean): void => {
    setAdopted(next)
    writeNativeAdopted(next)
  }, [])

  /** A settings edit can switch the mode off under us. */
  useEffect(() => {
    if (!config.nativeAdopt) setAdopted(false)
  }, [config.nativeAdopt])

  /** First sync of the panel set with the discovered regions. */
  useEffect(() => {
    const seeded = initCollapsed(regions, config, persistence.loadLocal())
    collapsedRef.current = { ...seeded, ...collapsedRef.current }
    setCollapsed(collapsedRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the region set matters here
  }, [regions])

  /** Keep the panel set in step with regions the host adds/removes later. */
  useEffect(() => {
    const api = apiRef.current
    if (!api || !dockReady) return
    syncPanels(api, regions, collapsedRef.current)
    setPlateFloating(floatingCount(apiRef.current ?? undefined))
  }, [regions, dockReady])

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

    const local = persistence.loadLocal()
    applyLayout(
      api as unknown as Parameters<typeof applyLayout>[0],
      local,
      regionsRef.current.map((region) => ({ id: region.id, title: region.title, column: region.column })),
    )
    if (local === null || local.version !== 2) {
      const seeded = initCollapsed(regionsRef.current, config, local)
      collapsedRef.current = seeded
      setCollapsed(seeded)
    } else {
      const seeded = initCollapsed(regionsRef.current, config, local)
      collapsedRef.current = { ...seeded, ...local.collapsed, ...collapsedRef.current }
      setCollapsed(collapsedRef.current)
    }
    syncCollapsedToParams(api, collapsedRef.current)
    syncPanels(api, regionsRef.current, collapsedRef.current)

    void persistence.load().then((remote) => {
      if (!remote || dirtyRef.current) return
      const localStamp = local?.updatedAt ?? 0
      if (remote.updatedAt > localStamp) {
        applyLayout(
          api as unknown as Parameters<typeof applyLayout>[0],
          remote,
          regionsRef.current.map((region) => ({ id: region.id, title: region.title, column: region.column })),
        )
        const next = { ...initCollapsed(regionsRef.current, config, remote), ...remote.collapsed }
        collapsedRef.current = next
        setCollapsed(next)
        syncCollapsedToParams(api, next)
        syncPanels(api, regionsRef.current, next)
        refreshDerived()
      }
    })

    api.onDidLayoutChange(onLayoutChanged)
    const addSub = (api as unknown as { onDidAddPanel?: (fn: () => void) => { dispose?: () => void } }).onDidAddPanel
    if (typeof addSub === 'function') {
      addSub.call(api, () => syncCollapsedToParams(api, collapsedRef.current))
    }
    setDockReady(true)
    refreshDerived()
  }, [persistence, config, onLayoutChanged, refreshDerived])

  /** Flip a panel's collapsed flag and mirror it into Dockview params. */
  const toggleCollapse = useCallback((regionId: PanelId): void => {
    const next = { ...collapsedRef.current, [regionId]: !collapsedRef.current[regionId] }
    collapsedRef.current = next
    setCollapsed(next)
    const api = apiRef.current
    if (api) writePanelCollapsed(api, regionId, next[regionId])
    dirtyRef.current = true
    persistence.scheduleSave()
  }, [persistence])

  /** Reset: default split layout, every panel expanded, snapshot rewritten. */
  const resetLayout = useCallback((): void => {
    const next: Record<string, boolean> = {}
    for (const region of regionsRef.current) next[region.id] = false
    collapsedRef.current = next
    setCollapsed(next)
    persistence.reset()
    const api = apiRef.current
    if (api) syncCollapsedToParams(api, next)
    dirtyRef.current = true
    refreshDerived()
  }, [persistence, refreshDerived])

  /** Expand every panel without touching the grid. */
  const expandAll = useCallback((): void => {
    const next: Record<string, boolean> = {}
    for (const region of regionsRef.current) next[region.id] = false
    collapsedRef.current = next
    setCollapsed(next)
    const api = apiRef.current
    if (api) syncCollapsedToParams(api, next)
    dirtyRef.current = true
    persistence.scheduleSave()
  }, [persistence])

  /** Ask the host for new regions (e.g. a pane opened since we scanned). */
  const rescan = useCallback((): void => {
    adopter.refresh()
  }, [adopter])

  /** Put every real node back and leave the native layout exactly as it was. */
  const restoreNative = useCallback((): void => {
    setAdoptedPersisted(false)
  }, [setAdoptedPersisted])

  // Collapse the empty native skeleton only while we are actually hosting the
  // real regions. Nothing is hidden until at least one region was adopted, so a
  // failed adoption can never make the host's UI disappear.
  useEffect(() => {
    const active = adopted && isDesktop && config.enabled && dockReady
    if (!active || typeof document === 'undefined') return
    if (regions.length > 0 && adopter.adopted().length === 0) return
    const teardown = teardownNativeShell(document as unknown as QueryRoot, rootRef.current)
    return () => teardown?.restore()
  }, [adopted, isDesktop, config.enabled, dockReady, regions, adopter])

  // Hard gates: disabled, or a mobile viewport → render nothing at all.
  if (!config.enabled) return null
  if (!isDesktop) return null

  const ctx: PsPanelsContextValue = {
    t,
    collapsed,
    toggleCollapse,
    regions,
    regionOf: (regionId) => adopter.region(regionId),
    adopter,
  }
  const collapsedCount = regions.filter((region) => collapsed[region.id] === true).length

  return (
    <div
      className="ps-floating-root"
      data-ps-floating-panels="true"
      data-native={adopted ? 'adopted' : 'restored'}
      ref={rootRef}
    >
      <PsPanelsProvider value={ctx}>
        {adopted ? (
          <section className="ps-dock-shell" aria-label={t('ui.launcher')}>
            <header className="ps-dock-toolbar">
              <span className="ps-dock-toolbar__title">
                {t('ui.launcher')} · {t('status.panelCount', { n: regions.length })}
              </span>
              <span className="ps-dock-toolbar__hint" title={t('ui.dockHint')}>{t('ui.dockHint')}</span>
              <span className="ps-dock-toolbar__actions">
                {config.showLauncher ? (
                  <>
                    <button type="button" className="ps-dock-btn" data-ps-action="rescan" title={t('ui.rescanTitle')} onClick={rescan}>
                      {t('ui.rescan')}
                    </button>
                    <button type="button" className="ps-dock-btn" data-ps-action="expand-all" onClick={expandAll}>
                      {t('ui.showAll')}
                    </button>
                    <button type="button" className="ps-dock-btn" data-ps-action="reset" title={t('ui.resetTitle')} onClick={resetLayout}>
                      {t('ui.reset')}
                    </button>
                    <button
                      type="button"
                      className="ps-dock-btn"
                      data-ps-action="restore-native"
                      title={t('ui.restoreNativeTitle')}
                      onClick={restoreNative}
                    >
                      {t('ui.restoreNative')}
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
        ) : (
          <button
            type="button"
            className="ps-launcher-pill"
            data-ps-action="adopt-native"
            title={t('ui.adoptNativeTitle')}
            onClick={() => setAdoptedPersisted(true)}
          >
            {t('ui.adoptNative')}
          </button>
        )}
      </PsPanelsProvider>

      {adopted ? (
        <StatusBadge
          show={config.showStatusBadge}
          panelCount={regions.length}
          collapsedCount={collapsedCount}
          floatingCount={plateFloating}
          t={t}
        />
      ) : null}

      {!conflictDismissed ? (
        <ConflictDialog conflicts={conflicts} t={t} onDismiss={() => setConflictDismissed(true)} />
      ) : null}
    </div>
  )
}
