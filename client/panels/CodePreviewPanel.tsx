/**
 * 代码预览 (code-preview) — the file/diff preview surface.
 *
 * Content is proxied from `window.__DSH_NATIVE_PANELS__.getElement('code-preview')`.
 *
 * @module dsh-ps-floating-panels/client/panels/CodePreviewPanel
 */
import type { ReactElement } from 'react'
import { PanelFrame, type DockviewPanelPropsLike } from './panel-shell.tsx'

/** Stable panel id (also the Dockview params key). */
export const CODE_PREVIEW_PANEL_ID = 'code-preview' as const

export function CodePreviewPanel(props: DockviewPanelPropsLike): ReactElement {
  return <PanelFrame panelId={CODE_PREVIEW_PANEL_ID} dockview={props} />
}
