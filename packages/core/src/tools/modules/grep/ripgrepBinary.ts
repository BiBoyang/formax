import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export const RIPGREP_VERSION = '14.1.1'

const RELEASE_BASE_URL = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}`

type ArchiveExtension = 'tar.gz' | 'zip'

type PlatformAsset = {
  target: string
  extension: ArchiveExtension
  binaryName: 'rg' | 'rg.exe'
}

const PLATFORM_ASSETS: Record<string, PlatformAsset> = {
  'arm64-darwin': { target: 'aarch64-apple-darwin', extension: 'tar.gz', binaryName: 'rg' },
  'x64-darwin': { target: 'x86_64-apple-darwin', extension: 'tar.gz', binaryName: 'rg' },
  'arm64-linux': { target: 'aarch64-unknown-linux-gnu', extension: 'tar.gz', binaryName: 'rg' },
  'x64-linux': { target: 'x86_64-unknown-linux-musl', extension: 'tar.gz', binaryName: 'rg' },
  'x64-win32': { target: 'x86_64-pc-windows-msvc', extension: 'zip', binaryName: 'rg.exe' },
}

type CommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export class RipgrepUnsupportedPlatformError extends Error {
  constructor(platformKey: string) {
    super(`Unsupported platform for ripgrep download: ${platformKey}`)
    this.name = 'RipgrepUnsupportedPlatformError'
  }
}

export class RipgrepDownloadError extends Error {
  constructor(url: string, status: number) {
    super(`Failed to download ripgrep asset (${status}): ${url}`)
    this.name = 'RipgrepDownloadError'
  }
}

export class RipgrepChecksumError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RipgrepChecksumError'
  }
}

export class RipgrepExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RipgrepExtractionError'
  }
}

export type ResolveRipgrepDependencies = {
  platform: NodeJS.Platform | string
  arch: string
  homedir: string
  fetchFn: typeof fetch
  runCommand: (command: string, args: string[]) => Promise<CommandResult>
  extractArchive: (args: {
    archivePath: string
    destinationDir: string
    extension: ArchiveExtension
    runCommand: (command: string, argv: string[]) => Promise<CommandResult>
  }) => Promise<void>
  nowMs: () => number
  randomToken: () => string
}

function defaultDeps(): ResolveRipgrepDependencies {
  return {
    platform: process.platform,
    arch: process.arch,
    homedir: os.homedir(),
    fetchFn: fetch,
    runCommand: runCommandWithSpawn,
    extractArchive: extractArchiveWithSystemTools,
    nowMs: () => Date.now(),
    randomToken: () => `${Math.random().toString(36).slice(2, 10)}`,
  }
}

export function getManagedRipgrepPath(args: {
  homedir?: string
  platform?: NodeJS.Platform | string
} = {}): string {
  const homedir = args.homedir ?? os.homedir()
  const platform = args.platform ?? process.platform
  const binaryName = platform === 'win32' ? 'rg.exe' : 'rg'
  return path.join(homedir, '.formax', 'bin', binaryName)
}

export function createResolveRipgrepExecutable(
  overrides: Partial<ResolveRipgrepDependencies> = {},
): () => Promise<string> {
  const deps = { ...defaultDeps(), ...overrides }
  let cachedPath: string | null = null
  let inFlight: Promise<string> | null = null

  return async () => {
    if (cachedPath) return cachedPath
    if (inFlight) return inFlight

    inFlight = resolveRipgrepExecutableInternal(deps)
      .then((resolvedPath) => {
        cachedPath = resolvedPath
        return resolvedPath
      })
      .finally(() => {
        inFlight = null
      })

    return inFlight
  }
}

export const resolveRipgrepExecutable = createResolveRipgrepExecutable()

async function resolveRipgrepExecutableInternal(deps: ResolveRipgrepDependencies): Promise<string> {
  const existing = await probeExistingRipgrepExecutable(deps)
  if (existing) return existing

  const asset = getPlatformAsset({ platform: deps.platform, arch: deps.arch })
  const managedPath = getManagedRipgrepPath({ homedir: deps.homedir, platform: deps.platform })
  await downloadAndInstallRipgrep({
    deps,
    managedPath,
    asset,
  })

  if (!(await isWorkingExecutable(managedPath, deps.runCommand))) {
    throw new RipgrepExtractionError(`Installed ripgrep is not executable: ${managedPath}`)
  }

  return managedPath
}

export function createProbeRipgrepExecutable(
  overrides: Partial<ResolveRipgrepDependencies> = {},
): () => Promise<string | null> {
  const deps = { ...defaultDeps(), ...overrides }
  return async () => await probeExistingRipgrepExecutable(deps)
}

export const probeRipgrepExecutable = createProbeRipgrepExecutable()

async function probeExistingRipgrepExecutable(deps: ResolveRipgrepDependencies): Promise<string | null> {
  if (await isWorkingExecutable('rg', deps.runCommand)) {
    return 'rg'
  }

  const managedPath = getManagedRipgrepPath({ homedir: deps.homedir, platform: deps.platform })
  if (await isWorkingExecutable(managedPath, deps.runCommand)) {
    return managedPath
  }

  return null
}

export function getPlatformAsset(args: {
  platform: NodeJS.Platform | string
  arch: string
}): PlatformAsset {
  const platformKey = `${args.arch}-${args.platform}`
  const asset = PLATFORM_ASSETS[platformKey]
  if (!asset) throw new RipgrepUnsupportedPlatformError(platformKey)
  return asset
}

async function downloadAndInstallRipgrep(args: {
  deps: ResolveRipgrepDependencies
  managedPath: string
  asset: PlatformAsset
}): Promise<void> {
  const { deps, managedPath, asset } = args
  const binDir = path.dirname(managedPath)
  const archiveFilename = `ripgrep-${RIPGREP_VERSION}-${asset.target}.${asset.extension}`
  const archiveUrl = `${RELEASE_BASE_URL}/${archiveFilename}`
  const checksumUrl = `${archiveUrl}.sha256`
  const token = `${deps.nowMs()}-${deps.randomToken()}`
  const archivePath = path.join(binDir, `${archiveFilename}.${token}.download`)
  const stagingPath = path.join(binDir, `${asset.binaryName}.${token}.staged`)

  await fsp.mkdir(binDir, { recursive: true })

  const archiveBytes = await downloadBinary(archiveUrl, deps.fetchFn)
  const checksumText = await downloadText(checksumUrl, deps.fetchFn)
  verifyChecksum({
    archiveBytes,
    checksumText,
    archiveFilename,
  })

  await fsp.writeFile(archivePath, archiveBytes)

  const extractDir = await fsp.mkdtemp(path.join(binDir, 'rg-extract-'))

  try {
    await deps.extractArchive({
      archivePath,
      destinationDir: extractDir,
      extension: asset.extension,
      runCommand: deps.runCommand,
    })

    const extractedBinaryPath = await findFileByBasename(extractDir, asset.binaryName)
    if (!extractedBinaryPath) {
      throw new RipgrepExtractionError(`ripgrep binary not found after extraction: ${asset.binaryName}`)
    }

    await fsp.copyFile(extractedBinaryPath, stagingPath)
    if (deps.platform !== 'win32') {
      await fsp.chmod(stagingPath, 0o755)
    }

    await fsp.rm(managedPath, { force: true })
    await fsp.rename(stagingPath, managedPath)
  } finally {
    await fsp.rm(archivePath, { force: true }).catch(() => undefined)
    await fsp.rm(stagingPath, { force: true }).catch(() => undefined)
    await fsp.rm(extractDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function downloadBinary(url: string, fetchFn: typeof fetch): Promise<Buffer> {
  const response = await fetchFn(url)
  if (!response.ok) throw new RipgrepDownloadError(url, response.status)
  const buf = await response.arrayBuffer()
  return Buffer.from(buf)
}

async function downloadText(url: string, fetchFn: typeof fetch): Promise<string> {
  const response = await fetchFn(url)
  if (!response.ok) throw new RipgrepDownloadError(url, response.status)
  return await response.text()
}

function verifyChecksum(args: {
  archiveBytes: Buffer
  checksumText: string
  archiveFilename: string
}): void {
  const expectedHash = extractExpectedChecksum(args.checksumText, args.archiveFilename)
  if (!expectedHash) {
    throw new RipgrepChecksumError(`Checksum file did not contain expected hash for ${args.archiveFilename}`)
  }

  const actualHash = crypto.createHash('sha256').update(args.archiveBytes).digest('hex')
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new RipgrepChecksumError(
      `Checksum mismatch for ${args.archiveFilename}: expected ${expectedHash}, got ${actualHash}`,
    )
  }
}

function extractExpectedChecksum(checksumText: string, archiveFilename: string): string | null {
  const lines = checksumText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  for (const line of lines) {
    const m = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line)
    if (!m) continue
    const filename = m[2].trim()
    if (filename === archiveFilename || filename.endsWith(`/${archiveFilename}`)) {
      return m[1]
    }
  }

  for (const line of lines) {
    const m = /^([a-fA-F0-9]{64})$/.exec(line)
    if (m) return m[1]
  }

  return null
}

async function isWorkingExecutable(
  executablePathOrName: string,
  runCommand: (command: string, args: string[]) => Promise<CommandResult>,
): Promise<boolean> {
  try {
    const result = await runCommand(executablePathOrName, ['--version'])
    return result.exitCode === 0
  } catch {
    return false
  }
}

async function findFileByBasename(rootDir: string, basename: string): Promise<string | null> {
  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop() as string
    const entries = await fsp.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (entry.isFile() && entry.name === basename) {
        return fullPath
      }
    }
  }
  return null
}

async function runCommandWithSpawn(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    child.stdout?.on('data', (buf: Buffer) => {
      stdout += buf.toString('utf8')
    })
    child.stderr?.on('data', (buf: Buffer) => {
      stderr += buf.toString('utf8')
    })

    child.on('error', (err) => {
      finish({ exitCode: -1, stdout, stderr: err.message || stderr })
    })
    child.on('close', (code) => {
      finish({ exitCode: typeof code === 'number' ? code : -1, stdout, stderr })
    })
  })
}

async function extractArchiveWithSystemTools(args: {
  archivePath: string
  destinationDir: string
  extension: ArchiveExtension
  runCommand: (command: string, argv: string[]) => Promise<CommandResult>
}): Promise<void> {
  if (args.extension === 'tar.gz') {
    const result = await args.runCommand('tar', ['-xzf', args.archivePath, '-C', args.destinationDir])
    if (result.exitCode !== 0) {
      throw new RipgrepExtractionError(result.stderr || 'tar extraction failed')
    }
    return
  }

  const script = `Expand-Archive -LiteralPath '${escapePowerShellLiteral(args.archivePath)}' -DestinationPath '${escapePowerShellLiteral(args.destinationDir)}' -Force`
  const pwshResult = await args.runCommand('pwsh', ['-NoProfile', '-Command', script])
  if (pwshResult.exitCode === 0) return

  const powershellResult = await args.runCommand('powershell', ['-NoProfile', '-Command', script])
  if (powershellResult.exitCode === 0) return

  throw new RipgrepExtractionError(
    powershellResult.stderr || pwshResult.stderr || 'PowerShell extraction failed',
  )
}

function escapePowerShellLiteral(input: string): string {
  return input.replace(/'/g, "''")
}

export const ripgrepBinaryTestExports = {
  extractExpectedChecksum,
  isWorkingExecutable,
  findFileByBasename,
  runCommandWithSpawn,
  extractArchiveWithSystemTools,
  escapePowerShellLiteral,
}
