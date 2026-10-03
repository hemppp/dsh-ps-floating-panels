/**
 * dsh-ps-floating-panels — Dockview tab header (`defaultTabComponent`).
 *
 * The tab bar is the panel's title bar and the one place the collapse/expand
 * control lives. Placing the button here (rather than inside the panel body)
 * is what makes "collapse" leave the title bar on screen: Dockview keeps the
 * tab, the content component returns its folded hint, and the tab's flag
 * round-trips through the layout JSON.
 *
 * `stopPropagation` on the button prevents Dockview treating the click as a
 * tab activation or the start of a drag.
 *
 * @module dsh-ps-floating-panels/client/panels/tabs
 */

import type { MouseEvent, ReactElement } from 'react'
import { PANEL_META, type PanelId } from '../config.ts'
import { collapsedOf, usePsPanels, type DockviewPanelPropsLike } from './panel-shell.tsx'

/** The subset of `IDockviewPanelHeaderProps` this header reads. */
export interface DockviewTabPropsLike extends DockviewPanelPropsLike {
  readonly api?: {
    readonly id?: string
    readonly title?: string
    readonly isActive?: boolean
    readonly setActive?: () => void
  }
  readonly params?: { readonly panelId?: string; readonly collapsed?: boolean } & Record<string, unknown>
}

/** Resolve the panel id for a tab header from Dockview's api or params. */
function tabPanelId(props: DockviewTabPropsLike, fallback?: PanelId): PanelId | undefined {
  const fromApi = props.api?.id
  if (typeof fromApi === 'string' && fromApi in PANEL_META) return fromApi as PanelId
  const fromParams = props.params?.panelId
  if (typeof fromParams === 'string' && fromParams in PANEL_META) return fromParams as PanelId
  return fallback
}

/** Title for a panel id, resolved through the translator. */
export function panelTitle(panelId: PanelId | undefined, t: (key: string) => string, fallback?: string): string {
  if (panelId && panelId in PANEL_META) return t(PANEL_META[panelId].titleKey)
  return fallback ?? 'Panel'
}

/**
 * Default tab component: grip + title + collapse/expand button. Registered as
 * `defaultTabComponent` on `<DockviewReact>`, so it is used for every panel
 * unless a panel overrides `tabComponents`.
 */
export function PsDefaultTab(props: DockviewTabPropsLike): ReactElement {
  const ctx = usePsPanels()
  const panelId = tabPanelId(props)
  const title = panelTitle(panelId, ctx.t, props.api?.title)
  const collapsed = panelId ? collapsedOf(ctx, props, panelId) : props.params?.collapsed === true

  const onToggle = (event: MouseEvent<HTMLButtonElement>): void => {
    // Do not let the click activate the tab or start a tab drag.
    event.stopPropagation()
    event.preventDefault()
    if (panelId) ctx.toggleCollapse(panelId)
  }

  return (
    <div className="ps-tab" data-panel-id={panelId} data-active={props.api?.isActive === true ? 'true' : 'false'}>
      <span className="ps-tab__grip" aria-hidden="true">⋮⋮</span>
      <span className="ps-tab__label" title={title}>{title}</span>
      {panelId ? (
        <button
          type="button"
          className="ps-tab__btn"
          data-ps-action="collapse"
          data-panel-id={panelId}
          aria-expanded={!collapsed}
          aria-label={ctx.t(collapsed ? 'ui.expandPanel' : 'ui.collapsePanel', { name: title })}
          title={ctx.t(collapsed ? 'ui.expand' : 'ui.collapse')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggle}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      ) : null}
    </div>
  )
}

