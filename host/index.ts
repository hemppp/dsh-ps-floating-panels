/**
 * dsh-ps-floating-panels — host half.
 *
 * The node half of a dual-face dsh Web GUI plugin (Photoshop-style Dockview
 * floating/split panel system). The browser half lives under `client/` and is
 * served by client-modules from this package's `dsh.client` declaration at
 * `/plugins/dsh-ps-floating-panels/client.js`.
 *
 * SCOPE — this half does exactly two things, and nothing else:
 *   1. Register the plugin's settings namespace through `ctx.settings.register`
 *      (the user-settings seam), so the Host serves the config surface — the
 *      panel-system options plus the serialized `layout` snapshot — and
 *      persists user edits. The returned owner scope is watched: a committed
 *      `layout` write is mirrored into the durable snapshot file.
 *   2. Read/write that layout JSON snapshot, wired through `ctx.effect` so it is
 *      disposed with the plugin. The durable store lives beside the host's
 *      settings area (`$DSH_HOME`).
 *
 * The browser half reaches the settings document through the client settings
 * service (`ctx.configForms.get(namespace)` → `set('layout', json)`), which is
 * the ONLY transport between the two halves: there is no direct Node↔browser
 * call. A committed write lands here as a `scope.watch` notification and is
 * mirrored to the snapshot file, so the settings document stays authoritative
 * and the file survives a settings reset.
 *
 * HARD BOUNDARY — this package never touches `agentLoop`, `sessions`, `agents`,
 * the tool pipeline, or any model-visible surface. It carries no agent state
 * and registers no tools. The layout is pure presentation state.
 *
 * @module dsh-ps-floating-panels
 */

import { readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

/** Plugin name; MUST equal the package name, the cordis.patch.yml row name, the `__ModuleLoader__.load` id, and the settings namespace. */
export const name = 'dsh-ps-floating-panels'

/** The settings namespace the Host serves and the browser half joins on. */
export const LAYOUT_NAMESPACE = name

/**
 * Required services. Only `settings`: while it is absent the whole plugin stays
 * unmounted (a deployment with no settings provider has no config surface to
 * join).
 */
export const inject = ['settings']

/** Persisted layout format version; the client owns the payload, the host carries the version through. */
export const LAYOUT_VERSION = 2

/**
 * The plugin's Config, as the Host validates this row's profile patch against
 * and the settings service generates the entry's page from.
 *
 * The non-layout fields mirror the browser half's `PsPanelsConfig`
 * (`client/config.ts`); the `layout` field is the serialized Dockview snapshot
 * the browser half writes back. Keeping `layout` a single JSON string means the
 * settings document stays schema-checkable while the Dockview grid shape
 * evolves freely.
 */
export interface Config {
  /** Master switch: when false the browser half mounts nothing. */
  enabled: boolean
  /**
   * Adopt the host's own UI into the floating panels: the browser half moves the
   * real sidebar / main / right-column panes into its panels and hides the
   * native shell behind them. `false` keeps the native UI untouched and only
   * shows the launcher chip.
   */
  nativeAdopt: boolean
  /** Show the floating launcher chip (adopt / reset / show-all). */
  showLauncher: boolean
  /** Show the status badge summarising the panel layout. */
  showStatusBadge: boolean
  /** Below this viewport width the browser half renders nothing (native mobile). */
  minDesktopWidth: number
  /** Debounce for layout snapshots; 0 saves synchronously. */
  persistDebounceMs: number
  /** Panels collapsed on first mount (before any snapshot exists). */
  collapsedPanels: string[]
  /** When true, hovering a collapsed panel peeks its content without pinning. */
  autoHideOnHover: boolean
  /** JSON-serialized layout snapshot (empty string = no saved layout → defaults). */
  layout: string
}

/** Schemastery schema for {@link Config}. */
export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  nativeAdopt: Schema.boolean().default(true),
  showLauncher: Schema.boolean().default(true),
  showStatusBadge: Schema.boolean().default(true),
  minDesktopWidth: Schema.number().step(1).min(0).default(768),
  persistDebounceMs: Schema.number().step(1).min(0).default(250),
  collapsedPanels: Schema.array(String).default([]),
  autoHideOnHover: Schema.boolean().default(false),
  layout: Schema.string().default(''),
})

