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
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
/** Plugin name; MUST equal the package name, the cordis.patch.yml row name, the `__ModuleLoader__.load` id, and the settings namespace. */
export declare const name = "dsh-ps-floating-panels";
/** The settings namespace the Host serves and the browser half joins on. */
export declare const LAYOUT_NAMESPACE = "dsh-ps-floating-panels";
/**
 * Required services. Only `settings`: while it is absent the whole plugin stays
 * unmounted (a deployment with no settings provider has no config surface to
 * join).
 */
export declare const inject: string[];
/** Persisted layout format version; the client owns the payload, the host carries the version through. */
export declare const LAYOUT_VERSION = 2;
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
    enabled: boolean;
    /**
     * Adopt the host's own UI into the floating panels: the browser half moves the
     * real sidebar / main / right-column panes into its panels and hides the
     * native shell behind them. `false` keeps the native UI untouched and only
     * shows the launcher chip.
     */
    nativeAdopt: boolean;
    /** Show the floating launcher chip (adopt / reset / show-all). */
    showLauncher: boolean;
    /** Show the status badge summarising the panel layout. */
    showStatusBadge: boolean;
    /** Below this viewport width the browser half renders nothing (native mobile). */
    minDesktopWidth: number;
    /** Debounce for layout snapshots; 0 saves synchronously. */
    persistDebounceMs: number;
    /** Panels collapsed on first mount (before any snapshot exists). */
    collapsedPanels: string[];
    /** When true, hovering a collapsed panel peeks its content without pinning. */
    autoHideOnHover: boolean;
    /** JSON-serialized layout snapshot (empty string = no saved layout → defaults). */
    layout: string;
}
/** Schemastery schema for {@link Config}. */
export declare const Config: Schema<Config>;
/**
 * Host service backing the browser half's layout bridge. The client half probes
 * `ctx.psPanelsPersist` (and the page global `__DSH_PS_PANELS_PERSIST__`) for
 * exactly these methods, so the host exposes the same names.
 */
export interface PsPanelsPersist {
    /** Settings namespace the snapshot is joined on. */
    readonly namespace: string;
    /** Absolute path of the durable snapshot file. */
    readonly snapshotPath: string;
    /** Last layout snapshot (settings route first, then the durable file), or `null`. */
    loadLayout(): Record<string, unknown> | null;
    /** Persist a layout snapshot to the durable file (fire-and-forget). */
    saveLayout(layout: Record<string, unknown>): void;
    /** Discard the saved snapshot (the "reset layout" path). */
    resetLayout(): Promise<void>;
}
/** Root of this plugin's user data, under `$DSH_HOME` when set (the settings route), else `~/.dsh`. */
export declare function dataRoot(): string;
/** Absolute path of the durable layout snapshot file. */
export declare function snapshotPath(): string;
/**
 * Mount the plugin. Registers the settings namespace (config surface) and wires
 * the layout snapshot read/write seam, both inside `ctx.effect` so unloading the
 * plugin disposes them. Touches no agent/session state.
 *
 * @param ctx - the host context (carries `settings`).
 * @param config - this row's config as the Host resolved it (`base` layer).
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map