/**
 * dsh-ps-floating-panels — native DSH UI discovery + adoption.
 *
 * The plugin does NOT re-implement the shell. It takes the host's own UI apart
 * and re-hosts the real nodes inside its floating panels:
 *
 *  - the three structural columns of the shell are React *slot outlets*:
 *    `renderSlot(key)` renders `<div data-slot="key" style="display:contents">`,
 *    so the outlet wrapper (and with it the whole real region) is a movable,
 *    addressable node;
 *  - the right column is the host's own dockkit dock host, whose panes carry
 *    `data-dockkit-pane` / `data-dockkit-float` (the pane id) and expose their
 *    label through the pane's own selected tab (`[role="tab"][aria-selected]`)
 *    or `[data-dockkit-float-title]`.
 *
 * Adoption is a booked move: `attach()` remembers the element's original parent
 * and next sibling before moving it into a panel body, and `detach()` puts it
 * back. Every step is reversible, because a wrong move must never be able to
 * strand the host's UI inside a plugin.
 *
 * The module is DOM-injected (`QueryRoot`) rather than reaching for globals, so
 * the discovery/adoption rules are unit-testable without a browser.
 *
 * @module dsh-ps-floating-panels/client/native-regions
 */

/* ------------------------------------------------------------------------- *
 * Contract
 * ------------------------------------------------------------------------- */

/** Where a region belongs in the default split layout. */
export type RegionColumn = 'left' | 'center' | 'right'

/** What kind of host surface a region is. */
export type RegionKind = 'slot' | 'pane'

/** One adoptable piece of the host UI. */
export interface NativeRegion {
  /** Stable plugin-side id (`slot-sidebar`, `pane-files`, …). */
  readonly id: string
  readonly kind: RegionKind
  readonly column: RegionColumn
  /** Human title: our locale copy for slots, the host's own tab label for panes. */
  readonly title: string
  /** Slot key for `kind === 'slot'`. */
  readonly slotKey?: string
  /** dockkit pane id for `kind === 'pane'`. */
  readonly paneId?: string
}

/** The read-only slice of `Document`/`Element` this module needs. */
export interface QueryRoot {
  querySelector(selectors: string): Element | null
  querySelectorAll(selectors: string): ArrayLike<Element>
}

/* ------------------------------------------------------------------------- *
 * Selectors (the host's own public-ish DOM contract)
 * ------------------------------------------------------------------------- */

/** Slot keys of the structural columns we take apart. */
export const SIDEBAR_SLOT = 'sidebar'
export const MAIN_SLOT = 'main'
export const RIGHTBAR_SLOT = 'rightbar'

/** Slot outlet wrapper for one key. */
export function slotSelector(slotKey: string): string {
  return `[data-slot="${slotKey}"]`
}

/** The right column, which hosts the dockkit panes. */
export const RIGHTBAR_SELECTOR = slotSelector(RIGHTBAR_SLOT)

/** Every dockkit pane (docked or floating). */
export const PANE_SELECTOR = '[data-dockkit-pane], [data-dockkit-float]'

/** The shell overlay layer (`shell.overlay`), i.e. where this plugin lives. */
export const OVERLAY_LAYER_SELECTOR = '[data-shell-overlay]'

/** This plugin's own root, used as a cycle guard. */
export const SELF_ROOT_SELECTOR = '[data-ps-floating-panels]'

/** Marker written onto an adopted node (styling + diagnosis). */
export const ADOPTED_ATTR = 'data-ps-adopted'

/* ------------------------------------------------------------------------- *
 * Ids + titles
 * ------------------------------------------------------------------------- */

/** Make a DOM-ish string safe to use as a Dockview panel id. */
function slug(value: string): string {
  const slugged = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return slugged.length > 0 ? slugged : 'x'
}

/** Panel id for a structural slot region. */
export function regionIdForSlot(slotKey: string): string {
  return `slot-${slug(slotKey)}`
}

/** Panel id for a dockkit pane region. */
export function regionIdForPane(paneId: string): string {
  return `pane-${slug(paneId)}`
}

/** Longest title we keep before truncating a host label. */
const TITLE_MAX = 40

/** Collapse whitespace and cap length; returns undefined for empty labels. */
function normalizeTitle(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text.length === 0) return undefined
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text
}

/** Read the host's own label for a dockkit pane. */
export function readPaneTitle(element: Element | null | undefined): string | undefined {
  if (!element) return undefined
  return normalizeTitle(element.querySelector('[data-dockkit-float-title]')?.textContent)
    ?? normalizeTitle(element.querySelector('[role="tab"][aria-selected="true"]')?.textContent)
    ?? normalizeTitle(element.querySelector('[role="tab"]')?.textContent)
}

