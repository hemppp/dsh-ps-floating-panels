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
 * ## Activation must never be fatal
 *
 * A client entry whose `apply` throws leaves its Cordis fiber in `FAILED`, and
 * the Web boot audit then aborts the whole page with
 * `web boot: N entry did not activate` — one misbehaving UI plugin takes the
 * app down. The audit reports only the fiber STATE, never the plugin's error,
 * so the failure is also invisible in the crash report.
 *
 * {@link apply} therefore runs its whole body inside one guard: every stage is
 * tracked, a throw is logged, published to {@link ACTIVATION_GLOBAL} and shown
 * in a fallback banner in the same `shell.overlay` slot, and activation still
 * returns normally. A broken host contract degrades to "plugin absent +
 * readable diagnosis" instead of "DSH will not boot".
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

/** Identifies the exact client build in logs and in {@link ActivationRecord}. */
export const CLIENT_BUILD = '0.1.1+activation-guard'

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

/* ------------------------------------------------------------------------- *
 * Activation diagnostics.
 * ------------------------------------------------------------------------- */

/** Page global holding the last activation outcome (readable from DevTools). */
export const ACTIVATION_GLOBAL = '__DSH_PS_PANELS_ACTIVATION__'

/** Serialized error, kept plain-JSON so it survives a cross-context read. */
export interface ActivationError {
  readonly name: string
  readonly message: string
  readonly stack?: string
}

/** The outcome of the last {@link apply} on this page. */
export interface ActivationRecord {
  readonly ok: boolean
  /** Last stage reached: `styles` … `slot`, `active`, `disabled`, or `failed`. */
  readonly stage: string
  readonly build: string
  readonly at: number
  readonly error?: ActivationError
}

/** Serialize an unknown thrown value without ever throwing. */
function describeError(error: unknown): ActivationError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  try {
    return { name: typeof error, message: String(error) }
  } catch {
    return { name: 'unknown', message: '(unprintable thrown value)' }
  }
}

/** Publish the activation outcome to the page global (best effort). */
function publishActivation(record: ActivationRecord): void {
  if (typeof window === 'undefined') return
  try {
    ;(window as unknown as Record<string, unknown>)[ACTIVATION_GLOBAL] = record
  } catch {
    /* a frozen / exotic global must not break activation */
  }
}

/**
 * Read the last activation outcome from a page global.
 *
 * @param win - the window to read (defaults to the global window).
 * @returns the record, or undefined when the plugin never ran here.
 */
export function readActivation(win: unknown = typeof window === 'undefined' ? undefined : window): ActivationRecord | undefined {
  if (!win || typeof win !== 'object') return undefined
  const value = (win as Record<string, unknown>)[ACTIVATION_GLOBAL]
  return value && typeof value === 'object' ? (value as ActivationRecord) : undefined
}

/** Fallback banner body: says which stage failed and with which error. */
function ActivationFailure({ stage, error }: { stage: string; error: ActivationError }): ReactElement {
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        zIndex: 2147483000,
        maxWidth: 'min(520px, calc(100vw - 32px))',
        padding: '12px 14px',
        borderRadius: '10px',
        border: '1px solid rgba(255, 120, 120, 0.55)',
        background: 'rgba(30, 12, 12, 0.92)',
        color: '#f4f4f5',
        font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {`dsh-ps-floating-panels 未能激活（阶段：${stage}）\n${error.name}: ${error.message}\n\n插件已按非致命方式退出，DSH 可正常使用。\n把这两行发给作者即可定位；页面全局 ${ACTIVATION_GLOBAL} 里有同样内容。`}
    </div>
  )
}

/**
 * Register the failure banner as an ordinary `shell.overlay` cell. Guarded end
 * to end: if the slots service itself is what failed, this throws and is
 * swallowed by the caller — `console.error` and {@link ACTIVATION_GLOBAL}
 * remain the diagnosis.
 */
function mountActivationBanner(ctx: PsClientContext, stage: string, error: unknown): void {
  const slots = ctx.slots
  if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return
  const described = describeError(error)
  slots.inject('shell.overlay', () => slots.register({
    name: 'shell.overlay',
    id: 'dsh-ps-floating-panels-activation-error',
    label: () => 'PS Panels (activation error)',
  }, () => <ActivationFailure stage={stage} error={described} />))
}

/* ------------------------------------------------------------------------- *
 * Resolved seams.
 * ------------------------------------------------------------------------- */

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

