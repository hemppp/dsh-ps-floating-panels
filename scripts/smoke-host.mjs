/**
 * Bundle scripts/host.test.ts (with host/index.ts + real cordis/schemastery)
 * and run it under node. Run:  node scripts/smoke-host.mjs
 */
import { createRequire } from 'node:module'
import { rmSync } from 'node:fs'

const ROOT = 'F:/DSH pulls/dsh-ps-floating-panels'
const require = createRequire('F:/new1.2/node_modules/')
const esbuild = require('esbuild')

const out = `${ROOT}/.tmp/host.test.mjs`
await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: ['scripts/host.test.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: out,
  nodePaths: ['F:/new1.2/node_modules'],
  logLevel: 'warning',
})

const { spawnSync } = await import('node:child_process')
const r = spawnSync(process.execPath, [out], { stdio: 'inherit', env: process.env })
try { rmSync(`${ROOT}/.tmp`, { recursive: true, force: true }) } catch {}
process.exit(r.status ?? 1)
