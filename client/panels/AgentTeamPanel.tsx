/**
 * 工作团队 (agent-team) — the multi-agent team monitor.
 *
 * Content is proxied from `window.__DSH_NATIVE_PANELS__.getElement('agent-team')`.
 * This is the one panel whose native content may itself be another overlay
 * (the agent-teams activity floater); proxying keeps it in its own panel
 * instead of letting it float over everything.
 *
 * @module dsh-ps-floating-panels/client/panels/AgentTeamPanel
 */
import type { ReactElement } from 'react'
import { PanelFrame, type DockviewPanelPropsLike } from './panel-shell.tsx'

/** Stable panel id (also the Dockview params key). */
export const AGENT_TEAM_PANEL_ID = 'agent-team' as const

export function AgentTeamPanel(props: DockviewPanelPropsLike): ReactElement {
  return <PanelFrame panelId={AGENT_TEAM_PANEL_ID} dockview={props} />
}
