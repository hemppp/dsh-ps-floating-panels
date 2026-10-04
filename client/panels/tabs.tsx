/**
 * dsh-ps-floating-panels — Dockview tab header (`defaultTabComponent`).
 *
 * The tab bar is the panel's title bar and the one place the collapse/expand
 * control lives. The title comes from the live native region (so a dockkit pane
 * keeps the host's own label), falling back to the Dockview title.
 *
 * `stopPropagation` on the button prevents Dockview treating the click as a
 * tab activation or the start of a drag.
 *
 * @module dsh-ps-floating-panels/client/panels/tabs
 */

import type { MouseEvent, ReactElement } from 'react'
import { collapsedOf, regionIdFromProps, usePsPanels, type DockviewPanelPropsLike } from './panel-shell.tsx'

/** The subset of `IDockviewPanelHeaderProps` this header reads. */
export interface DockviewTabPropsLike extends DockviewPanelPropsLike {
  readonly api?: {
    readonly id?: string
    readonly title?: string
    readonly isActive?: boolean
    readonly setActive?: () => void
  }
}

/**
 * Default tab component: grip + title + collapse/expand button. Registered as
 * `defaultTabComponent` on `<DockviewReact>`, so it is used for every panel
 * unless a panel overrides `tabComponents`.
 */
export function PsDefaultTab(props: DockviewTabPropsLike): ReactElement {
  const ctx = usePsPanels()
  const regionId = regionIdFromProps(props) ?? props.api?.id
  const region = regionId === undefined ? undefined : ctx.regionOf(regionId)
  const title = region?.title ?? props.api?.title ?? ctx.t('native.unknownTitle')
  const collapsed = regionId === undefined ? props.params?.collapsed === true : collapsedOf(ctx, props, regionId)

  const onToggle = (event: MouseEvent<HTMLButtonElement>): void => {
    // Do not let the click activate the tab or start a tab drag.
    event.stopPropagation()
    event.preventDefault()
    if (regionId !== undefined) ctx.toggleCollapse(regionId)
  }

  return (
    <div className="ps-tab" data-region={regionId} data-active={props.api?.isActive === true ? 'true' : 'false'}>
      <span className="ps-tab__grip" aria-hidden="true">⋮⋮</span>
      <span className="ps-tab__label" title={title}>{title}</span>
      {regionId !== undefined ? (
        <button
          type="button"
          className="ps-tab__btn"
          data-ps-action="collapse"
          data-region={regionId}
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
