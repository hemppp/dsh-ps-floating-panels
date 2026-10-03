/**
 * dsh-ps-floating-panels — stylesheet injector (injected once).
 *
 * Three sheets are injected (see {@link PS_STYLESHEET}):
 *
 *  - {@link DOCKVIEW_BASE_CSS} — Dockview's own base styles, INLINED as a string
 *    (the loader serves this bundle's JS but never a separate CSS file, so the
 *    grid / tabs / floating groups would be unstyled otherwise).
 *  - {@link THEME_CSS} — the colour layer. Every value is
 *    `var(--dsw-alias-*, <fallback>)` so the panels follow the host's
 *    light/dark theme. It MIRRORS `client/theme.css`, which is the canonical,
 *    human-auditable source; keeping the rules here as a string makes the
 *    bundle independent of the bundler's CSS handling.
 *  - {@link GEOMETRY_CSS} — positioning, flex, sizing, stacking, the
 *    floating/docked geometry. Deliberately COLOUR-FREE so the layout and the
 *    theming can be audited independently.
 *
 * The Dockview internals are NOT restyled beyond the minimum needed for the
 * shell to sit above the app; native DSH content rendered through the proxy
 * keeps its own borders/backgrounds/radius untouched. The single rounded
 * container is `.ps-dock-shell`.
 *
 * @module dsh-ps-floating-panels/client/inject-css
 */

import { DOCKVIEW_BASE_CSS } from './dockview-base.ts'
import { THEME_CSS } from './theme-css.ts'

/** DOM id of the injected `<style>` element (so it is injected once). */
export const PS_STYLE_ELEMENT_ID = 'dsh-ps-floating-panels-style'

const GEOMETRY_CSS = String.raw`
.ps-floating-root {
  position: fixed;
  inset: 0;
  z-index: 60;
  pointer-events: none; /* the chrome backdrop is click-through... */
}

.ps-floating-root[data-hidden='true'] {
  display: none;
}

/* ...but every real surface re-enables pointer events. */
.ps-dock-shell,
.ps-status-badge,
.ps-launcher,
.ps-conflict-backdrop,
.ps-conflict-dialog {
  pointer-events: auto;
}

.ps-dock-shell {
  display: flex;
  flex-direction: column;
  position: absolute;
  inset: 14px;
  overflow: hidden;
}

.ps-dock-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  height: 30px;
  padding: 0 10px;
  font-size: 12px;
  user-select: none;
}

.ps-dock-toolbar__title {
  flex: 1 1 auto;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ps-dock-toolbar__hint {
  flex: 0 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.8;
}

.ps-dock-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.ps-dock-btn {
  height: 20px;
  padding: 0 8px;
  font-size: 11px;
  line-height: 18px;
}

.ps-dock-surface {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}

/* ---- Dockview tab (our defaultTabComponent) ---- */
.ps-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 6px 0 10px;
  font-size: 12px;
  user-select: none;
  cursor: pointer;
  max-width: 220px;
}

.ps-tab__grip {
  flex: 0 0 auto;
  opacity: 0.45;
  font-size: 10px;
  letter-spacing: -1px;
  cursor: grab;
}

.ps-tab__label {
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ps-tab__btn {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  padding: 0;
  line-height: 16px;
  font-size: 11px;
}

/* ---- panel content ---- */
.ps-panel-body {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.ps-panel-body[data-collapsed='true'] {
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.ps-panel-hint {
  font-size: 12px;
  padding: 12px;
}

/* ---- native decoupling proxy ---- */
.ps-proxy {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ps-proxy > * {
  flex: 1 1 auto;
  min-height: 0;
}

.ps-proxy-placeholder {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 8px;
  padding: 12px;
  font-size: 12px;
}

.ps-proxy-placeholder__title { font-size: 12px; }
.ps-proxy-placeholder__body { font-size: 11px; }
.ps-proxy-placeholder__hint { font-size: 11px; opacity: 0.85; }

/* ---- status badge / launcher ---- */
.ps-status-badge {
  position: absolute;
  right: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
  user-select: none;
  z-index: 2;
}

.ps-status-badge__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.ps-launcher {
  position: absolute;
  right: 16px;
  bottom: 54px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 2;
}

.ps-launcher-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
  user-select: none;
}

.ps-launcher-pill__count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

/* ---- conflict dialog ---- */
.ps-conflict-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ps-conflict-dialog {
  width: min(440px, calc(100vw - 48px));
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ps-conflict-dialog__title { font-size: 14px; }
.ps-conflict-dialog__list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  max-height: 160px;
  overflow: auto;
}
.ps-conflict-dialog__hint { font-size: 12px; }
.ps-conflict-dialog__actions { display: flex; justify-content: flex-end; }
`

/**
 * The full sheet injected into `<head>`, in order:
 *  1. {@link DOCKVIEW_BASE_CSS} — Dockview's own base styles, INLINED because
 *     the module loader serves this bundle's JS but never a separate CSS file.
 *  2. {@link THEME_CSS} — our `--dsw-alias-*` colour layer (mirrors theme.css).
 *  3. {@link GEOMETRY_CSS} — our geometry layer (must win over Dockview).
 */
export const PS_STYLESHEET = DOCKVIEW_BASE_CSS + '\n' + THEME_CSS + '\n' + GEOMETRY_CSS

/**
 * Inject the plugin stylesheet exactly once. Safe on `document`-less hosts
 * (SSR / tests): it becomes a no-op instead of throwing.
 *
 * @param doc - the document to inject into (defaults to the global one).
 * @returns a disposer that removes the element if this call created it.
 */
export function injectPsStyles(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): () => void {
  if (!doc) return () => {}
  const existing = doc.getElementById(PS_STYLE_ELEMENT_ID)
  if (existing) return () => {}
  const el = doc.createElement('style')
  el.id = PS_STYLE_ELEMENT_ID
  el.setAttribute('data-dsh-plugin', 'dsh-ps-floating-panels')
  el.textContent = PS_STYLESHEET
  doc.head.appendChild(el)
  return () => {
    if (el.isConnected) el.remove()
  }
}
