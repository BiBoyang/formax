#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const VALID_BUMPS = new Set(['prerelease', 'prepatch', 'preminor', 'premajor'])

function parseArgs(argv) {
  let bump = 'prerelease'
  let dryRun = false
  let skipVersion = false
  let skipGitCheck = false
  let help = false

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') {
      help = true
      continue
    }
    if (token === '--dry-run') {
      dryRun = true
      continue
    }
    if (token === '--skip-version') {
      skipVersion = true
      continue
    }
    if (token === '--skip-git-check') {
      skipGitCheck = true
      continue
    }
    if (token === '--bump') {
      const next = argv[i + 1]
      if (!next || next.startsWith('-')) {
        throw new Error('--bump 需要一个值：prerelease | prepatch | preminor | premajor')
      }
      bump = next
      i += 1
      continue
    }
    throw new Error(`未知参数: ${token}`)
  }

  if (!VALID_BUMPS.has(bump)) {
    throw new Error(`不支持的 bump 类型: ${bump}`)
  }

  return { bump, dryRun, skipVersion, skipGitCheck, help }
}

function runCommand(command, args, label) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) {
    throw new Error(`${label} 失败`)
  }
}

function printHelp() {
  process.stdout.write(`用法:
  bun run release:beta [-- --bump prerelease|prepatch|preminor|premajor] [--dry-run] [--skip-version] [--skip-git-check]

默认行为:
  1) npm version prerelease --preid=beta
  2) npm publish --tag beta --access public

常见示例:
  bun run release:beta
  bun run release:beta -- --bump prepatch
  bun run release:beta -- --dry-run --skip-version
`)
}

function assertGitCleanUnlessSkipped(skipGitCheck) {
  if (skipGitCheck) return

  const result = spawnSync('git', ['status', '--porcelain'], {
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    throw new Error('git 状态检查失败')
  }
  if (result.stdout.trim().length > 0) {
    throw new Error('工作区不是干净状态，请先提交或清理改动，再执行发布')
  }
}

function main() {
  const { bump, dryRun, skipVersion, skipGitCheck, help } = parseArgs(process.argv.slice(2))
  if (help) {
    printHelp()
    return
  }

  assertGitCleanUnlessSkipped(skipGitCheck)

  if (!skipVersion) {
    runCommand(
      'npm',
      ['version', bump, '--preid=beta', '-m', 'chore(release): %s'],
      '版本号更新'
    )
  } else {
    process.stdout.write('[release-beta] 跳过版本号更新\n')
  }

  const publishArgs = ['publish', '--tag', 'beta', '--access', 'public']
  if (dryRun) publishArgs.push('--dry-run')
  runCommand('npm', publishArgs, 'npm 发布')

  process.stdout.write('\n[release-beta] 完成\n')
  if (!dryRun) {
    process.stdout.write('[release-beta] 建议执行: git push origin HEAD --follow-tags\n')
  }
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[release-beta] ${message}\n`)
  process.exit(1)
}
