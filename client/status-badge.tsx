/**
 * dsh-ps-floating-panels — bottom-right status badge.
 *
 * Shows a compact summary of the panel system: how many panels exist, how many
 * are collapsed, how many are floating. It is gated by `showStatusBadge`; when
 * that is false the component returns `null`, i.e. it renders NO DOM at all
 * (not a hidden node), which keeps the accessibility tree and the acceptance
 * "no badge DOM when off" check clean.
 *
 * @module dsh-ps-floating-panels/client/status-badge
 */

import type { ReactElement } from 'react'

export interface StatusBadgeProps {
  /** Master gate: false → the component renders nothing. */
  readonly show: boolean
  /** Total number of panels in the layout. */
  readonly panelCount: number
  /** Number of collapsed panels. */
  readonly collapsedCount: number
  /** Number of floating groups / panels. */
  readonly floatingCount: number
  readonly t: (key: string, vars?: Record<string, string | number>) => string
}

/** Derive the badge's visual state from the counts (for the dot colour). */
function badgeState(collapsedCount: number, floatingCount: number): { dot: string; flipped: string } {
  if (floatingCount > 0) return { dot: '', flipped: 'true' }
  if (collapsedCount > 0) return { dot: '', flipped: 'true' }
  return { dot: '', flipped: 'false' }
}

/**
 * The status badge. Returns `null` when `show` is false — no wrapper, no
 * placeholder, nothing.
 */
export function StatusBadge({ show, panelCount, collapsedCount, floatingCount, t }: StatusBadgeProps): ReactElement | null {
  if (!show) return null
  const state = badgeState(collapsedCount, floatingCount)
  const label = t('status.panelCount', { n: panelCount })
    + (collapsedCount > 0 ? ' ' + t('status.collapsedSuffix', { n: collapsedCount }) : '')

  return (
    <div className="ps-status-badge" data-ps-status-badge="true" role="status" aria-live="polite">
      <span
        className="ps-status-badge__dot"
        data-floating={floatingCount > 0 ? 'true' : undefined}
        data-collapsed={state.flipped}
        aria-hidden="true"
      />
      <span className="ps-status-badge__label">{label}</span>
      {floatingCount > 0 ? (
        <span className="ps-status-badge__floating">{t('status.floatingCount', { n: floatingCount })}</span>
      ) : null}
    </div>
  )
}
