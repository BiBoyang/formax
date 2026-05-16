import fs from 'node:fs'
import path from 'node:path'
import { evaluateRootScriptGovernance } from '../packages/core/src/shared/utils/rootScriptGovernance.mjs'

function parseArgs(argv) {
  const options = {
    packagePath: 'package.json',
    configPath: 'scripts/baselines/root-script-governance.json',
  }

  for (const arg of argv) {
    if (arg.startsWith('--package=')) {
      options.packagePath = arg.slice('--package='.length)
      continue
    }
    if (arg.startsWith('--config=')) {
      options.configPath = arg.slice('--config='.length)
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function loadJson(absPath) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`)
  }
  const raw = fs.readFileSync(absPath, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON at ${absPath}: ${detail}`)
  }
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`[root-script-governance] ${detail}`)
    process.exit(1)
  }

  const packagePath = path.resolve(process.cwd(), options.packagePath)
  const configPath = path.resolve(process.cwd(), options.configPath)
  const packageJson = loadJson(packagePath)
  const config = loadJson(configPath)

  const result = evaluateRootScriptGovernance({
    scripts: packageJson.scripts ?? {},
    config,
    now: new Date(),
  })

  if (result.violations.length > 0) {
    console.error(
      `[root-script-governance] check failed. scripts=${result.stats.scriptCount}, violations=${result.violations.length}`,
    )
    for (const violation of result.violations) {
      console.error(`- [${violation.code}] ${violation.script}: ${violation.message}`)
    }
    console.error('Guidance:')
    console.error('- Keep feature-level commands in the owning package package.json.')
    console.error('- Root package.json should remain orchestration-only.')
    console.error('- For approved temporary exceptions, register owner/replacement/expiresOn in baseline config.')
    process.exit(1)
  }

  console.log(
    `[root-script-governance] check passed. scripts=${result.stats.scriptCount}, frozen=${result.stats.frozenCount}, exceptions=${result.stats.exceptionCount}`,
  )
}

main()
