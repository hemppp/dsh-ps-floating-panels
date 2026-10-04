/**
 * dsh-ps-floating-panels — boot-time conflict detection.
 *
 * The split/floating system takes over the shell overlay and reorganizes the
 * app's panels. Another plugin that ALSO docks panels, registers an overlay, or
 * drives a layout would fight it for the same surfaces (double registration,
 * two grids, clobbered layout state). This module reads the boot graph the host
 * injects as `window.__DSH_BOOT__` and reports the entries that look like such
 * a plugin.
 *
 * It is defensive by design:
 *  - `window.__DSH_BOOT__` may be absent (older host, non-web host, early
 *    boot) — then detection is skipped silently, never throwing.
 *  - Entries may be malformed — each is validated before use.
 *  - The plugin's own id is never reported.
 *  - The host's own client packages are never reported, whatever they are
 *    called ({@link HOST_SCOPES}); the shipped shell registers keyword-bearing
 *    ids of its own, and advising the user to disable the shell is worse than
 *    saying nothing.
 *
 * Detection is intentionally a heuristic over the ENTRY IDs (package names),
 * because entry `id` is the wire-stable identity the host composes. A matching
 * keyword plus "neither this package nor the host" is enough to warn; the user
 * decides. Entry rows carry no built-in flag — `id` is the only discriminator.
 *
 * @module dsh-ps-floating-panels/client/conflict-detect
 */

/** This package's id — never reported as a conflict. */
export const SELF_ID = 'dsh-ps-floating-panels'

/**
 * Package-name prefixes owned by the DeepSeek Harness distribution itself.
 *
 * Host client packages are NEVER conflicts: they are the shell the user is
 * already looking at. This exclusion is what keeps the detector usable — the
 * shipped shell itself registers keyword-bearing client entries
 * (`@deepseek-ai/dsh-client-ui-layout` owns the `shell.overlay` slot this plugin
 * mounts into; `@deepseek-ai/dsh-client-ui-dockkit` owns the split-tree and
 * floating implementation). Without it, every single boot reports the host and
 * tells the user to disable it, which would tear the shell down.
 *
 * A `WebBootEntry` row carries no built-in flag (only `id`/`url`/`rev` and
 * optional edges), so the id's scope is the only available discriminator.
 */
export const HOST_SCOPES: readonly string[] = ['@deepseek-ai/']

/**
 * Entry-id keywords that mark a plugin as owning overlapping surfaces. Kept in
 * one place so a false positive can be tuned without touching the graph walk.
 */
export const CONFLICT_KEYWORDS: readonly string[] = [
  'dock',
  'panel',
  'overlay',
  'layout',
  'floating',
]

/** One composed client entry row, as far as this module needs it. */
export interface BootEntryLike {
  id?: unknown
}

/** The subset of the boot graph this module reads. */
export interface BootGraphLike {
  entries?: unknown
}

/** A detected conflicting plugin. */
export interface ConflictEntry {
  /** Entry id (package name). */
  readonly id: string
  /** Which keyword matched. */
  readonly keyword: string
}

/** Is an entry id this plugin's own? (also matches the versioned variants) */
export function isSelf(id: string): boolean {
  return id === SELF_ID || id.startsWith(SELF_ID + '@') || id.includes(SELF_ID)
}

/** Is an entry id part of the host distribution rather than a third-party plugin? */
export function isHostPackage(id: string): boolean {
  const lower = id.toLowerCase()
  return HOST_SCOPES.some((scope) => lower.startsWith(scope))
}

/**
 * Split an entry id into lower-case word segments: on every non-alphanumeric
 * boundary (npm scope, `/`, `.`, `-`, `_`) and on lower→upper camelCase
 * transitions.
 */
function idSegments(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Should a boot entry be treated as conflicting? Matching is case-insensitive
 * and word-boundary based on the id's segments, so `@scope/my-panel-dock` and
 * `some.dockview.panels` both match while an unrelated `panelize-lint` does
 * not; a bare plural segment (`my-floating-panels`) matches its keyword too.
 *
 * Segment equality (rather than a substring test) is deliberate: the dialog is
 * shown at boot and asks the user to act, so a name that merely *contains* a
 * keyword is not enough evidence of surface overlap.
 */
export function matchesConflictKeyword(id: string): string | undefined {
  const segments = new Set(idSegments(id))
  return CONFLICT_KEYWORDS.find((kw) => segments.has(kw) || segments.has(kw + 's'))
}

/**
 * Scan a boot graph for conflicting entries.
 *
 * @param graph - the value of `window.__DSH_BOOT__` (any shape; validated here).
 * @returns conflicts in entry order; empty when the graph is absent or clean.
 */
export function detectConflicts(graph: unknown): ConflictEntry[] {
  if (!graph || typeof graph !== 'object') return []
  const entries = (graph as BootGraphLike).entries
  if (!Array.isArray(entries)) return []
  const out: ConflictEntry[] = []
  const seen = new Set<string>()
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue
    const id = (raw as BootEntryLike).id
    if (typeof id !== 'string' || id.length === 0) continue
    if (isSelf(id) || isHostPackage(id) || seen.has(id)) continue
    const keyword = matchesConflictKeyword(id)
    if (keyword === undefined) continue
    seen.add(id)
    out.push({ id, keyword })
  }
  return out
}

/** Read `window.__DSH_BOOT__` without assuming a DOM-less host. */
export function readBootGraph(win: unknown = typeof window === 'undefined' ? undefined : window): unknown {
  if (!win || typeof win !== 'object') return undefined
  return (win as { __DSH_BOOT__?: unknown }).__DSH_BOOT__
}

/**
 * Convenience: detect conflicts straight from a `window`. Never throws.
 *
 * @param win - the window to read (defaults to the global window).
 * @returns { graphPresent, conflicts }.
 */
export function detectConflictsFromWindow(
  win: unknown = typeof window === 'undefined' ? undefined : window,
): { graphPresent: boolean; conflicts: ConflictEntry[] } {
  try {
    const graph = readBootGraph(win)
    if (graph === undefined || graph === null) return { graphPresent: false, conflicts: [] }
    return { graphPresent: true, conflicts: detectConflicts(graph) }
  } catch {
    return { graphPresent: false, conflicts: [] }
  }
}
