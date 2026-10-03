/**
 * Bundle scripts/logic.test.ts with esbuild and run it under node.
 * Run:  node scripts/run-logic-tests.mjs
 */
import { createRequire } from 'node:module'
import { rmSync } from 'node:fs'

const ROOT = 'F:/DSH pulls/dsh-ps-floating-panels'
const require = createRequire('F:/new1.2/node_modules/')
const esbuild = require('esbuild')

const out = `${ROOT}/.tmp/logic.test.cjs`
await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: ['scripts/logic.test.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: out,
  logLevel: 'info',
})

const { spawnSync } = await import('node:child_process')
const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
try { rmSync(`${ROOT}/.tmp`, { recursive: true, force: true }) } catch {}
process.exit(r.status ?? 1)
