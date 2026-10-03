/**
 * dsh-ps-floating-panels — shared panel shell.
 *
 * Every one of the seven panels is the same shape: a Dockview content
 * component that (a) reads its collapsed flag from the plugin store, and
 * (b) renders its native content through the portal proxy. This module owns
 * that shell plus the React context that threads the translator and collapse
 * store down to every panel without importing a single host type.
 *
 * @module dsh-ps-floating-panels/client/panels/panel-shell
 */

import { createContext, useContext, type ReactElement, type ReactNode } from 'react'
import { PortalPanel } from '../portal-proxy.tsx'
import type { PanelId } from '../config.ts'

/** Translator signature (mirrors locales.ts, kept local to avoid a cycle). */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

/**
 * The subset of Dockview's `IDockviewPanelProps` a panel touches, typed
 * structurally so this file never imports `dockview` at runtime. Dockview hands
 * the real object; we only read `params.panelId` / `params.collapsed`.
 */
export interface DockviewPanelPropsLike {
  readonly api?: { readonly id?: string }
  readonly params?: { readonly panelId?: string; readonly collapsed?: boolean } & Record<string, unknown>
  readonly containerApi?: unknown
}

/** Context value shared by every panel and the tab header. */
export interface PsPanelsContextValue {
  readonly t: Translate
  /** Live collapsed flags (source of truth for rendering). */
  readonly collapsed: Readonly<Record<string, boolean>>
  /** Flip a panel's collapsed flag (also mirrors it into Dockview params). */
  readonly toggleCollapse: (panelId: PanelId) => void
}

const PsPanelsContext = createContext<PsPanelsContextValue | null>(null)

/** Identity translator used when a panel is rendered outside the provider. */
const identity: Translate = (key) => key

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
  return useContext(PsPanelsContext) ?? { t: identity, collapsed: {}, toggleCollapse: () => {} }
}

/** Resolve the panel id from Dockview params, falling back to a static id. */
export function panelIdOf(props: DockviewPanelPropsLike, fallback: PanelId): PanelId {
  const id = props.params?.panelId
  return typeof id === 'string' ? (id as PanelId) : fallback
}

/** Is the panel collapsed? Prefer the live store, fall back to Dockview params. */
export function collapsedOf(ctx: PsPanelsContextValue, props: DockviewPanelPropsLike, panelId: PanelId): boolean {
  if (Object.prototype.hasOwnProperty.call(ctx.collapsed, panelId)) return ctx.collapsed[panelId] === true
  return props.params?.collapsed === true
}

export interface PanelFrameProps {
  /** Static panel id (the source of truth if Dockview params are missing). */
  panelId: PanelId
  /** Dockview panel props, passed through by the registered component. */
  dockview: DockviewPanelPropsLike
  /** Content for the panel body. */
  children?: ReactNode
}

/**
 * The panel body: renders the (proxied) native content, or a slim
 * "collapsed" hint when the panel is folded. The tab header — with the
 * collapse button — is rendered separately by the tab component, so folding
 * here only affects the content area and leaves the title bar in place.
 */
export function PanelFrame({ panelId, dockview, children }: PanelFrameProps): ReactElement {
  const ctx = usePsPanels()
  const collapsed = collapsedOf(ctx, dockview, panelId)
  const name = ctx.t(`panel.${camel(panelId)}`)

  if (collapsed) {
    return (
      <div className="ps-panel-body" data-collapsed="true" data-panel-id={panelId}>
        <span className="ps-panel-hint">{ctx.t('ui.expandPanel', { name })}</span>
      </div>
    )
  }

  return (
    <div className="ps-panel-body" data-panel-id={panelId}>
      {children ?? <PortalPanel panelId={panelId} t={ctx.t} />}
    </div>
  )
}

/** `conversation-tree` → `conversationTree` (matches the locale keys). */
function camel(id: string): string {
  return id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}
