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
 * HARD BOUNDARY — this package never touches `agentLoop`, `sessions`, `agents`,
 * the tool pipeline, or any model-visible surface. It carries no agent state
 * and registers no tools. The layout is pure presentation state.
 *
 * @module dsh-ps-floating-panels
 */
import { readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Schema from '@deepseek-ai/schemastery';
/** Plugin name; MUST equal the package name, the cordis.patch.yml row name, the `__ModuleLoader__.load` id, and the settings namespace. */
export const name = 'dsh-ps-floating-panels';
/** The settings namespace the Host serves and the browser half joins on. */
export const LAYOUT_NAMESPACE = name;
/**
 * Required services. Only `settings`: while it is absent the whole plugin stays
 * unmounted (a deployment with no settings provider has no config surface to
 * join).
 */
export const inject = ['settings'];
/** Persisted layout format version; the client owns the payload, the host carries the version through. */
export const LAYOUT_VERSION = 1;
/** Schemastery schema for {@link Config}. */
export const Config = Schema.object({
    enabled: Schema.boolean().default(true),
    showLauncher: Schema.boolean().default(true),
    showStatusBadge: Schema.boolean().default(true),
    minDesktopWidth: Schema.number().step(1).min(0).default(768),
    layoutMode: Schema.union(['overlay', 'replace']).default('overlay'),
    persistDebounceMs: Schema.number().step(1).min(0).default(250),
    collapsedPanels: Schema.array(String).default([]),
    autoHideOnHover: Schema.boolean().default(false),
    layout: Schema.string().default(''),
});
/* -------------------------------------------------------------------------- *
 * Snapshot handling — the runtime boundary.
 *
 * The layout payload is opaque to the host (the client owns the Dockview grid
 * shape) but it arrives from the browser / a file, so it is only trusted once
 * it is valid JSON with an object (not array) top level.
 * -------------------------------------------------------------------------- */
/** Parse a serialized snapshot, returning `null` on empty/garbage/non-object input. */
function parseSnapshot(text) {
    if (typeof text !== 'string' || text.trim() === '')
        return null;
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/* -------------------------------------------------------------------------- *
 * Durable snapshot store. One small JSON file beside the host's settings area,
 * written atomically (temp file + rename) so a crash mid-write cannot leave a
 * truncated snapshot.
 * -------------------------------------------------------------------------- */
/** Root of this plugin's user data, under `$DSH_HOME` when set (the settings route), else `~/.dsh`. */
export function dataRoot() {
    const home = process.env.DSH_HOME?.trim();
    const base = home && home.length > 0 ? home : join(homedir(), '.dsh');
    return join(base, 'dsh-ps-floating-panels');
}
/** Absolute path of the durable layout snapshot file. */
export function snapshotPath() {
    return join(dataRoot(), 'layout.json');
}
class LayoutStore {
    /** Absolute path of the backing snapshot file. */
    file;
    cache = null;
    loaded = false;
    constructor(file) {
        this.file = file;
    }
    read() {
        if (!this.loaded) {
            this.loaded = true;
            try {
                const text = readFileSync(this.file, 'utf8');
                this.cache = parseSnapshot(text) === null ? null : text;
            }
            catch {
                this.cache = null;
            }
        }
        return this.cache;
    }
    async write(text) {
        if (parseSnapshot(text) === null)
            return null;
        await mkdir(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(tmp, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
        await rename(tmp, this.file);
        this.cache = text;
        this.loaded = true;
        return text;
    }
    async clear() {
        this.cache = null;
        this.loaded = true;
        await rm(this.file, { force: true });
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
export function apply(ctx, config) {
    const store = new LayoutStore(snapshotPath());
    const settings = ctx.settings;
    if (!settings || typeof settings.register !== 'function') {
        // No settings provider in this composition: there is no config surface to
        // join. Fail loud in the log but keep the process healthy.
        console.warn('[dsh-ps-floating-panels] host: `settings` service unavailable; config surface not mounted');
        return;
    }
    const service = {
        namespace: LAYOUT_NAMESPACE,
        snapshotPath: store.file,
        loadLayout() {
            // The settings provider is authoritative when it has a value; otherwise
            // fall back to the durable file.
            const route = parseSnapshot(scope.get().layout);
            if (route !== null)
                return route;
            const file = store.read();
            return file === null ? null : parseSnapshot(file);
        },
        saveLayout(layout) {
            const text = JSON.stringify(layout);
            void store.write(text).catch(() => { });
        },
        async resetLayout() {
            await store.clear();
        },
    };
    // Register the namespace on this plugin's fiber. `base` carries the row's
    // composition config (cordis.yml), which the user layer overrides; a
    // committed edit is mirrored into the durable snapshot in the same breath, so
    // a reset (empty layout) clears the file rather than leaving a stale one.
    const scope = settings.register(LAYOUT_NAMESPACE, Config, {
        base: config,
        applies: 'live',
        validate: (value) => {
            if (value.layout.trim() !== '' && parseSnapshot(value.layout) === null) {
                throw new Error('dsh-ps-floating-panels: layout must be a JSON object or empty');
            }
        },
    });
    const mirror = (layout) => {
        void (parseSnapshot(layout) !== null ? store.write(layout) : store.clear()).catch(() => { });
    };
    // `provide` is cordis's; a host old enough to lack it simply loses the
    // optional service bridge, not the settings namespace.
    const provide = ctx.provide;
    const provided = typeof provide === 'function' ? provide.call(ctx, 'psPanelsPersist', service) : undefined;
    ctx.effect(() => {
        const off = scope.watch((next) => { mirror(next.layout); });
        mirror(scope.get().layout);
        return () => {
            off();
            if (typeof provided === 'function')
                provided();
        };
    }, 'dsh-ps-floating-panels: settings namespace + layout snapshot');
}
//# sourceMappingURL=index.js.map