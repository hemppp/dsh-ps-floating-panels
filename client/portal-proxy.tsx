/**
 * dsh-ps-floating-panels — native-DOM decoupling proxy.
 *
 * The plugin runs as an EXTERNAL bundle: it cannot import the host's React
 * components and must not copy their source. Instead the host (or any bridge)
 * publishes native panel content on a page global, and this module mounts it
 * into a panel body through `createPortal`. When nothing is published, a
 * placeholder explains the contract instead of rendering a broken panel.
 *
 * The contract (page global, versioned):
 *
 * ```ts
 * window.__DSH_NATIVE_PANELS__ = {
 *   version: 1,
 *   // Return a React node (portal'd into the panel) OR a DOM node (adopted):
 *   getElement(panelId: string): ReactNode | Element | DocumentFragment | null,
 *   subscribe?(onChange: () => void): () => void,   // optional re-render signal
 * }
 * ```
 *
 * Two mount paths, because a bridge may hand back either:
 *  - React node → `ReactDOM.createPortal(node, container)` (the host's React
 *    tree renders straight into our panel body).
 *  - DOM node   → adopted into the container imperatively (the node was already
 *    produced somewhere else in the page; React must not re-render it).
 *
 * @module dsh-ps-floating-panels/client/portal-proxy
 */

import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PanelId } from './config.ts'

/** The bridge version this bundle understands. */
export const NATIVE_PANELS_VERSION = 1

/** The page global key the host/bridge publishes under. */
export const NATIVE_PANELS_GLOBAL = '__DSH_NATIVE_PANELS__'

/** What a bridge may return for a panel. */
export type NativePanelContent = ReactNode | Element | DocumentFragment | null

/** Public shape of the bridge. */
export interface NativePanelsBridge {
  readonly version?: number
  getElement(panelId: string): NativePanelContent | undefined
  /** Optional: called when the available native elements change. */
  subscribe?(onChange: () => void): () => void
}

/** Translator signature accepted by the placeholder. */
type Translate = (key: string, vars?: Record<string, string | number>) => string

/** Read the bridge off a window (or any object), validated. */
export function getNativePanelsBridge(win: unknown = typeof window === 'undefined' ? undefined : window): NativePanelsBridge | null {
  if (!win || typeof win !== 'object') return null
  const bridge = (win as Record<string, unknown>)[NATIVE_PANELS_GLOBAL]
  if (!bridge || typeof bridge !== 'object') return null
  if (typeof (bridge as NativePanelsBridge).getElement !== 'function') return null
  return bridge as NativePanelsBridge
}

/** Narrow to a DOM node (has a numeric `nodeType`). */
export function isDomNode(value: unknown): value is Node {
  return !!value && typeof value === 'object' && typeof (value as Node).nodeType === 'number'
}

/** Placeholder shown when no native content is published for a panel. */
function Placeholder({ panelId, t }: { panelId: PanelId; t: Translate }): ReactElement {
  return (
    <div className="ps-proxy-placeholder" data-ps-placeholder={panelId}>
      <div className="ps-proxy-placeholder__title">{t('proxy.placeholderTitle')}</div>
      <div className="ps-proxy-placeholder__body">{t('proxy.placeholderBody', { panelId })}</div>
      <div className="ps-proxy-placeholder__hint">{t('proxy.placeholderHint')}</div>
    </div>
  )
}

export interface PortalPanelProps {
  /** Which panel this content area belongs to. */
  panelId: PanelId
  /** Translator for the placeholder copy. */
  t: Translate
}

/**
 * Mount published native content into this panel's content area.
 *
 * This is the DECOUPLING PROXY: the panel component above it never knows what a
 * "conversation" or "workspace" is, only that content may be published for its
 * id. Without a bridge the plugin remains fully functional (dock / float /
 * collapse / persist) and shows the placeholder.
 */
export function PortalPanel({ panelId, t }: PortalPanelProps): ReactElement {
  const [bridge, setBridge] = useState<NativePanelsBridge | null>(() => getNativePanelsBridge())
  const [content, setContent] = useState<NativePanelContent>(null)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  // The bridge may be published AFTER this panel mounts (host boot race), so
  // re-poll while it is absent. Cheap and self-terminating once found.
  useEffect(() => {
    if (bridge) return
    const tick = (): void => {
      const found = getNativePanelsBridge()
      if (found) setBridge(found)
    }
    tick()
    const interval = setInterval(tick, 500)
    return () => clearInterval(interval)
  }, [bridge])

  useEffect(() => {
    if (!bridge) {
      setContent(null)
      return
    }
    const resolve = (): void => {
      try {
        setContent(bridge.getElement(panelId) ?? null)
      } catch (err) {
        console.warn('[dsh-ps-floating-panels] native bridge getElement threw', err)
        setContent(null)
      }
    }
    resolve()
    if (typeof bridge.subscribe === 'function') {
      try {
        return bridge.subscribe(resolve)
      } catch {
        return
      }
    }
    return
  }, [bridge, panelId])

  // DOM-node path: adopt the host node into our container. React renders no
  // children into the container for this path, so the adopted node is safe;
  // cleanup detaches it when the panel unmounts or switches path.
  useEffect(() => {
    if (!container || !isDomNode(content)) return
    const node = content as Node
    container.replaceChildren(node)
    return () => {
      if (node.parentNode === container) container.removeChild(node)
    }
  }, [container, content])

  if (!bridge || content == null) return <Placeholder panelId={panelId} t={t} />

  // React-node path: portal the host's React content into our container.
  return (
    <div className="ps-proxy" ref={setContainer} data-ps-proxy={panelId}>
      {container && !isDomNode(content) ? createPortal(content, container) : null}
    </div>
  )
}
