/**
 * dsh-ps-floating-panels — the one panel component.
 *
 * Every panel renders the SAME Dockview content component; which native region
 * it holds comes from `params.regionId`. The body element is handed to the
 * adopter, which moves the host's real node in (and back out on unmount, so
 * Dockview can freely move a panel between groups or float it: the region is
 * detached and re-attached around each remount).
 *
 * @module dsh-ps-floating-panels/client/panels/NativeRegionPanel
 */

import { useEffect, useState, type ReactElement } from 'react'
import { collapsedOf, regionIdFromProps, usePsPanels, type DockviewPanelPropsLike } from './panel-shell.tsx'

/**
 * A panel whose content IS a piece of the host's own UI.
 *
 * Marked `data-ps-region` so the adopted node can be styled through its panel
 * (`[data-ps-region] [data-ps-adopted] { … }`).
 */
export function NativeRegionPanel(props: DockviewPanelPropsLike): ReactElement {
  const ctx = usePsPanels()
  const regionId = regionIdFromProps(props)
  const region = regionId === undefined ? undefined : ctx.regionOf(regionId)
  const collapsed = regionId === undefined ? false : collapsedOf(ctx, props, regionId)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const adopter = ctx.adopter

  useEffect(() => {
    if (container === null || adopter === null || regionId === undefined || collapsed) return
    // `region` is a dependency on purpose: when the host rebuilds its node the
    // store notifies, this effect re-runs, and the new node is adopted.
    const adopted = adopter.attach(regionId, container)
    if (!adopted) {
      console.warn(`[dsh-ps-floating-panels] native region "${regionId}" could not be adopted`)
    }
    return () => {
      adopter.detach(regionId)
    }
  }, [container, adopter, regionId, collapsed, region])

  if (regionId === undefined || region === undefined) {
    return (
      <div className="ps-panel-body ps-panel-missing" data-region={regionId ?? 'unknown'}>
        <div className="ps-panel-missing__title">{ctx.t('native.missingTitle')}</div>
        <div className="ps-panel-missing__body">{ctx.t('native.missingBody', { regionId: regionId ?? 'unknown' })}</div>
        <div className="ps-panel-missing__hint">{ctx.t('native.missingHint')}</div>
      </div>
    )
  }

  if (collapsed) {
    return (
      <div className="ps-panel-body" data-collapsed="true" data-region={regionId}>
        <span className="ps-panel-hint">{ctx.t('ui.expandPanel', { name: region.title })}</span>
      </div>
    )
  }

  return <div className="ps-panel-body ps-native-host" data-region={regionId} ref={setContainer} />
}
