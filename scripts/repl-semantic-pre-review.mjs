import { spawnSync } from 'node:child_process'

const steps = [
  {
    label: 'check partial staging',
    cmd: ['bun', 'run', 'check:partial-stage'],
  },
  {
    label: 'targeted REPL semantic tests',
    cmd: [
      'bun',
      'run',
      'test',
      '--',
      'src/features/repl/controller/canonicalTurnMessages.test.ts',
      'src/features/repl/controller/streaming.test.tsx',
      'src/features/repl/useReplController.test.tsx',
    ],
  },
  {
    label: 'canonical adapter contract fixture',
    cmd: ['bun', 'run', 'test', '--', 'src/features/semantics/adapters/canonicalEventAdapter.contract.test.ts'],
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
