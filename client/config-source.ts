/**
 * dsh-ps-floating-panels — reactive config source.
 *
 * Requirement: toggling a boolean setting (e.g. `showStatusBadge`) must take
 * effect live, without restarting DSH. The client half therefore does NOT read
 * its config once at mount; it resolves a {@link ConfigSource} and renders
 * through `useSyncExternalStore`, so a committed settings change re-renders the
 * overlay immediately.
 *
 * Resolution order (first source that yields a value wins for each field; the
 * merged result is normalized):
 *
 *   1. `ctx.settingsScope` / `ctx.settings` — the client-side settings service
 *      (present in web compositions that ship a settings page). Probed
 *      structurally; absent on older hosts, which is a silent skip.
 *   2. `window.__DSH_PS_PANELS_CONFIG__` — a page-global bridge a host may
 *      publish, either as a plain snapshot object or as
 *      `{ get(), subscribe(cb) }`.
 *   3. the row config passed to `apply(ctx, config)` (static).
 *   4. `DEFAULT_CONFIG`.
 *
 * The source caches its snapshot object so `getSnapshot()` is referentially
 * stable between changes — required by `useSyncExternalStore`.
 *
 * @module dsh-ps-floating-panels/client/config-source
 */

import { DEFAULT_CONFIG, normalizeConfig, type PsPanelsConfig } from './config.ts'

/** Page-global key a host/bridge may publish the (live) config under. */
export const CONFIG_GLOBAL = '__DSH_PS_PANELS_CONFIG__'

/** A referentially-stable, subscribable view of the effective config. */
export interface ConfigSource {
  /** Current effective config (stable object until it changes). */
  getSnapshot(): PsPanelsConfig
  /** Subscribe to changes; returns the unsubscribe function. */
  subscribe(onChange: () => void): () => void
}

/** A source that never changes (used when no live source is available). */
export function staticConfigSource(raw: Partial<PsPanelsConfig> | null | undefined): ConfigSource {
  const snapshot = normalizeConfig(raw)
  return { getSnapshot: () => snapshot, subscribe: () => () => {} }
}

/** Shape a page-global / client service may expose. */
interface LiveConfigHost {
  get?: () => unknown
  bind?: (opts: { namespace: string }) => { get?: () => unknown; subscribe?: (cb: () => void) => () => void } | undefined
  subscribe?: (cb: () => void) => () => void
}

/** Read a raw config value from a candidate live host, guarded. */
function readHost(host: LiveConfigHost | undefined, namespace: string): unknown {
  if (!host) return undefined
  try {
    if (typeof host.get === 'function') return host.get()
    if (typeof host.bind === 'function') {
      const bound = host.bind({ namespace })
      if (bound && typeof bound.get === 'function') return bound.get()
    }
  } catch {
    /* a bad host must not break the overlay */
  }
  return undefined
}

/** Subscribe to a candidate live host, guarded. Returns a no-op when unusable. */
function subscribeHost(host: LiveConfigHost | undefined, namespace: string, cb: () => void): () => void {
  if (!host) return () => {}
  try {
    if (typeof host.subscribe === 'function') return host.subscribe(cb)
    if (typeof host.bind === 'function') {
      const bound = host.bind({ namespace })
      if (bound && typeof bound.subscribe === 'function') return bound.subscribe(cb)
    }
  } catch {
    /* ignore */
  }
  return () => {}
}

/**
 * Build the reactive config source for this plugin.
 *
 * @param ctx - the client context (structurally typed by the caller).
 * @param namespace - the settings namespace (`dsh-ps-floating-panels`).
 * @param rowConfig - the config the host passed to `apply` (static fallback).
 */
export function resolveConfigSource(
  ctx: { settingsScope?: unknown; settings?: unknown },
  namespace: string,
  rowConfig: Partial<PsPanelsConfig> | null | undefined,
): ConfigSource {
  const serviceHost = (ctx.settingsScope ?? ctx.settings) as LiveConfigHost | undefined
  const globalHost = typeof window === 'undefined'
    ? undefined
    : ((window as unknown as Record<string, unknown>)[CONFIG_GLOBAL] as LiveConfigHost | Record<string, unknown> | undefined)

  // A plain object global is a static snapshot; an object with get/subscribe is live.
  const globalLive: LiveConfigHost | undefined =
    globalHost && typeof globalHost === 'object' && (typeof (globalHost as LiveConfigHost).get === 'function' || typeof (globalHost as LiveConfigHost).subscribe === 'function')
      ? (globalHost as LiveConfigHost)
      : undefined
  const globalStatic: Partial<PsPanelsConfig> | undefined =
    globalHost && typeof globalHost === 'object' && globalLive === undefined
      ? (globalHost as Partial<PsPanelsConfig>)
      : undefined

  const readRaw = (): Partial<PsPanelsConfig> => {
    const fromService = readHost(serviceHost, namespace)
    const fromGlobal = globalLive ? readHost(globalLive, namespace) : globalStatic
    const merged = {
      ...(rowConfig ?? {}),
      ...(fromGlobal && typeof fromGlobal === 'object' ? fromGlobal : {}),
      ...(fromService && typeof fromService === 'object' ? fromService : {}),
    } as Partial<PsPanelsConfig>
    return merged
  }

  let cached: PsPanelsConfig = normalizeConfig(readRaw())
  const listeners = new Set<() => void>()

  const refresh = (): void => {
    const next = normalizeConfig(readRaw())
    // Only swap the snapshot when something actually changed, so
    // useSyncExternalStore does not loop.
    if (JSON.stringify(next) !== JSON.stringify(cached)) {
      cached = next
      for (const l of listeners) l()
    }
  }

  const offService = subscribeHost(serviceHost, namespace, refresh)
  const offGlobal = globalLive ? subscribeHost(globalLive, namespace, refresh) : () => {}
  // A page bridge that only replaces the global object (no subscribe) is still
  // picked up on focus/visibility, which covers the common "edit settings in a
  // panel, return to the overlay" flow.
  const onWake = (): void => refresh()
  const hasWindow = typeof window !== 'undefined'
  const hasDocument = typeof document !== 'undefined'
  if (hasWindow) window.addEventListener('focus', onWake)
  if (hasDocument) document.addEventListener?.('visibilitychange', onWake)

  return {
    getSnapshot: () => cached,
    subscribe(onChange: () => void): () => void {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
        if (listeners.size === 0) {
          offService()
          offGlobal()
          if (hasWindow) window.removeEventListener('focus', onWake)
          if (hasDocument) document.removeEventListener?.('visibilitychange', onWake)
        }
      }
    },
  }
}