/** Read the pane id out of a dockkit pane element. */
export function readPaneId(element: Element): string | undefined {
  const id = element.getAttribute('data-dockkit-pane') ?? element.getAttribute('data-dockkit-float')
  return id !== null && id.length > 0 ? id : undefined
}

/* ------------------------------------------------------------------------- *
 * Discovery
 * ------------------------------------------------------------------------- */

/** Titles supplied by the plugin's own locale for the two structural slots. */
export interface RegionTitles {
  sidebar: string
  main: string
}

const DEFAULT_TITLES: RegionTitles = { sidebar: 'Sidebar', main: 'Main' }

/**
 * Enumerate every region the host currently exposes.
 *
 * Purely a read: nothing is moved here. Panes are deduplicated by pane id and
 * panes are NOT filtered by visibility, because an inactive dockkit pane is
 * still a pane the user asked to see in its own panel.
 */
export function discoverRegions(doc: QueryRoot | undefined, titles: RegionTitles = DEFAULT_TITLES): NativeRegion[] {
  if (!doc) return []
  const out: NativeRegion[] = []
  try {
    if (doc.querySelector(slotSelector(SIDEBAR_SLOT))) {
      out.push({ id: regionIdForSlot(SIDEBAR_SLOT), kind: 'slot', column: 'left', title: titles.sidebar, slotKey: SIDEBAR_SLOT })
    }
    if (doc.querySelector(slotSelector(MAIN_SLOT))) {
      out.push({ id: regionIdForSlot(MAIN_SLOT), kind: 'slot', column: 'center', title: titles.main, slotKey: MAIN_SLOT })
    }
    const rightbar = doc.querySelector(RIGHTBAR_SELECTOR)
    if (rightbar) {
      const seen = new Set<string>()
      for (const element of Array.from(rightbar.querySelectorAll(PANE_SELECTOR))) {
        const paneId = readPaneId(element)
        if (paneId === undefined || seen.has(paneId)) continue
        seen.add(paneId)
        out.push({
          id: regionIdForPane(paneId),
          kind: 'pane',
          column: 'right',
          title: readPaneTitle(element) ?? paneId,
          paneId,
        })
      }
    }
  } catch (error) {
    console.warn('[dsh-ps-floating-panels] native region discovery failed', error)
  }
  return out
}

/** Re-resolve the live element for a region (the host may rebuild it). */
export function resolveRegionElement(doc: QueryRoot | undefined, region: NativeRegion): Element | null {
  if (!doc) return null
  try {
    if (region.kind === 'slot' && region.slotKey !== undefined) {
      return doc.querySelector(slotSelector(region.slotKey))
    }
    if (region.kind === 'pane' && region.paneId !== undefined) {
      const scope = doc.querySelector(RIGHTBAR_SELECTOR) ?? doc
      for (const element of Array.from(scope.querySelectorAll(PANE_SELECTOR))) {
        if (readPaneId(element) === region.paneId) return element
      }
    }
  } catch (error) {
    console.warn('[dsh-ps-floating-panels] native region resolve failed', error)
  }
  return null
}

/** Cheap identity of the current region set, for change detection. */
export function regionSignature(regions: readonly NativeRegion[]): string {
  return regions.map((region) => `${region.id}@${region.title}`).join('|')
}

/* ------------------------------------------------------------------------- *
 * Adoption
 * ------------------------------------------------------------------------- */

interface Adoption {
  element: Element
  /** Where the element lived before we took it. */
  readonly parent: Node | null
  readonly next: Node | null
  /** Panel body currently hosting the element. */
  container: Element
}

/** Public adoption surface used by the panels, the bridge and the tests. */
export interface NativeAdopter {
  /** Regions as of the last scan. A new array only when something changed. */
  regions(): readonly NativeRegion[]
  /** The region with this id, if the host still exposes it. */
  region(regionId: string): NativeRegion | undefined
  /** Notify when the region set changes (or an adopted node was rebuilt). */
  subscribe(listener: () => void): () => void
  /** Live element for a region, whether or not it is adopted. */
  element(regionId: string): Element | null
  /** Move the region's element into `container`. False when unavailable. */
  attach(regionId: string, container: Element): boolean
  /** Put the region's element back where it came from. */
  detach(regionId: string): void
  /** Release every adoption (the "restore native layout" path). */
  detachAll(): void
  /** Ids currently adopted. */
  adopted(): readonly string[]
  /** Adopt a live scan now. */
  refresh(): void
  /** Begin observing the host for rebuilds / new panes. */
  start(): void
  /** Stop observing and release nothing (panels detach themselves). */
  stop(): void
}

