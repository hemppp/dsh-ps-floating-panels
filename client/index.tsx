/**
 * dsh-ps-floating-panels — client plugin entry.
 *
 * Contributes the split/floating panel system into the shell overlay:
 *
 * ```ts
 * export const name = 'dsh-ps-floating-panels'
 * export const inject = ['slots', 'locale', 'theme']
 * export function apply(ctx) {
 *   ctx.slots.inject('shell.overlay', () =>
 *     ctx.slots.register({ name: 'shell.overlay', id: 'dsh-ps-floating-panels-root', label: () => 'PS Panels' }, Root))
 * }
 * ```
 *
 * The client is built as an EXTERNAL bundle, so nothing here imports a host
 * runtime value: the context is described with a structural interface (exactly
 * as dsh-market does) to keep the bundle free of monorepo-internal type
 * dependencies and immune to a scoped/unscoped Cordis split. `dockview` and
 * `react` are the only externals, both resolved through the host's module table
 * at runtime.
 *
 * @module dsh-ps-floating-panels/client
 */

import type { ReactElement } from 'react'
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  type PersistedLayout,
  type PsPanelsConfig,
} from './config.ts'
import { PsFloatingPanelsApp } from './PsFloatingPanelsApp.tsx'
import { CONFLICT_KEYWORDS, detectConflictsFromWindow, type ConflictEntry } from './conflict-detect.ts'
import { resolveConfigSource } from './config-source.ts'
import { injectPsStyles } from './inject-css.ts'
import { createTranslator, en, PS_LOCALE_NS, zh, type Translate } from './locales.ts'
import { isPersistedLayout, type LayoutHostBridge } from './layout-persist.ts'

/** Settings namespace — equals the package name / plugin name. */
export const SETTINGS_NAMESPACE = 'dsh-ps-floating-panels'

/* ------------------------------------------------------------------------- *
 * Structural host surface (no host type imports).
 * ------------------------------------------------------------------------- */

/** The subset of the slots service this plugin touches. */
interface SlotsService {
  inject(name: string, register: () => unknown): void
  register(meta: Record<string, unknown>, render: () => unknown): unknown
}

/** The subset of the locale service this plugin touches. */
interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(namespace: string): Translate
}

/** The subset of the theme service this plugin touches (optional use). */
interface ThemeService {
  getTheme(): unknown
  setTheme?(id: string): void
}

/**
 * Optional persistence seam. The host MAY expose these on its context (or on a
 * page global) to back the layout snapshot with real config storage; the local
 * snapshot always works regardless.
 */
interface PersistHooks {
  loadLayout?: () => PersistedLayout | null | Promise<PersistedLayout | null>
  saveLayout?: (layout: PersistedLayout) => void
}

/** The client Cordis context shape this plugin relies on. */
interface PsClientContext {
  slots: SlotsService
  locale?: LocaleService
  theme?: ThemeService
  /** Cordis effect wrapper; optional on older hosts. */
  effect?(callback: () => unknown, label?: string): unknown
  /** Cordis event bus; optional. */
  on?(event: string, callback: () => void): () => void
  /** Host persistence seam, when provided. */
  psPanelsPersist?: PersistHooks
  /** Client-side settings service (`settingsScope`/`settings`), when present. */
  settingsScope?: unknown
  settings?: unknown
}

/** The page-global persistence seam, when a host prefers to publish one. */
export const PERSIST_GLOBAL = '__DSH_PS_PANELS_PERSIST__'

/** Read the persistence hooks from the context or the page global. */
function resolvePersistHooks(ctx: PsClientContext): PersistHooks | undefined {
  if (ctx.psPanelsPersist && typeof ctx.psPanelsPersist === 'object') return ctx.psPanelsPersist
  if (typeof window === 'undefined') return undefined
  const globalHooks = (window as unknown as Record<string, unknown>)[PERSIST_GLOBAL]
  if (globalHooks && typeof globalHooks === 'object') return globalHooks as PersistHooks
  return undefined
}

