import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  createProbeRipgrepExecutable,
  createResolveRipgrepExecutable,
  getManagedRipgrepPath,
  RipgrepChecksumError,
  RipgrepExtractionError,
  RipgrepDownloadError,
  RipgrepUnsupportedPlatformError,
  RIPGREP_VERSION,
  ripgrepBinaryTestExports,
} from './ripgrepBinary'

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

describe('ripgrepBinary', () => {
  it('uses system rg when available', async () => {
    const fetchFn = vi.fn()
    const runCommand = vi.fn(async (command: string) => {
      if (command === 'rg') return { exitCode: 0, stdout: 'ripgrep\n', stderr: '' }
      return { exitCode: 1, stdout: '', stderr: '' }
    })

    const resolve = createResolveRipgrepExecutable({
      platform: 'linux',
      arch: 'x64',
      homedir: '/tmp/unused',
      fetchFn: fetchFn as any,
      runCommand,
    })

    await expect(resolve()).resolves.toBe('rg')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('uses managed rg when system rg is unavailable', async () => {
    const tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-rg-home-'))
    try {
      const managedPath = getManagedRipgrepPath({ homedir: tmpHome, platform: 'linux' })
      await fsp.mkdir(path.dirname(managedPath), { recursive: true })
      await fsp.writeFile(managedPath, 'binary')

      const runCommand = vi.fn(async (command: string) => {
        if (command === 'rg') return { exitCode: 1, stdout: '', stderr: 'not found' }
        if (command === managedPath) return { exitCode: 0, stdout: 'ripgrep\n', stderr: '' }
        return { exitCode: 1, stdout: '', stderr: '' }
      })

      const resolve = createResolveRipgrepExecutable({
        platform: 'linux',
        arch: 'x64',
        homedir: tmpHome,
        fetchFn: vi.fn() as any,
        runCommand,
      })

      await expect(resolve()).resolves.toBe(managedPath)
    } finally {
      await fsp.rm(tmpHome, { recursive: true, force: true })
    }
  })

  it('downloads and installs managed rg when missing', async () => {
    const tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-rg-home-'))
    try {
      const archive = Buffer.from('archive-bytes')
      const assetName = `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`
      const checksum = `${sha256Hex(archive)}  ${assetName}\n`
      const fetchFn = vi.fn(async (url: string) => {
        if (String(url).endsWith('.sha256')) return new Response(checksum, { status: 200 })
        return new Response(archive, { status: 200 })
      })

      const managedPath = getManagedRipgrepPath({ homedir: tmpHome, platform: 'linux' })
      const runCommand = vi.fn(async (command: string) => {
        if (command === 'rg') return { exitCode: 1, stdout: '', stderr: 'not found' }
        if (command === managedPath) {
          const exists = await fsp.stat(managedPath).then(() => true).catch(() => false)
          return exists
            ? { exitCode: 0, stdout: 'ripgrep\n', stderr: '' }
            : { exitCode: 1, stdout: '', stderr: 'not found' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const extractArchive = vi.fn(async ({ destinationDir }: { destinationDir: string }) => {
        const nested = path.join(destinationDir, 'ripgrep', 'rg')
        await fsp.mkdir(path.dirname(nested), { recursive: true })
        await fsp.writeFile(nested, 'binary')
      })

      const resolve = createResolveRipgrepExecutable({
        platform: 'linux',
        arch: 'x64',
        homedir: tmpHome,
        fetchFn: fetchFn as any,
        runCommand,
        extractArchive: extractArchive as any,
      })

      await expect(resolve()).resolves.toBe(managedPath)
      expect(extractArchive).toHaveBeenCalledTimes(1)
      await expect(fsp.stat(managedPath)).resolves.toBeDefined()
    } finally {
      await fsp.rm(tmpHome, { recursive: true, force: true })
    }
  })

  it('throws checksum mismatch when downloaded bytes do not match', async () => {
    const tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-rg-home-'))
    try {
      const archive = Buffer.from('archive-bytes')
      const wrong = Buffer.from('something-else')
      const assetName = `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`
      const checksum = `${sha256Hex(wrong)}  ${assetName}\n`
      const fetchFn = vi.fn(async (url: string) => {
        if (String(url).endsWith('.sha256')) return new Response(checksum, { status: 200 })
        return new Response(archive, { status: 200 })
      })

      const resolve = createResolveRipgrepExecutable({
        platform: 'linux',
        arch: 'x64',
        homedir: tmpHome,
        fetchFn: fetchFn as any,
        runCommand: async (command: string) => {
          if (command === 'rg') return { exitCode: 1, stdout: '', stderr: 'not found' }
          return { exitCode: 1, stdout: '', stderr: 'not found' }
        },
        extractArchive: vi.fn(async () => {}) as any,
      })

      await expect(resolve()).rejects.toBeInstanceOf(RipgrepChecksumError)
    } finally {
      await fsp.rm(tmpHome, { recursive: true, force: true })
    }
  })

  it('throws when checksum file does not contain expected hash entry', async () => {
    const tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-rg-home-'))
    try {
      const archive = Buffer.from('archive-bytes')
      const fetchFn = vi.fn(async (url: string) => {
        if (String(url).endsWith('.sha256')) return new Response('not-a-checksum-line\n', { status: 200 })
        return new Response(archive, { status: 200 })
      })

      const resolve = createResolveRipgrepExecutable({
        platform: 'linux',
        arch: 'x64',
        homedir: tmpHome,
        fetchFn: fetchFn as any,
        runCommand: async () => ({ exitCode: 1, stdout: '', stderr: 'not found' }),
        extractArchive: vi.fn(async () => {}) as any,
      })

      await expect(resolve()).rejects.toBeInstanceOf(RipgrepChecksumError)
    } finally {
      await fsp.rm(tmpHome, { recursive: true, force: true })
    }
  })

  it('deduplicates concurrent download attempts', async () => {
    const tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-rg-home-'))
    try {
      const archive = Buffer.from('archive-bytes')
      const assetName = `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`
      const checksum = `${sha256Hex(archive)}  ${assetName}\n`
      const fetchFn = vi.fn(async (url: string) => {
        if (String(url).endsWith('.sha256')) return new Response(checksum, { status: 200 })
        return new Response(archive, { status: 200 })
      })

      const managedPath = getManagedRipgrepPath({ homedir: tmpHome, platform: 'linux' })
      const runCommand = vi.fn(async (command: string) => {
        if (command === 'rg') return { exitCode: 1, stdout: '', stderr: 'not found' }
        if (command === managedPath) {
          const exists = await fsp.stat(managedPath).then(() => true).catch(() => false)
          return exists
            ? { exitCode: 0, stdout: 'ripgrep\n', stderr: '' }
            : { exitCode: 1, stdout: '', stderr: 'not found' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const extractArchive = vi.fn(async ({ destinationDir }: { destinationDir: string }) => {
        const nested = path.join(destinationDir, 'ripgrep', 'rg')
        await fsp.mkdir(path.dirname(nested), { recursive: true })
        await fsp.writeFile(nested, 'binary')
      })

      const resolve = createResolveRipgrepExecutable({
        platform: 'linux',
        arch: 'x64',
        homedir: tmpHome,
        fetchFn: fetchFn as any,
        runCommand,
        extractArchive: extractArchive as any,
      })

      const [a, b] = await Promise.all([resolve(), resolve()])
      expect(a).toBe(managedPath)
      expect(b).toBe(managedPath)
      expect(fetchFn).toHaveBeenCalledTimes(2)
      expect(extractArchive).toHaveBeenCalledTimes(1)
    } finally {
      await fsp.rm(tmpHome, { recursive: true, force: true })
    }
  })

  it('returns cached path on later calls after a successful resolve', async () => {
    const tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-rg-home-'))
    try {
      const archive = Buffer.from('archive-bytes')
      const assetName = `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`
      const checksum = `${sha256Hex(archive)}  ${assetName}\n`
      const fetchFn = vi.fn(async (url: string) => {
        if (String(url).endsWith('.sha256')) return new Response(checksum, { status: 200 })
        return new Response(archive, { status: 200 })
      })

      const managedPath = getManagedRipgrepPath({ homedir: tmpHome, platform: 'linux' })
      const runCommand = vi.fn(async (command: string) => {
        if (command === 'rg') return { exitCode: 1, stdout: '', stderr: 'not found' }
        if (command === managedPath) {
          const exists = await fsp.stat(managedPath).then(() => true).catch(() => false)
          return exists
            ? { exitCode: 0, stdout: 'ripgrep\n', stderr: '' }
            : { exitCode: 1, stdout: '', stderr: 'not found' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const extractArchive = vi.fn(async ({ destinationDir }: { destinationDir: string }) => {
        const nested = path.join(destinationDir, 'ripgrep', 'rg')
        await fsp.mkdir(path.dirname(nested), { recursive: true })
        await fsp.writeFile(nested, 'binary')
      })

      const resolve = createResolveRipgrepExecutable({
        platform: 'linux',
        arch: 'x64',
        homedir: tmpHome,
        fetchFn: fetchFn as any,
        runCommand,
        extractArchive: extractArchive as any,
      })

      await expect(resolve()).resolves.toBe(managedPath)
      await expect(resolve()).resolves.toBe(managedPath)
      expect(fetchFn).toHaveBeenCalledTimes(2)
      expect(extractArchive).toHaveBeenCalledTimes(1)
    } finally {
      await fsp.rm(tmpHome, { recursive: true, force: true })
    }
  })

  it('throws when checksum download fails', async () => {
    const tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-rg-home-'))
    try {
      const archive = Buffer.from('archive-bytes')
      const fetchFn = vi.fn(async (url: string) => {
        if (String(url).endsWith('.sha256')) return new Response('missing', { status: 404 })
        return new Response(archive, { status: 200 })
      })

      const resolve = createResolveRipgrepExecutable({
        platform: 'linux',
        arch: 'x64',
        homedir: tmpHome,
        fetchFn: fetchFn as any,
        runCommand: async () => ({ exitCode: 1, stdout: '', stderr: 'not found' }),
        extractArchive: vi.fn(async () => {}) as any,
      })

      await expect(resolve()).rejects.toBeInstanceOf(RipgrepDownloadError)
    } finally {
      await fsp.rm(tmpHome, { recursive: true, force: true })
    }
  })

  it('installs on win32 and skips chmod', async () => {
    const tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-rg-home-'))
    const chmodSpy = vi.spyOn(fsp, 'chmod')
    try {
      const archive = Buffer.from('archive-bytes')
      const assetName = `ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc.zip`
      const checksum = `${sha256Hex(archive)}  ${assetName}\n`
      const fetchFn = vi.fn(async (url: string) => {
        if (String(url).endsWith('.sha256')) return new Response(checksum, { status: 200 })
        return new Response(archive, { status: 200 })
      })

      const managedPath = getManagedRipgrepPath({ homedir: tmpHome, platform: 'win32' })
      const runCommand = vi.fn(async (command: string) => {
        if (command === 'rg') return { exitCode: 1, stdout: '', stderr: 'not found' }
        if (command === managedPath) {
          const exists = await fsp.stat(managedPath).then(() => true).catch(() => false)
          return exists
            ? { exitCode: 0, stdout: 'ripgrep\n', stderr: '' }
            : { exitCode: 1, stdout: '', stderr: 'not found' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const extractArchive = vi.fn(async ({ destinationDir }: { destinationDir: string }) => {
        const nested = path.join(destinationDir, 'ripgrep', 'rg.exe')
        await fsp.mkdir(path.dirname(nested), { recursive: true })
        await fsp.writeFile(nested, 'binary')
      })

      const resolve = createResolveRipgrepExecutable({
        platform: 'win32',
        arch: 'x64',
        homedir: tmpHome,
        fetchFn: fetchFn as any,
        runCommand,
        extractArchive: extractArchive as any,
      })

      await expect(resolve()).resolves.toBe(managedPath)
      expect(chmodSpy).not.toHaveBeenCalled()
    } finally {
      chmodSpy.mockRestore()
      await fsp.rm(tmpHome, { recursive: true, force: true })
    }
  })

  it('throws when extracted archive does not contain binary', async () => {
    const tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-rg-home-'))
    try {
      const archive = Buffer.from('archive-bytes')
      const assetName = `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`
      const checksum = `${sha256Hex(archive)}  ${assetName}\n`
      const fetchFn = vi.fn(async (url: string) => {
        if (String(url).endsWith('.sha256')) return new Response(checksum, { status: 200 })
        return new Response(archive, { status: 200 })
      })

      const resolve = createResolveRipgrepExecutable({
        platform: 'linux',
        arch: 'x64',
        homedir: tmpHome,
        fetchFn: fetchFn as any,
        runCommand: async () => ({ exitCode: 1, stdout: '', stderr: 'not found' }),
        extractArchive: vi.fn(async () => {}) as any,
      })

      await expect(resolve()).rejects.toBeInstanceOf(RipgrepExtractionError)
    } finally {
      await fsp.rm(tmpHome, { recursive: true, force: true })
    }
  })

  it('throws when installed binary is still not executable after extraction', async () => {
    const tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-rg-home-'))
    try {
      const archive = Buffer.from('archive-bytes')
      const assetName = `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`
      const checksum = `${sha256Hex(archive)}  ${assetName}\n`
      const fetchFn = vi.fn(async (url: string) => {
        if (String(url).endsWith('.sha256')) return new Response(checksum, { status: 200 })
        return new Response(archive, { status: 200 })
      })

      const managedPath = getManagedRipgrepPath({ homedir: tmpHome, platform: 'linux' })
      const runCommand = vi.fn(async (command: string) => {
        if (command === 'rg') return { exitCode: 1, stdout: '', stderr: 'not found' }
        if (command === managedPath) return { exitCode: 1, stdout: '', stderr: 'bad exec' }
        return { exitCode: 0, stdout: '', stderr: '' }
      })

      const extractArchive = vi.fn(async ({ destinationDir }: { destinationDir: string }) => {
        const nested = path.join(destinationDir, 'ripgrep', 'rg')
        await fsp.mkdir(path.dirname(nested), { recursive: true })
        await fsp.writeFile(nested, 'binary')
      })

      const resolve = createResolveRipgrepExecutable({
        platform: 'linux',
        arch: 'x64',
        homedir: tmpHome,
        fetchFn: fetchFn as any,
        runCommand,
        extractArchive: extractArchive as any,
      })

      await expect(resolve()).rejects.toBeInstanceOf(RipgrepExtractionError)
    } finally {
      await fsp.rm(tmpHome, { recursive: true, force: true })
    }
  })

  it('throws on unsupported platform', async () => {
    const resolve = createResolveRipgrepExecutable({
      platform: 'sunos',
      arch: 'x64',
      homedir: '/tmp/unused',
      fetchFn: vi.fn() as any,
      runCommand: async (command: string) => {
        if (command === 'rg') return { exitCode: 1, stdout: '', stderr: 'not found' }
        return { exitCode: 1, stdout: '', stderr: 'not found' }
      },
    })

    await expect(resolve()).rejects.toBeInstanceOf(RipgrepUnsupportedPlatformError)
  })

  it('probe returns null when no executable works', async () => {
    const probe = createProbeRipgrepExecutable({
      platform: 'linux',
      arch: 'x64',
      homedir: '/tmp/unused',
      runCommand: async () => ({ exitCode: 1, stdout: '', stderr: 'not found' }),
    })
    await expect(probe()).resolves.toBeNull()
  })

  it('retries after a failed in-flight resolution', async () => {
    const runCommand = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'missing' }))
    const fetchFn = vi.fn(async () => new Response('bad', { status: 503 }))
    const resolve = createResolveRipgrepExecutable({
      platform: 'linux',
      arch: 'x64',
      homedir: '/tmp/unused',
      runCommand,
      fetchFn: fetchFn as any,
    })

    await expect(resolve()).rejects.toBeInstanceOf(RipgrepDownloadError)
    await expect(resolve()).rejects.toBeInstanceOf(RipgrepDownloadError)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('extractExpectedChecksum handles path suffix, hash-only and no-match cases', () => {
    const target = 'ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz'
    const hash = 'a'.repeat(64)
    const other = 'b'.repeat(64)
    expect(ripgrepBinaryTestExports.extractExpectedChecksum(`${hash}  ${target}\n`, target)).toBe(hash)
    expect(
      ripgrepBinaryTestExports.extractExpectedChecksum(`${other}  folder/${target}\n`, target),
    ).toBe(other)
    expect(ripgrepBinaryTestExports.extractExpectedChecksum(`${hash}\n`, target)).toBe(hash)
    expect(ripgrepBinaryTestExports.extractExpectedChecksum(`not-a-checksum\n`, target)).toBeNull()
    expect(
      ripgrepBinaryTestExports.extractExpectedChecksum(`${other}  some-other-file.tar.gz\n`, target),
    ).toBeNull()
  })

  it('getManagedRipgrepPath supports default arguments', () => {
    const result = getManagedRipgrepPath()
    expect(result).toContain(`${path.sep}.formax${path.sep}bin${path.sep}`)
    expect(result.endsWith('rg') || result.endsWith('rg.exe')).toBe(true)
  })

  it('isWorkingExecutable returns false when run command throws', async () => {
    await expect(
      ripgrepBinaryTestExports.isWorkingExecutable('rg', async () => {
        throw new Error('boom')
      }),
    ).resolves.toBe(false)
  })

  it('findFileByBasename finds nested file and null when missing', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-rg-find-'))
    try {
      const nestedFile = path.join(root, 'a', 'b', 'rg.exe')
      await fsp.mkdir(path.dirname(nestedFile), { recursive: true })
      await fsp.writeFile(nestedFile, 'bin')
      await expect(ripgrepBinaryTestExports.findFileByBasename(root, 'rg.exe')).resolves.toBe(nestedFile)
      await expect(ripgrepBinaryTestExports.findFileByBasename(root, 'rg')).resolves.toBeNull()
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  it('runCommandWithSpawn captures stdout/stderr and handles missing command', async () => {
    await expect(
      ripgrepBinaryTestExports.runCommandWithSpawn(process.execPath, [
        '-e',
        "process.stdout.write('out'); process.stderr.write('err')",
      ]),
    ).resolves.toMatchObject({ exitCode: 0, stdout: 'out', stderr: 'err' })

    const missingCommand = `missing-${Date.now()}-${Math.random().toString(16).slice(2)}`
    await expect(ripgrepBinaryTestExports.runCommandWithSpawn(missingCommand, [])).resolves.toMatchObject({
      exitCode: -1,
    })
  })

  it('extractArchiveWithSystemTools covers tar and powershell fallback branches', async () => {
    const runTarSuccess = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }))
    await expect(
      ripgrepBinaryTestExports.extractArchiveWithSystemTools({
        archivePath: "/tmp/it's.tar.gz",
        destinationDir: '/tmp/out',
        extension: 'tar.gz',
        runCommand: runTarSuccess,
      }),
    ).resolves.toBeUndefined()
    expect(runTarSuccess).toHaveBeenCalledWith('tar', ['-xzf', "/tmp/it's.tar.gz", '-C', '/tmp/out'])

    const runTarFail = vi.fn(async () => ({ exitCode: 2, stdout: '', stderr: '' }))
    await expect(
      ripgrepBinaryTestExports.extractArchiveWithSystemTools({
        archivePath: '/tmp/fail.tar.gz',
        destinationDir: '/tmp/out',
        extension: 'tar.gz',
        runCommand: runTarFail,
      }),
    ).rejects.toEqual(expect.objectContaining({ name: RipgrepExtractionError.name }))

    const runPwshSuccess = vi.fn(async (command: string) => ({
      exitCode: command === 'pwsh' ? 0 : 1,
      stdout: '',
      stderr: '',
    }))
    await expect(
      ripgrepBinaryTestExports.extractArchiveWithSystemTools({
        archivePath: "/tmp/it's.zip",
        destinationDir: "/tmp/o'ut",
        extension: 'zip',
        runCommand: runPwshSuccess,
      }),
    ).resolves.toBeUndefined()
    expect(runPwshSuccess).toHaveBeenCalledTimes(1)

    const runPowershellSuccess = vi.fn(async (command: string) => ({
      exitCode: command === 'powershell' ? 0 : 1,
      stdout: '',
      stderr: command === 'pwsh' ? 'pwsh failed' : '',
    }))
    await expect(
      ripgrepBinaryTestExports.extractArchiveWithSystemTools({
        archivePath: '/tmp/file.zip',
        destinationDir: '/tmp/out',
        extension: 'zip',
        runCommand: runPowershellSuccess,
      }),
    ).resolves.toBeUndefined()
    expect(runPowershellSuccess).toHaveBeenCalledTimes(2)

    const runAllFail = vi.fn(async (command: string) => ({
      exitCode: 1,
      stdout: '',
      stderr: '',
    }))
    await expect(
      ripgrepBinaryTestExports.extractArchiveWithSystemTools({
        archivePath: '/tmp/file.zip',
        destinationDir: '/tmp/out',
        extension: 'zip',
        runCommand: runAllFail,
      }),
    ).rejects.toMatchObject({
      name: RipgrepExtractionError.name,
      message: 'PowerShell extraction failed',
    })
  })

  it('escapePowerShellLiteral doubles quotes', () => {
    expect(ripgrepBinaryTestExports.escapePowerShellLiteral("a'b''c")).toBe("a''b''''c")
  })

  it('ignores cleanup rm failures in installation finally block', async () => {
    const tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-rg-home-'))
    const rmSpy = vi.spyOn(fsp, 'rm')
    rmSpy.mockRejectedValue(new Error('cleanup failed'))
    try {
      const archive = Buffer.from('archive-bytes')
      const assetName = `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`
      const checksum = `${sha256Hex(archive)}  ${assetName}\n`
      const fetchFn = vi.fn(async (url: string) => {
        if (String(url).endsWith('.sha256')) return new Response(checksum, { status: 200 })
        return new Response(archive, { status: 200 })
      })

      const resolve = createResolveRipgrepExecutable({
        platform: 'linux',
        arch: 'x64',
        homedir: tmpHome,
        fetchFn: fetchFn as any,
        runCommand: async () => ({ exitCode: 1, stdout: '', stderr: 'not found' }),
        extractArchive: vi.fn(async () => {
          throw new Error('extract failed')
        }) as any,
      })

      await expect(resolve()).rejects.toThrow('extract failed')
    } finally {
      rmSpy.mockRestore()
      await fsp.rm(tmpHome, { recursive: true, force: true })
    }
  })
})
