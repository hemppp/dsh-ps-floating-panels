/**
 * 对话主面板 (conversation) — the main chat surface.
 *
 * The native conversation stream is mounted through the portal proxy: the host
 * publishes the element for `panelId: 'conversation'` on
 * `window.__DSH_NATIVE_PANELS__`. This component owns only the panel shell
 * (title-bar collapse + content area); it never imports a host component.
 *
 * @module dsh-ps-floating-panels/client/panels/ConversationPanel
 */
import type { ReactElement } from 'react'
import { PanelFrame, type DockviewPanelPropsLike } from './panel-shell.tsx'

/** Stable panel id (also the Dockview params key). */
export const CONVERSATION_PANEL_ID = 'conversation' as const

export function ConversationPanel(props: DockviewPanelPropsLike): ReactElement {
  return <PanelFrame panelId={CONVERSATION_PANEL_ID} dockview={props} />
}