/* -------------------------------------------------------------------------- *
 * Structural settings seam.
 *
 * The `settings` service is declared by `@deepseek-ai/dsh-settings`, which the
 * DSH profile provides at runtime (the package declares no official
 * `@deepseek-ai/*` dependency; see package.json). To keep the host half
 * buildable and loadable when that service is absent from a given profile's flat
 * fallback, the service is described STRUCTURALLY here (the same discipline the
 * browser half uses for the client context) instead of importing its types.
 * The shape below mirrors the official `dsh-settings` Cordis API: an owner scope
 * with `get()` / `watch()` / `update()` / `replace()`.
 * -------------------------------------------------------------------------- */

/** Owner-facing handle for one registered settings namespace. */
interface SettingsScope<T> {
  /** Current resolved value: schema defaults, then `base`, then the user layer. */
  get(): T
  /** Observe committed changes; returns the disposer that removes the observer. */
  watch(callback: (next: T, prev: T) => void): () => void
  /** Merge a partial patch into this namespace's user layer and persist it. */
  update(patch: Partial<T>): Promise<void>
  /** Replace the namespace's user section wholesale (`replace({})` resets all). */
  replace(section: Partial<T>): Promise<void>
}

/** Registration options beyond the namespace schema. */
interface SettingsRegisterOptions<T> {
  /** Composition-layer values resolved below the user layer. */
  base?: Partial<T>
  /** Owner's effect timing, surfaced to configuration UIs; defaults to `live`. */
  applies?: 'live' | 'restart'
  /** Reject a resolved section the schema cannot express (cross-field checks). */
  validate?: (value: T) => void
}

/** The subset of the `settings` service this plugin touches. */
interface SettingsService {
  register<T>(ns: string, schema: unknown, options?: SettingsRegisterOptions<T>): SettingsScope<T>
}

/**
 * Host service exposing the layout snapshot to NODE-side consumers.
 *
 * The browser half cannot reach this object (it is provided on the Host
 * process's context, while the page has its own client context): the browser
 * writes the layout through the settings document instead — see
 * `client/host-bridge.ts` — and a committed `layout` write is mirrored into the
 * durable file by the watcher in {@link apply}.
 */
export interface PsPanelsPersist {
  /** Settings namespace the snapshot is joined on. */
  readonly namespace: string
  /** Absolute path of the durable snapshot file. */
  readonly snapshotPath: string
  /** Last layout snapshot (settings route first, then the durable file), or `null`. */
  loadLayout(): Record<string, unknown> | null
  /** Persist a layout snapshot to the durable file (fire-and-forget). */
  saveLayout(layout: Record<string, unknown>): void
  /** Discard the saved snapshot (the "reset layout" path). */
  resetLayout(): Promise<void>
}

/* -------------------------------------------------------------------------- *
 * Snapshot handling — the runtime boundary.
 *
 * The layout payload is opaque to the host (the client owns the Dockview grid
 * shape) but it arrives from the browser / a file, so it is only trusted once
 * it is valid JSON with an object (not array) top level.
 * -------------------------------------------------------------------------- */

/** Parse a serialized snapshot, returning `null` on empty/garbage/non-object input. */
function parseSnapshot(text: string | undefined): Record<string, unknown> | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- *
 * Durable snapshot store. One small JSON file beside the host's settings area,
 * written atomically (temp file + rename) so a crash mid-write cannot leave a
 * truncated snapshot.
 * -------------------------------------------------------------------------- */

/** Root of this plugin's user data, under `$DSH_HOME` when set (the settings route), else `~/.dsh`. */
export function dataRoot(): string {
  const home = process.env.DSH_HOME?.trim()
  const base = home && home.length > 0 ? home : join(homedir(), '.dsh')
  return join(base, 'dsh-ps-floating-panels')
}

