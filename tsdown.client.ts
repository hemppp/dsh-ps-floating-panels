/**
 * tsdown client preset for dsh-ps-floating-panels — a local reproduction of
 * the in-repo `shared/tsdown.client.ts` `clientBundle` preset. No published
 * package exposes that preset, so an out-of-repo package has to reproduce the
 * same output format itself (see cookbook-adding-a-settings-card.md §Packaging).
 *
 * The browser half must be the loader's LAZY-CJS FACTORY artifact:
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
 *
 * The `id` MUST equal the package name / Loader entry name
 * (`dsh-ps-floating-panels`); otherwise client-modules reports
 * "loaded without registering <id>" and the row never materializes.
 *
 * The specs the page module table owns — and therefore the ONLY things we
 * externalize — are React and the host's UI primitives. The factory receives a
 * `require` bound to the host's module table, so these resolve to the host's
 * single copy (never a second React instance):
 *   - react, react-dom, react/jsx-runtime
 *   - @deepseek-ai/dsh-client-ui-primitives
 *
 * Everything else is BUNDLED IN. In particular `dockview` / `dockview-react`
 * are NOT on the host module table (no host package depends on them), so a
 * `require('dockview')` at runtime would fail with "module not found" — they
 * must be inlined into this bundle. Dockview's own React imports still resolve
 * to the host React through the externals above.
 *
 * React baseline: ~18.3.1 (the host page's React).
 */

import { defineConfig, type UserConfig } from 'tsdown'

/** Package name == Loader entry name == `__ModuleLoader__.load` id. */
export const CLIENT_ID = 'dsh-ps-floating-panels'

/**
 * Exact non-inject module requests the bundle leaves to the host page: only the
 * loader module table's React + primitives entries. Inlining any of these would
 * fork the runtime (a second React breaks hooks). Everything NOT listed here —
 * notably dockview/dockview-react — is bundled in.
 */
export const CLIENT_EXTERNALS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/**
 * Open the lazy-CJS factory. `module`/`exports` are declared inside so the
 * emitted CommonJS body has a real object to write named exports onto, and the
 * factory's `require` is the page module table.
 */
const factoryIntro = (id: string): string =>
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;\n`

/** Close the factory, returning the module namespace the loader folds in. */
const factoryOutro = 'return module.exports; } });'

/**
 * The shared preset: a `client/` entry built into one lazy-CJS factory bundle
 * at `client/client.js`.
 * @param id - the package name (== Loader entry name) to register under.
 * @param entry - source entry, defaulting to `client/index.tsx`.
 * @returns a tsdown user config ready for `defineConfig`.
 */
export function clientBundle(
  id: string = CLIENT_ID,
  entry: string | string[] = 'client/index.tsx',
): UserConfig {
  return {
    entry: Array.isArray(entry) ? entry : [entry],
    format: ['cjs'],
    platform: 'browser',
    outDir: 'client',
    // Authored source lives under client/ (B 组); never let a build wipe it.
    clean: false,
    dts: false,
    sourcemap: true,
    external: [...CLIENT_EXTERNALS],
    outputOptions: {
      entryFileNames: 'client.js',
      intro: factoryIntro(id),
      footer: factoryOutro,
    },
  }
}

export default defineConfig(clientBundle())
