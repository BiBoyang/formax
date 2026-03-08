#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const VALID_BUMPS = new Set(['prerelease', 'prepatch', 'preminor', 'premajor'])

function parseArgs(argv) {
  let bump = 'prerelease'
  let dryRun = false
  let skipVersion = false
  let skipGitCheck = false
  let skipAuthCheck = false
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
    if (token === '--skip-auth-check') {
      skipAuthCheck = true
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

  return { bump, dryRun, skipVersion, skipGitCheck, skipAuthCheck, help }
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

function runCommandCapture(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim()
    const stdout = (result.stdout ?? '').trim()
    const details = stderr || stdout || '无详细输出'
    throw new Error(`${label} 失败\n${details}`)
  }
  return (result.stdout ?? '').trim()
}

function printHelp() {
  process.stdout.write(`用法:
  bun run release:beta [-- --bump prerelease|prepatch|preminor|premajor] [--dry-run] [--skip-version] [--skip-git-check] [--skip-auth-check]

默认行为:
  1) npm 账号与发布权限预检查（whoami / token / collaborator 权限）
  2) npm version prerelease --preid=beta
  3) npm publish --tag beta --access public

常见示例:
  bun run release:beta
  bun run release:beta -- --bump prepatch
  bun run release:beta -- --dry-run --skip-version
  bun run release:beta -- --skip-auth-check
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

function readPackageNameFromManifest() {
  let parsed
  try {
    parsed = JSON.parse(readFileSync('package.json', 'utf8'))
  } catch {
    throw new Error('读取 package.json 失败，无法获取包名')
  }

  const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  if (!name) {
    throw new Error('package.json 缺少有效的 name 字段，无法做发布权限检查')
  }

  return name
}

function findTokenByMask(tokens, rawToken) {
  if (!rawToken) return null
  const prefix = rawToken.slice(0, 8)
  const suffix = rawToken.slice(-4)
  if (!prefix || !suffix) return null

  for (const token of tokens) {
    if (!token || typeof token !== 'object') continue
    if (typeof token.token !== 'string') continue
    if (token.token.startsWith(prefix) && token.token.endsWith(suffix)) {
      return token
    }
  }
  return null
}

function assertNpmPublishPreflight({ dryRun, skipAuthCheck }) {
  if (skipAuthCheck) {
    process.stdout.write('[release-beta] 跳过 npm 认证/权限预检查 (--skip-auth-check)\n')
    return
  }

  const whoami = runCommandCapture(
    'npm',
    ['whoami', '--registry', 'https://registry.npmjs.org/'],
    'npm 账号检查'
  )
  process.stdout.write(`[release-beta] npm 身份: ${whoami}\n`)

  const currentEnvToken = (process.env.NPM_TOKEN ?? '').trim()
  if (currentEnvToken) {
    try {
      const tokenListRaw = runCommandCapture('npm', ['token', 'list', '--json'], 'npm token 列表检查')
      const tokenList = JSON.parse(tokenListRaw)
      const matched = Array.isArray(tokenList) ? findTokenByMask(tokenList, currentEnvToken) : null
      if (matched && matched.bypass_2fa === false) {
        throw new Error(
          '当前 NPM_TOKEN 对应的 token 未开启 bypass_2fa，发布会触发 OTP/权限错误。请创建并切换到 bypass_2fa=true 的 token。'
        )
      }
      if (matched && matched.bypass_2fa === true) {
        process.stdout.write('[release-beta] token 检查通过: bypass_2fa=true\n')
      }
      if (matched && matched.bypass_2fa == null) {
        process.stdout.write(
          '[release-beta] token 未返回 bypass_2fa 字段，继续执行写权限探测来确认发布能力\n'
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`npm token 校验失败\n${message}`)
    }
  } else {
    process.stdout.write('[release-beta] 未检测到 NPM_TOKEN，使用 npm 当前登录态继续\n')
  }

  if (dryRun) {
    process.stdout.write('[release-beta] dry-run 模式：跳过发布 collaborator 写权限探测\n')
    return
  }

  const packageName = readPackageNameFromManifest()
  let collaboratorRaw
  try {
    collaboratorRaw = runCommandCapture(
      'npm',
      ['access', 'list', 'collaborators', packageName, whoami, '--json'],
      '发布权限探测(collaborator读取)'
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('E404')) {
      throw new Error(
        '发布权限探测失败：npm 返回 E404（通常是包名/scope 不匹配，或当前凭证对该包无权限）。'
      )
    }
    throw error
  }

  let collaboratorMap
  try {
    collaboratorMap = JSON.parse(collaboratorRaw)
  } catch {
    throw new Error(`发布权限探测失败：无法解析 collaborator 输出: ${collaboratorRaw}`)
  }

  const permission =
    collaboratorMap && typeof collaboratorMap === 'object' ? collaboratorMap[whoami] : undefined
  if (permission !== 'read-write') {
    throw new Error(
      `发布权限探测失败：${whoami} 在 ${packageName} 上的权限为 ${String(permission ?? 'unknown')}，需要 read-write 才能发布。`
    )
  }

  process.stdout.write(`[release-beta] 发布权限探测通过: ${packageName} (${whoami}=read-write)\n`)
}

function main() {
  const { bump, dryRun, skipVersion, skipGitCheck, skipAuthCheck, help } = parseArgs(process.argv.slice(2))
  if (help) {
    printHelp()
    return
  }

  assertGitCleanUnlessSkipped(skipGitCheck)
  assertNpmPublishPreflight({ dryRun, skipAuthCheck })

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
