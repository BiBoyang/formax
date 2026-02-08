import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  createResolveRipgrepExecutable,
  getManagedRipgrepPath,
  RipgrepChecksumError,
  RipgrepUnsupportedPlatformError,
  RIPGREP_VERSION,
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
})
