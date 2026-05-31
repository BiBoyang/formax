import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const targetedReplSemanticTests = [
  'packages/core/src/features/repl/controller/canonical/canonicalTurnMessages.test.ts',
  'packages/core/src/features/repl/controller/streaming/streaming.test.tsx',
  'packages/core/src/features/repl/useReplController.test.tsx',
]

const canonicalAdapterContractTests = ['packages/core/src/features/semantics/adapters/canonicalEventAdapter.contract.test.ts']

const steps = [
  {
    label: 'check partial staging',
    cmd: ['bun', 'run', 'check:partial-stage'],
  },
  {
    label: 'single-writer semantic write-point gate',
    cmd: ['bun', 'run', 'check:repl-single-writer'],
  },
  {
    label: 'targeted REPL semantic tests',
    requiredPaths: targetedReplSemanticTests,
    cmd: ['bun', 'run', 'test', '--', ...targetedReplSemanticTests],
  },
  {
    label: 'canonical adapter contract fixture',
    requiredPaths: canonicalAdapterContractTests,
    cmd: ['bun', 'run', 'test', '--', ...canonicalAdapterContractTests],
  },
  {
    label: 'surface deterministic smoke',
    cmd: ['bun', 'run', 'test:surface-screen-model'],
  },
  {
    label: 'type check + boundaries',
    cmd: ['bun', 'run', 'type-check'],
  },
]

const requiredPaths = [...new Set(steps.flatMap((step) => step.requiredPaths ?? []))]
const missingPaths = requiredPaths.filter((path) => !existsSync(path))

if (missingPaths.length > 0) {
  process.stderr.write('\n[repl-semantic-gate] missing required path(s):\n')
  for (const path of missingPaths) {
    process.stderr.write(`- ${path}\n`)
  }
  process.exit(1)
}

for (const step of steps) {
  process.stdout.write(`\n[repl-semantic-gate] ${step.label}\n`)
  const result = spawnSync(step.cmd[0], step.cmd.slice(1), {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    process.stderr.write(`\n[repl-semantic-gate] failed at: ${step.label}\n`)
    process.exit(result.status ?? 1)
  }
}

process.stdout.write('\n[repl-semantic-gate] all checks passed\n')