export interface NativeAdopterOptions {
  /** Locale titles for the structural slots. */
  titles?: RegionTitles
  /** Throttle for the mutation-driven rescan (ms). */
  rescanThrottleMs?: number
  /** Interval fallback for hosts where a MutationObserver is unavailable. */
  rescanIntervalMs?: number
  /** Set false in tests to run without observers. */
  observe?: boolean
}

/**
 * Create the adopter. Nothing happens until {@link NativeAdopter.start} or
 * {@link NativeAdopter.refresh} runs.
 */
export function createNativeAdopter(doc: QueryRoot | undefined, options: NativeAdopterOptions = {}): NativeAdopter {
  const titles = options.titles ?? DEFAULT_TITLES
  const throttleMs = options.rescanThrottleMs ?? 400
  const intervalMs = options.rescanIntervalMs ?? 2500
  const observe = options.observe !== false
  const adoptions = new Map<string, Adoption>()
  const listeners = new Set<() => void>()
  let regions: readonly NativeRegion[] = []
  let byId = new Map<string, NativeRegion>()
  let signature = ''
  let started = false
  let observer: MutationObserver | undefined
  let interval: ReturnType<typeof setInterval> | undefined
  let throttle: ReturnType<typeof setTimeout> | undefined

  const selfRoot = (): Element | null => {
    try {
      return doc?.querySelector(SELF_ROOT_SELECTOR) ?? null
    } catch {
      return null
    }
  }

  /** Never adopt a node that already contains our own tree (would nest us). */
  const isUnsafe = (element: Element): boolean => {
    const root = selfRoot()
    if (root === null) return false
    return element === root || element.contains(root)
  }

  const mark = (element: Element, regionId: string): void => {
    try {
      element.setAttribute(ADOPTED_ATTR, regionId)
    } catch {
      /* exotic element — styling only */
    }
  }

  const unmark = (element: Element): void => {
    try {
      element.removeAttribute(ADOPTED_ATTR)
    } catch {
      /* ignore */
    }
  }

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        console.warn('[dsh-ps-floating-panels] native region listener failed', error)
      }
    }
  }

  const refresh = (): void => {
    const next = discoverRegions(doc, titles)
    const nextSignature = regionSignature(next)
    let changed = nextSignature !== signature
    regions = next
    signature = nextSignature
    byId = new Map(next.map((region) => [region.id, region]))

    for (const [regionId, record] of [...adoptions]) {
      const region = byId.get(regionId)
      const live = region === undefined ? null : resolveRegionElement(doc, region)
      if (live === null) {
        // The host removed the region: forget it, leave the node alone.
        adoptions.delete(regionId)
        changed = true
        continue
      }
      if (live !== record.element) {
        // The host rebuilt the node: drop the stale booking so the panel can
        // re-attach to the live one (its effect re-runs on the notify below).
        unmark(record.element)
        adoptions.delete(regionId)
        changed = true
        continue
      }
      if (live.parentNode !== record.container) {
        // The host re-inserted the node behind our back: take it back.
        try {
          mark(live, regionId)
          record.container.replaceChildren(live)
          changed = true
        } catch (error) {
          console.warn('[dsh-ps-floating-panels] re-adopting a native region failed', error)
        }
      }
    }

    if (changed) notify()
  }

  const scheduleRefresh = (): void => {
    if (throttle !== undefined) return
    throttle = setTimeout(() => {
      throttle = undefined
      try {
        refresh()
      } catch (error) {
        console.warn('[dsh-ps-floating-panels] native rescan failed', error)
      }
    }, throttleMs)
  }

  const element = (regionId: string): Element | null => {
    const record = adoptions.get(regionId)
    if (record !== undefined && record.element.isConnected) return record.element
    const region = byId.get(regionId)
    return region === undefined ? null : resolveRegionElement(doc, region)
  }

  const attach = (regionId: string, container: Element): boolean => {
    const region = byId.get(regionId)
    if (region === undefined) return false
    const live = resolveRegionElement(doc, region)
    if (live === null || isUnsafe(live)) return false

    const existing = adoptions.get(regionId)
    if (existing !== undefined && existing.element !== live) adoptions.delete(regionId)

    let record = adoptions.get(regionId)
    if (record === undefined) {
      record = { element: live, parent: live.parentNode, next: live.nextSibling, container }
      adoptions.set(regionId, record)
    }
    record.container = container
    if (live.parentNode !== container) {
      try {
        mark(live, regionId)
        container.replaceChildren(live)
      } catch (error) {
        console.warn('[dsh-ps-floating-panels] adopting a native region failed', error)
        adoptions.delete(regionId)
        return false
      }
    }
    return true
  }

  const detach = (regionId: string): void => {
    const record = adoptions.get(regionId)
    if (record === undefined) return
    adoptions.delete(regionId)
    const { element: node, parent, next } = record
    unmark(node)
    if (parent === null || !parent.isConnected) return
    try {
      if (next !== null && next.parentNode === parent) parent.insertBefore(node, next)
      else parent.appendChild(node)
    } catch (error) {
      console.warn('[dsh-ps-floating-panels] restoring a native region failed', error)
    }
  }

  const detachAll = (): void => {
    for (const regionId of [...adoptions.keys()].reverse()) detach(regionId)
  }

  const start = (): void => {
    if (started) return
    started = true
    refresh()
    if (!observe) return
    try {
      if (typeof MutationObserver === 'function' && doc !== undefined) {
        const target = (doc as unknown as { documentElement?: Node }).documentElement ?? (doc as unknown as Node)
        observer = new MutationObserver(scheduleRefresh)
        observer.observe(target, { childList: true, subtree: true })
      }
    } catch (error) {
      console.warn('[dsh-ps-floating-panels] native region observer unavailable', error)
    }
    interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden === true) return
      try {
        refresh()
      } catch (error) {
        console.warn('[dsh-ps-floating-panels] native rescan failed', error)
      }
    }, intervalMs)
  }

  const stop = (): void => {
    started = false
    observer?.disconnect()
    observer = undefined
    if (interval !== undefined) clearInterval(interval)
    interval = undefined
    if (throttle !== undefined) clearTimeout(throttle)
    throttle = undefined
  }

  return {
    regions: () => regions,
    region: (regionId) => byId.get(regionId),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    element,
    attach,
    detach,
    detachAll,
    adopted: () => [...adoptions.keys()],
    refresh,
    start,
    stop,
  }
}

