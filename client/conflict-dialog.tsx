/**
 * dsh-ps-floating-panels — conflict warning dialog.
 *
 * Pure presentational component: it renders the conflicting plugin ids found by
 * {@link detectConflicts} at boot and lets the user dismiss it. The dismissal is
 * scoped to the page session (a reload re-shows it) so a user who ignores the
 * warning is not nagged within one session, but a returning user is reminded.
 *
 * @module dsh-ps-floating-panels/client/conflict-dialog
 */

import type { ReactElement } from 'react'
import type { ConflictEntry } from './conflict-detect.ts'

/** Per-page-session dismissal key. */
export const CONFLICT_DISMISS_KEY = 'dsh-ps-floating-panels:conflict-dismissed'

export interface ConflictDialogProps {
  readonly conflicts: readonly ConflictEntry[]
  readonly t: (key: string, vars?: Record<string, string | number>) => string
  readonly onDismiss: () => void
}

/**
 * Modal warning listing the conflicting plugins. Returns `null` (no DOM) when
 * there is nothing to report, so the caller can render it unconditionally.
 */
export function ConflictDialog({ conflicts, t, onDismiss }: ConflictDialogProps): ReactElement | null {
  if (conflicts.length === 0) return null
  return (
    <div className="ps-conflict-backdrop" role="alertdialog" aria-modal="true" aria-label={t('conflict.title')}>
      <div className="ps-conflict-dialog">
        <div className="ps-conflict-dialog__title">{t('conflict.title')}</div>
        <div>{t('conflict.body')}</div>
        <ul className="ps-conflict-dialog__list">
          {conflicts.map((c) => (
            <li key={c.id} data-conflict-id={c.id}>
              <code>{c.id}</code>
              <span className="ps-conflict-dialog__hint"> ({c.keyword})</span>
            </li>
          ))}
        </ul>
        <div className="ps-conflict-dialog__hint">{t('conflict.hint')}</div>
        <div className="ps-conflict-dialog__actions">
          <button type="button" className="ps-dock-btn" data-ps-action="conflict-dismiss" onClick={onDismiss}>
            {t('conflict.dismiss')}
          </button>
        </div>
      </div>
    </div>
  )
}
