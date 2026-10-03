/**
 * Local client-bundle builder — an esbuild-based reproduction of the tsdown
 * `clientBundle` preset (tsdown itself is not installed on this machine, but
 * the OUTPUT contract is what matters and is identical):
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
 *
 * Externals are ONLY the host module table's React + primitives; dockview and
 * dockview-react are BUNDLED IN (they are not on the host module table).
 *
 * Run:  node scripts/build-client.mjs
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = 'F:/DSH pulls/dsh-ps-floating-panels'

// esbuild lives in the machine's shared node_modules (see tsconfig.check.json).
const require = createRequire('F:/new1.2/node_modules/')
const esbuild = require('esbuild')

const ID = 'dsh-ps-floating-panels'
const EXTERNALS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const intro = `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;\n`
const outro = '\nreturn module.exports; } });\n'

const result = await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: ['client/index.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  outfile: 'client/client.js',
  external: EXTERNALS,
  // Inlined packages (dockview/dockview-react/dockview-core) live in the
  // machine's shared node_modules, so add it as a resolution root.
  nodePaths: ['F:/new1.2/node_modules'],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: intro },
  footer: { js: outro },
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
})

writeFileSync(`${ROOT}/client/client.meta.json`, JSON.stringify(result.metafile, null, 1))
const bytes = readFileSync(`${ROOT}/client/client.js`)
console.log(`\nclient/client.js = ${bytes.length} bytes (${(bytes.length / 1024).toFixed(0)} KiB)`)
console.log('first line:', bytes.toString('utf8').split('\n')[0].slice(0, 140))