/** Absolute path of the durable layout snapshot file. */
export function snapshotPath(): string {
  return join(dataRoot(), 'layout.json')
}

class LayoutStore {
  /** Absolute path of the backing snapshot file. */
  readonly file: string
  private cache: string | null = null
  private loaded = false

  constructor(file: string) {
    this.file = file
  }

  read(): string | null {
    if (!this.loaded) {
      this.loaded = true
      try {
        const text = readFileSync(this.file, 'utf8')
        this.cache = parseSnapshot(text) === null ? null : text
      } catch {
        this.cache = null
      }
    }
    return this.cache
  }

  async write(text: string): Promise<string | null> {
    if (parseSnapshot(text) === null) return null
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(tmp, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
    await rename(tmp, this.file)
    this.cache = text
    this.loaded = true
    return text
  }

  async clear(): Promise<void> {
    this.cache = null
    this.loaded = true
    await rm(this.file, { force: true })
  }
}

/* -------------------------------------------------------------------------- *
 * Plugin entry.
 * -------------------------------------------------------------------------- */

/**
 * Mount the plugin. Registers the settings namespace (config surface) and wires
 * the layout snapshot read/write seam, both inside `ctx.effect` so unloading the
 * plugin disposes them. Touches no agent/session state.
 *
 * @param ctx - the host context (carries `settings`).
 * @param config - this row's config as the Host resolved it (`base` layer).
 */
export function apply(ctx: Context, config: Config): void {
  const store = new LayoutStore(snapshotPath())
  const settings = (ctx as unknown as { settings?: SettingsService }).settings
  if (!settings || typeof settings.register !== 'function') {
    // No settings provider in this composition: there is no config surface to
    // join. Fail loud in the log but keep the process healthy.
    console.warn('[dsh-ps-floating-panels] host: `settings` service unavailable; config surface not mounted')
    return
  }

  const service: PsPanelsPersist = {
    namespace: LAYOUT_NAMESPACE,
    snapshotPath: store.file,
    loadLayout() {
      // The settings provider is authoritative when it has a value; otherwise
      // fall back to the durable file.
      const route = parseSnapshot(scope.get().layout)
      if (route !== null) return route
      const file = store.read()
      return file === null ? null : parseSnapshot(file)
    },
    saveLayout(layout) {
      const text = JSON.stringify(layout)
      void store.write(text).catch(() => {})
    },
    async resetLayout() {
      await store.clear()
    },
  }

  // Register the namespace on this plugin's fiber. `base` carries the row's
  // composition config (cordis.yml), which the user layer overrides; a
  // committed edit is mirrored into the durable snapshot in the same breath, so
  // a reset (empty layout) clears the file rather than leaving a stale one.
  const scope = settings.register<Config>(LAYOUT_NAMESPACE, Config, {
    base: config,
    applies: 'live',
    validate: (value) => {
      if (value.layout.trim() !== '' && parseSnapshot(value.layout) === null) {
        throw new Error('dsh-ps-floating-panels: layout must be a JSON object or empty')
      }
    },
  })

  const mirror = (layout: string): void => {
    void (parseSnapshot(layout) !== null ? store.write(layout) : store.clear()).catch(() => {})
  }

  // `provide` is cordis's; a host old enough to lack it simply loses the
  // optional service bridge, not the settings namespace.
  const provide = (ctx as unknown as { provide?: (key: string, value: unknown) => unknown }).provide
  const provided = typeof provide === 'function' ? provide.call(ctx, 'psPanelsPersist', service) : undefined

  ctx.effect(() => {
    const off = scope.watch((next) => { mirror(next.layout) })
    mirror(scope.get().layout)
    return () => {
      off()
      if (typeof provided === 'function') (provided as () => void)()
    }
  }, 'dsh-ps-floating-panels: settings namespace + layout snapshot')
}