/* ------------------------------------------------------------------------- *
 * Page bridge
 * ------------------------------------------------------------------------- */

/**
 * Global the plugin itself publishes its adoption surface on.
 *
 * Note the direction: the HOST does not provide this bridge (app.asar contains
 * no `__DSH_NATIVE_PANELS__` reference at all). This plugin owns the bridge, so
 * page diagnostics and any other consumer can enumerate the regions it adopted
 * and hand a region back to its original parent at any time.
 *
 * ```ts
 * window.__DSH_NATIVE_PANELS__ = {
 *   version: 1,
 *   plugin: 'dsh-ps-floating-panels',
 *   list(): { id, title, kind }[],
 *   getElement(regionId): Element | null,        // the live host node
 *   subscribe(onChange): () => void,
 *   adopt(regionId, container): boolean,          // move it into a container
 *   release(regionId): void,                      // put it back
 *   releaseAll(): void,
 * }
 * ```
 */
export const NATIVE_PANELS_GLOBAL = '__DSH_NATIVE_PANELS__'

/** Shape published on {@link NATIVE_PANELS_GLOBAL}. */
export interface NativePanelsBridge {
  readonly version: 1
  readonly plugin: string
  list(): readonly { id: string; title: string; kind: RegionKind }[]
  getElement(regionId: string): Element | null
  subscribe(listener: () => void): () => void
  adopt(regionId: string, container: Element): boolean
  release(regionId: string): void
  releaseAll(): void
}

/**
 * Publish the adoption surface for diagnostics and for any other consumer.
 *
 * @returns a disposer that removes the global (only when it is still ours).
 */
export function installNativePanelsBridge(win: unknown, adopter: NativeAdopter): () => void {
  if (!win || typeof win !== 'object') return () => {}
  const bridge: NativePanelsBridge = {
    version: 1,
    plugin: 'dsh-ps-floating-panels',
    list: () => adopter.regions().map((region) => ({ id: region.id, title: region.title, kind: region.kind })),
    getElement: (regionId) => adopter.element(regionId),
    subscribe: (listener) => adopter.subscribe(listener),
    adopt: (regionId, container) => adopter.attach(regionId, container),
    release: (regionId) => adopter.detach(regionId),
    releaseAll: () => adopter.detachAll(),
  }
  try {
    ;(win as Record<string, unknown>)[NATIVE_PANELS_GLOBAL] = bridge
  } catch (error) {
    console.warn('[dsh-ps-floating-panels] native bridge not publishable', error)
    return () => {}
  }
  return () => {
    try {
      const target = win as Record<string, unknown>
      if (target[NATIVE_PANELS_GLOBAL] === bridge) delete target[NATIVE_PANELS_GLOBAL]
    } catch {
      /* ignore */
    }
  }
}
