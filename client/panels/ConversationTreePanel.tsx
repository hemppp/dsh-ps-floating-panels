/**
 * 对话树 (conversation-tree) — the session/branch tree.
 *
 * Content is proxied from `window.__DSH_NATIVE_PANELS__.getElement('conversation-tree')`.
 * The shell (drag handle in the tab bar, collapse button) is all this file owns.
 *
 * @module dsh-ps-floating-panels/client/panels/ConversationTreePanel
 */
import type { ReactElement } from 'react'
import { PanelFrame, type DockviewPanelPropsLike } from './panel-shell.tsx'

/** Stable panel id (also the Dockview params key). */
export const CONVERSATION_TREE_PANEL_ID = 'conversation-tree' as const

export function ConversationTreePanel(props: DockviewPanelPropsLike): ReactElement {
  return <PanelFrame panelId={CONVERSATION_TREE_PANEL_ID} dockview={props} />
}
