/**
 * dsh-ps-floating-panels — Host persistence bridge.
 *
 * The two halves of a dual-face dsh plugin run in DIFFERENT processes: this
 * browser half cannot call the Node half (`ctx.provide('psPanelsPersist')`
 * happens in the Host process and is unreachable from the page). The one seam
 * both sides share is the **settings document**: the Host half registers the
 * `dsh-ps-floating-panels` namespace, the client settings service
 * (`@deepseek-ai/dsh-client-ui-settings`) exposes it in the browser as a
 * revision-fenced write queue, and a committed `layout` write is mirrored by the
 * Host half into its durable snapshot file.
 *
 * So the browser persists the layout by writing one string field:
 *
 * ```ts
 * ctx.configForms.get('dsh-ps-floating-panels').set('layout', JSON.stringify(layout))
 * ```
 *
 * Everything here is structural and best-effort: a composition without the
 * settings provider (or a read-only / process-local one) simply keeps the
 * localStorage snapshot, and nothing in this module may ever throw into
 * activation.
 *
 * @module dsh-ps-floating-panels/client/host-bridge
 */

import type { PersistedLayout } from './config.ts'
import { isPersistedLayout, type LayoutHostBridge } from './layout-persist.ts'

/** The settings field the snapshot travels in (mirrors the Host `Config`). */
export const LAYOUT_FIELD = 'layout'

/** The slice of a `ConfigFormController` snapshot this bridge reads. */
export interface ConfigFormSnapshotLike {
  /** `ready` once the namespace is served and decoded. */
  readonly status?: string
  /** The decoded namespace section (an object carrying `layout`). */
  readonly value?: unknown
  /** Whether the Host accepts writes for this namespace. */
  readonly writable?: boolean
  /** `host` when the document is durable, `memory` when it is process-local. */
  readonly mode?: string
}

/** The slice of a `ConfigFormController` this bridge uses. */
export interface ConfigFormLike {
  getSnapshot(): ConfigFormSnapshotLike
  /** Queue one field write; resolves whether the Host accepted it. */
  set(field: string, value: unknown): Promise<boolean> | boolean
}

/** The slice of the `configForms` service this bridge uses. */
export interface ConfigFormsLike {
  get(namespace: string): ConfigFormLike
}

/**
 * Decode the snapshot out of a namespace section.
 *
 * The section is normally an object (`{ enabled, nativeAdopt, …, layout }`), but
 * a host that serves the raw string is accepted too, as is the serialized JSON
 * itself. Anything that is not a current-version {@link PersistedLayout} is
 * `null` (a v1 payload from an older build is deliberately discarded).
 */
export function readLayoutSnapshot(section: unknown): PersistedLayout | null {
  const text = typeof section === 'string'
    ? section
    : section && typeof section === 'object' && !Array.isArray(section)
      ? (section as Record<string, unknown>)[LAYOUT_FIELD]
      : undefined
  if (typeof text !== 'string' || text.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(text)
    return isPersistedLayout(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Wrap one settings form as a {@link LayoutHostBridge}.
 *
 * `saveLayout` is fire-and-forget by contract (the caller debounces); a refused
 * or read-only write only warns, because the local snapshot already holds the
 * layout.
 */
export function createHostLayoutBridge(form: ConfigFormLike, namespace: string): LayoutHostBridge {
  let warnedReadOnly = false
  return {
    loadLayout: (): PersistedLayout | null => {
      try {
        return readLayoutSnapshot(form.getSnapshot()?.value)
      } catch (error) {
        console.warn(`[dsh-ps-floating-panels] settings layout read failed (${namespace})`, error)
        return null
      }
    },
    saveLayout: (layout: PersistedLayout): void => {
      try {
        const snapshot = form.getSnapshot()
        if (snapshot?.writable === false) {
          if (!warnedReadOnly) {
            warnedReadOnly = true
            console.warn(`[dsh-ps-floating-panels] settings namespace ${namespace} is read-only; layout stays in localStorage`)
          }
          return
        }
        const result = form.set(LAYOUT_FIELD, JSON.stringify(layout))
        if (result && typeof (result as Promise<boolean>).then === 'function') {
          void (result as Promise<boolean>)
            .then((accepted) => {
              if (!accepted) console.warn(`[dsh-ps-floating-panels] settings rejected the layout write (${namespace})`)
            })
            .catch((error: unknown) => {
              console.warn(`[dsh-ps-floating-panels] settings layout write failed (${namespace})`, error)
            })
        } else if (result === false) {
          console.warn(`[dsh-ps-floating-panels] settings rejected the layout write (${namespace})`)
        }
      } catch (error) {
        console.warn(`[dsh-ps-floating-panels] settings layout write failed (${namespace})`, error)
      }
    },
  }
}

/**
 * Resolve the settings-backed bridge from a context, when the client settings
 * service is present on it.
 *
 * @param ctx - the context (or a scoped child context) to probe.
 * @param namespace - this plugin's settings namespace.
 * @returns the bridge, or `undefined` when this composition has no settings
 *          service (the plugin then persists locally only).
 */
export function resolveSettingsBridge(ctx: unknown, namespace: string): LayoutHostBridge | undefined {
  const service = ctx && typeof ctx === 'object' ? (ctx as { configForms?: ConfigFormsLike }).configForms : undefined
  if (!service || typeof service.get !== 'function') return undefined
  try {
    const form = service.get(namespace)
    if (!form || typeof form.getSnapshot !== 'function' || typeof form.set !== 'function') return undefined
    return createHostLayoutBridge(form, namespace)
  } catch (error) {
    console.warn(`[dsh-ps-floating-panels] settings bridge unavailable (${namespace})`, error)
    return undefined
  }
}