/** Wrap host persistence hooks into the layout bridge the app consumes. */
function buildHostBridge(hooks: PersistHooks | undefined): LayoutHostBridge | undefined {
  if (!hooks || (typeof hooks.loadLayout !== 'function' && typeof hooks.saveLayout !== 'function')) return undefined
  return {
    loadLayout: typeof hooks.loadLayout === 'function'
      ? async () => {
        const value = await hooks.loadLayout!()
        return isPersistedLayout(value) ? value : null
      }
      : undefined,
    saveLayout: typeof hooks.saveLayout === 'function'
      ? (layout) => { hooks.saveLayout!(layout) }
      : undefined,
  }
}

/** Register a locale dictionary through `ctx.effect` when available. */
function registerLocale(ctx: PsClientContext): Translate {
  const locale = ctx.locale
  if (!locale || typeof locale.register !== 'function') return createTranslator(en)
  const register = (): unknown => locale.register(PS_LOCALE_NS, { zh, en })
  if (typeof ctx.effect === 'function') {
    try {
      ctx.effect(register, 'dsh-ps-floating-panels: dictionaries')
    } catch {
      register()
    }
  } else {
    register()
  }
  let bound: Translate | undefined
  try {
    if (typeof locale.bind === 'function') bound = locale.bind(PS_LOCALE_NS)
  } catch {
    bound = undefined
  }
  // zh-first: this plugin ships Chinese copy as its primary strings.
  return createTranslator(zh, en, bound)
}

/* ------------------------------------------------------------------------- *
 * Named exports (the Loader unwraps `exports`, so no default export).
 * ------------------------------------------------------------------------- */

export const name = 'dsh-ps-floating-panels'

/**
 * `theme` is included as required on purpose: this plugin mounts into
 * `shell.overlay`, which only exists when ui-layout is present, and ui-layout
 * hard-depends on theme — so a host with the overlay always has theme. `locale`
 * is likewise present in every web composition.
 */
export const inject = ['slots', 'locale', 'theme']

/**
 * Plugin activation.
 *
 * @param ctx - the client context (structurally typed above).
 * @param config - the row's config, if the host passes it; merged over defaults.
 */
export function apply(ctx: PsClientContext, config?: Partial<PsPanelsConfig>): void {
  // Geometry stylesheet, once. Colours live in theme.css (bundled alongside).
  const removeStyles = injectPsStyles()
  if (typeof ctx.effect === 'function') {
    try {
      ctx.effect(() => removeStyles, 'dsh-ps-floating-panels: styles')
    } catch {
      /* effect is best-effort; the stylesheet stays for the page lifetime */
    }
  }

  // The config is LIVE, not read once: a settings edit (e.g. showStatusBadge)
  // re-renders the overlay without restarting DSH (see config-source.ts).
  const configSource = resolveConfigSource(ctx, SETTINGS_NAMESPACE, config ?? null)
  const initial = configSource.getSnapshot()
  if (!initial.enabled) return

  // Conflict detection: a boot graph may be absent (older / non-web host) — that
  // is a silent skip, never a throw. A hit warns in the log AND renders a dialog.
  // Host packages (`@deepseek-ai/*`) are already excluded by the detector, so a
  // hit here is always a third-party plugin.
  const { conflicts } = detectConflictsFromWindow()
  if (conflicts.length > 0) {
    console.warn(
      `[dsh-ps-floating-panels] conflicting third-party plugins detected (${CONFLICT_KEYWORDS.join('/')}):`,
      conflicts.map((c: ConflictEntry) => c.id).join(', '),
      '— disable them to avoid panel/layout conflicts.',
    )
  }

  const t = registerLocale(ctx)
  const host = buildHostBridge(resolvePersistHooks(ctx))

  // The render root closes over the resolved translator, config source, bridge
  // and conflicts; the slot component itself stays prop-free so any host renders it.
  function Root(): ReactElement | null {
    return <PsFloatingPanelsApp t={t} configSource={configSource} host={host} conflicts={conflicts} />
  }
  Root.displayName = 'PsFloatingPanelsRoot'

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-ps-floating-panels-root',
    label: () => 'PS Panels',
  }, Root))
}

/** Re-export the config/defaults so a host page can pre-fill settings. */
export { DEFAULT_CONFIG, normalizeConfig } from './config.ts'
export type { PanelId, PersistedLayout, PsPanelsConfig } from './config.ts'
