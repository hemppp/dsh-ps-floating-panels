/**
 * dsh-ps-floating-panels — the seven-panel component registry.
 *
 * Dockview is given `components` keyed by the stable component names in
 * {@link PANEL_META}. Each entry is a thin wrapper that adapts Dockview's panel
 * props into the shared {@link PanelFrame}. Keeping the registry in one place
 * means the layout factory, the components map and the panel table all derive
 * from the same source.
 *
 * @module dsh-ps-floating-panels/client/panels/registry
 */

import type { FunctionComponent, ReactNode } from 'react'
import { PANEL_META, type PanelId } from '../config.ts'
import type { DockviewPanelPropsLike } from './panel-shell.tsx'
import { ConversationPanel } from './ConversationPanel.tsx'
import { ConversationTreePanel } from './ConversationTreePanel.tsx'
import { CodePreviewPanel } from './CodePreviewPanel.tsx'
import { ComposerPanel } from './ComposerPanel.tsx'
import { WorkspacePanel } from './WorkspacePanel.tsx'
import { CodeTreePanel } from './CodeTreePanel.tsx'
import { AgentTeamPanel } from './AgentTeamPanel.tsx'

/** The seven panel components, keyed by {@link PanelId}. */
export const PS_PANEL_COMPONENTS: Readonly<Record<PanelId, FunctionComponent<DockviewPanelPropsLike>>> = {
  conversation: ConversationPanel,
  'conversation-tree': ConversationTreePanel,
  'code-preview': CodePreviewPanel,
  composer: ComposerPanel,
  workspace: WorkspacePanel,
  'code-tree': CodeTreePanel,
  'agent-team': AgentTeamPanel,
}

/**
 * Build the `components` map Dockview needs: `{ [componentName]: ReactComponent }`.
 * A fresh object each call so Dockview never sees a mutated map.
 */
export function buildDockviewComponents(): Record<string, FunctionComponent<DockviewPanelPropsLike>> {
  const map: Record<string, FunctionComponent<DockviewPanelPropsLike>> = {}
  for (const id of Object.keys(PS_PANEL_COMPONENTS) as PanelId[]) {
    map[PANEL_META[id].component] = PS_PANEL_COMPONENTS[id]
  }
  return map
}

/** Re-export the individual names for callers that want them directly. */
export {
  ConversationPanel,
  ConversationTreePanel,
  CodePreviewPanel,
  ComposerPanel,
  WorkspacePanel,
  CodeTreePanel,
  AgentTeamPanel,
}

/** Type-only helper so callers can name the props shape without dockview. */
export type { DockviewPanelPropsLike } from './panel-shell.tsx'
