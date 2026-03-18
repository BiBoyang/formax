import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, '..')
const playwrightCli = path.join(packageRoot, 'node_modules', '@playwright', 'test', 'cli.js')

function parseArgs(argv) {
  const options = {
    task: 'TASK-0000-web-reference-acceptance',
    phase: 'after',
    label: null,
    scenario: 'default',
    external: false,
  }

  for (const arg of argv) {
    if (arg.startsWith('--task=')) {
      options.task = arg.slice('--task='.length)
      continue
    }
    if (arg.startsWith('--phase=')) {
      options.phase = arg.slice('--phase='.length)
      continue
    }
    if (arg.startsWith('--label=')) {
      options.label = arg.slice('--label='.length)
      continue
    }
    if (arg.startsWith('--scenario=')) {
      options.scenario = arg.slice('--scenario='.length)
      continue
    }
    if (arg === '--external') {
      options.external = true
      continue
    }

    console.error(`Unknown argument: ${arg}`)
    process.exit(1)
  }

  return options
}

const options = parseArgs(process.argv.slice(2))
const supportedPhases = new Set(['before', 'after'])
if (!supportedPhases.has(options.phase)) {
  console.error(`Unknown phase: ${options.phase}. Expected one of: before, after`)
  process.exit(1)
}

const evidenceSpecByScenario = {
  default: 'e2e/evidence.spec.js',
}

const evidenceSpec = evidenceSpecByScenario[options.scenario]
if (!evidenceSpec) {
  console.error(`Unknown scenario: ${options.scenario}`)
  process.exit(1)
}

const result = spawnSync(process.execPath, [playwrightCli, 'test', evidenceSpec, '--project=chromium'], {
  cwd: packageRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    RUN_EVIDENCE: 'true',
    EVIDENCE_TASK: options.task,
    EVIDENCE_PHASE: options.phase,
    EVIDENCE_LABEL: options.label ?? (options.phase === 'before' ? '01-repro' : '01-acceptance'),
    ...(options.external ? { PLAYWRIGHT_SKIP_WEBSERVER: '1' } : {}),
  },
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
