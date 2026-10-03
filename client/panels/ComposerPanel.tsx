/**
 * 底部输入框 (composer) — the message input bar.
 *
 * Content is proxied from `window.__DSH_NATIVE_PANELS__.getElement('composer')`.
 * In the default split it sits in the middle column's bottom leaf, so the
 * input stays directly under the conversation like the native layout.
 *
 * @module dsh-ps-floating-panels/client/panels/ComposerPanel
 */
import type { ReactElement } from 'react'
import { PanelFrame, type DockviewPanelPropsLike } from './panel-shell.tsx'

/** Stable panel id (also the Dockview params key). */
export const COMPOSER_PANEL_ID = 'composer' as const

export function ComposerPanel(props: DockviewPanelPropsLike): ReactElement {
  return <PanelFrame panelId={COMPOSER_PANEL_ID} dockview={props} />
}
