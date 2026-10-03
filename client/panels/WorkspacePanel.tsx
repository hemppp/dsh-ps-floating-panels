/**
 * 工作区 (workspace) — the workspace/session switcher.
 *
 * Content is proxied from `window.__DSH_NATIVE_PANELS__.getElement('workspace')`.
 *
 * @module dsh-ps-floating-panels/client/panels/WorkspacePanel
 */
import type { ReactElement } from 'react'
import { PanelFrame, type DockviewPanelPropsLike } from './panel-shell.tsx'

/** Stable panel id (also the Dockview params key). */
export const WORKSPACE_PANEL_ID = 'workspace' as const

export function WorkspacePanel(props: DockviewPanelPropsLike): ReactElement {
  return <PanelFrame panelId={WORKSPACE_PANEL_ID} dockview={props} />
}