/**
 * Inject the plugin stylesheet, never throwing: a host without a usable
 * `document.head` loses the styling, not the plugin.
 */
function safeInjectStyles(): () => void {
  try {
    return injectPsStyles()
  } catch (error) {
    console.warn('[dsh-ps-floating-panels] stylesheet injection skipped:', error)
    return () => {}
  }
}

/**
 * Register a locale dictionary through `ctx.effect` when available.
 *
 * Registration is BEST EFFORT and must never be fatal:
 *  - the host locale service refuses a namespace+locale pair it already holds
 *    (`locale namespace "ps-panels" already has locale "zh"`), which a second
 *    activation on one page reaches;
 *  - a host that rejects the call keeps working, because this plugin ships its
 *    own dictionaries and only uses the host `t` for keys the host knows.
 *
 * The disposer is owned by `ctx.effect` when the host provides one, so a fiber
 * reload removes the dictionaries before the next registration.
 */
function registerLocale(ctx: PsClientContext): Translate {
  const locale = ctx.locale
  if (!locale || typeof locale.register !== 'function') return createTranslator(en)
  const register = (): unknown => {
    try {
      return locale.register(PS_LOCALE_NS, { zh, en })
    } catch (error) {
      console.warn(`[dsh-ps-floating-panels] locale registration skipped (${PS_LOCALE_NS}):`, error)
      return undefined
    }
  }
  if (typeof ctx.effect === 'function') {
    try {
      ctx.effect(register, 'dsh-ps-floating-panels: dictionaries')
    } catch (error) {
      console.warn('[dsh-ps-floating-panels] ctx.effect unavailable for dictionaries:', error)
      register()
    }
  } else {
    register()
  }
  let bound: Translate | undefined
  try {
    if (typeof locale.bind === 'function') bound = locale.bind(PS_LOCALE_NS)
  } catch (error) {
    console.warn(`[dsh-ps-floating-panels] locale bind skipped (${PS_LOCALE_NS}):`, error)
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
 * Never throws: any failure is logged, published and rendered as a banner, so a
 * UI plugin can never take the whole Web boot down (see the module docs).
 *
 * @param ctx - the client context (structurally typed above).
 * @param config - the row's config, if the host passes it; merged over defaults.
 */
export function apply(ctx: PsClientContext, config?: Partial<PsPanelsConfig>): void {
  let stage = 'styles'
  try {
    // Geometry stylesheet, once. Colours live in theme.css (bundled alongside).
    const removeStyles = safeInjectStyles()
    if (typeof ctx.effect === 'function') {
      try {
        ctx.effect(() => removeStyles, 'dsh-ps-floating-panels: styles')
      } catch {
        /* effect is best-effort; the stylesheet stays for the page lifetime */
      }
    }

    stage = 'config'
    // The config is LIVE, not read once: a settings edit (e.g. showStatusBadge)
    // re-renders the overlay without restarting DSH (see config-source.ts).
    const configSource = resolveConfigSource(ctx, SETTINGS_NAMESPACE, config ?? null)
    const initial = configSource.getSnapshot()
    if (!initial.enabled) {
      publishActivation({ ok: true, stage: 'disabled', build: CLIENT_BUILD, at: Date.now() })
      return
    }

    stage = 'conflicts'
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

    stage = 'locale'
    const t = registerLocale(ctx)

    stage = 'persist'
    const host = buildHostBridge(resolvePersistHooks(ctx))

    stage = 'slot'
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

    publishActivation({ ok: true, stage: 'active', build: CLIENT_BUILD, at: Date.now() })
    console.info(`[dsh-ps-floating-panels] active (build ${CLIENT_BUILD})`)
  } catch (error) {
    publishActivation({ ok: false, stage, build: CLIENT_BUILD, at: Date.now(), error: describeError(error) })
    console.error(`[dsh-ps-floating-panels] activation failed (stage: ${stage}, build ${CLIENT_BUILD}):`, error)
    try {
      mountActivationBanner(ctx, stage, error)
    } catch (bannerError) {
      console.error('[dsh-ps-floating-panels] activation banner unavailable:', bannerError)
    }
  }
}

/** Re-export the config/defaults so a host page can pre-fill settings. */
export { DEFAULT_CONFIG, normalizeConfig } from './config.ts'
export type { PanelId, PersistedLayout, PsPanelsConfig } from './config.ts'
