/**
 * dsh-ps-floating-panels — Dockview component registry.
 *
 * Since 0.2.0 there is exactly ONE content component: which native region a
 * panel hosts is data (`params.regionId`), not a component identity. That is
 * what lets the panel set follow the host's live UI (new dockkit pane → new
 * panel) without a build-time table.
 *
 * @module dsh-ps-floating-panels/client/panels/registry
 */

import type { FunctionComponent } from 'react'
import { NATIVE_COMPONENT } from '../config.ts'
import { NativeRegionPanel } from './NativeRegionPanel.tsx'
import type { DockviewPanelPropsLike } from './panel-shell.tsx'

/**
 * Build the `components` map Dockview needs: `{ [componentName]: ReactComponent }`.
 * A fresh object each call so Dockview never sees a mutated map.
 */
export function buildDockviewComponents(): Record<string, FunctionComponent<DockviewPanelPropsLike>> {
  return { [NATIVE_COMPONENT]: NativeRegionPanel }
}

export { NativeRegionPanel }
export type { DockviewPanelPropsLike } from './panel-shell.tsx'
