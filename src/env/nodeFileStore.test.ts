import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createNodeFileStore } from './nodeFileStore.js'

describe('env/nodeFileStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `formax-env-store-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await fs.mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('supports exists/readText/writeTextAtomic and creates parent directories', async () => {
    const store = createNodeFileStore()
    const filePath = path.join(dir, 'nested', 'config.txt')

    expect(await store.exists(filePath)).toBe(false)
    await store.writeTextAtomic(filePath, 'hello world')
    expect(await store.exists(filePath)).toBe(true)
    expect(await store.readText(filePath)).toBe('hello world')
  })

  it('writes JSON with pretty + trailing newline defaults and supports compact mode', async () => {
    const store = createNodeFileStore()

    const prettyPath = path.join(dir, 'pretty.json')
    await store.writeJsonAtomic(prettyPath, { a: 1, b: ['x'] })
    const pretty = await fs.readFile(prettyPath, 'utf8')
    expect(pretty).toContain('\n  "a": 1,')
    expect(pretty.endsWith('\n')).toBe(true)

    const compactPath = path.join(dir, 'compact.json')
    await store.writeJsonAtomic(compactPath, { a: 1 }, { pretty: false, trailingNewline: false })
    const compact = await fs.readFile(compactPath, 'utf8')
    expect(compact).toBe('{"a":1}')
  })

  it('tolerates chmod failures as best-effort behavior', async () => {
    const store = createNodeFileStore()
    const filePath = path.join(dir, 'mode.txt')
    const chmodSpy = vi.spyOn(fs, 'chmod').mockRejectedValue(new Error('chmod blocked'))

    try {
      await expect(store.writeTextAtomic(filePath, 'content', { mode: 0o600 })).resolves.toBeUndefined()
      expect(await fs.readFile(filePath, 'utf8')).toBe('content')
      expect(chmodSpy).toHaveBeenCalled()
    } finally {
      chmodSpy.mockRestore()
    }
  })
})
