/**
 * 代码树 (code-tree) — the file explorer.
 *
 * Content is proxied from `window.__DSH_NATIVE_PANELS__.getElement('code-tree')`.
 *
 * @module dsh-ps-floating-panels/client/panels/CodeTreePanel
 */
import type { ReactElement } from 'react'
import { PanelFrame, type DockviewPanelPropsLike } from './panel-shell.tsx'

/** Stable panel id (also the Dockview params key). */
export const CODE_TREE_PANEL_ID = 'code-tree' as const

export function CodeTreePanel(props: DockviewPanelPropsLike): ReactElement {
  return <PanelFrame panelId={CODE_TREE_PANEL_ID} dockview={props} />
}
