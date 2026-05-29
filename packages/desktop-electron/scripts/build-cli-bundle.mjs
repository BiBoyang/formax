#!/usr/bin/env bun

import { chmod, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outFile = process.argv[2]

if (!outFile) {
  console.error('Usage: bun ./scripts/build-cli-bundle.mjs <outfile>')
  process.exit(1)
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(appRoot, '..', '..')
const entrypointPath = path.join(repoRoot, 'packages', 'core', 'src', 'entrypoints', 'cli.tsx')

const result = await Bun.build({
  entrypoints: [entrypointPath],
  target: 'node',
  minify: true,
  write: false,
  external: ['ink', 'react', 'react/jsx-runtime'],
  plugins: [
    {
      name: 'desktop-runtime-react-devtools-stub',
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: 'react-devtools-core',
          namespace: 'desktop-runtime-shim',
        }))
        build.onLoad({ filter: /^react-devtools-core$/, namespace: 'desktop-runtime-shim' }, () => ({
          contents: 'export default { initialize() {}, connectToDevTools() {} };\n',
          loader: 'js',
        }))
      },
    },
  ],
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

const entrypoint = result.outputs.find((output) => output.kind === 'entry-point') ?? result.outputs[0]
if (!entrypoint) {
  console.error('Desktop CLI bundle did not produce an entry point')
  process.exit(1)
}

await mkdir(path.dirname(outFile), { recursive: true })
await Bun.write(outFile, entrypoint)
await chmod(outFile, 0o755)
