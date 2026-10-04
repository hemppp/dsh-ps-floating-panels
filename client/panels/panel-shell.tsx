/**
 * dsh-ps-floating-panels — shared panel shell.
 *
 * Every panel is the same shape now: a Dockview content component that reads
 * its native region id from Dockview params, resolves the live region from the
 * adoption store, and hands its body element to the adopter so the host's real
 * node is mounted there. This module owns that shared context plus the small
 * helpers the panel and the tab header both use, without importing a single
 * host type.
 *
 * @module dsh-ps-floating-panels/client/panels/panel-shell
 */

import { createContext, useContext, type ReactElement, type ReactNode } from 'react'
import type { NativeAdopter, NativeRegion } from '../native-regions.ts'

/** Translator signature (mirrors locales.ts, kept local to avoid a cycle). */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

/**
 * The subset of Dockview's `IDockviewPanelProps` a panel touches, typed
 * structurally so this file never imports `dockview` at runtime. Dockview hands
 * the real object; we only read `params.regionId` / `params.collapsed`.
 */
export interface DockviewPanelPropsLike {
  readonly api?: { readonly id?: string; readonly title?: string }
  readonly params?: { readonly regionId?: string; readonly collapsed?: boolean } & Record<string, unknown>
  readonly containerApi?: unknown
}

/** Context value shared by every panel and the tab header. */
export interface PsPanelsContextValue {
  readonly t: Translate
  /** Live collapsed flags keyed by region id (source of truth for rendering). */
  readonly collapsed: Readonly<Record<string, boolean>>
  /** Flip a panel's collapsed flag (also mirrors it into Dockview params). */
  readonly toggleCollapse: (regionId: string) => void
  /** Regions as of the last scan. */
  readonly regions: readonly NativeRegion[]
  /** The live region for an id, if the host still exposes it. */
  readonly regionOf: (regionId: string) => NativeRegion | undefined
  /** Native adoption engine (null when the host has no adoptable shell). */
  readonly adopter: NativeAdopter | null
}

const PsPanelsContext = createContext<PsPanelsContextValue | null>(null)

/** Identity translator used when a panel is rendered outside the provider. */
const identity: Translate = (key) => key

const EMPTY_CONTEXT: PsPanelsContextValue = {
  t: identity,
  collapsed: {},
  toggleCollapse: () => {},
  regions: [],
  regionOf: () => undefined,
  adopter: null,
}

export interface PsPanelsProviderProps {
  value: PsPanelsContextValue
  children: ReactNode
}

/** Provide the panel context around the Dockview tree. */
export function PsPanelsProvider({ value, children }: PsPanelsProviderProps): ReactElement {
  return <PsPanelsContext.Provider value={value}>{children}</PsPanelsContext.Provider>
}

/** Read the panel context; safe frills when unmounted (returns no-op values). */
export function usePsPanels(): PsPanelsContextValue {
  return useContext(PsPanelsContext) ?? EMPTY_CONTEXT
}

/** Resolve the region id from Dockview params (v2 key, then the v1 key). */
export function regionIdFromProps(props: DockviewPanelPropsLike): string | undefined {
  const value = props.params?.regionId ?? props.params?.panelId
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Is the panel collapsed? Prefer the live store, fall back to Dockview params. */
export function collapsedOf(ctx: PsPanelsContextValue, props: DockviewPanelPropsLike, regionId: string): boolean {
  if (Object.prototype.hasOwnProperty.call(ctx.collapsed, regionId)) return ctx.collapsed[regionId] === true
  return props.params?.collapsed === true
}
