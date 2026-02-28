import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readAgentDir } from './utils.js'

describe('readAgentDir', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty object for empty dir and when readdir fails', async () => {
    expect(await readAgentDir('')).toEqual({})

    const readdirSpy = vi.spyOn(fs, 'readdir').mockRejectedValue(new Error('nope'))
    expect(await readAgentDir('/tmp/missing')).toEqual({})
    expect(readdirSpy).toHaveBeenCalled()
  })

  it('reads markdown files and falls back name/model correctly', async () => {
    const dir = path.join(os.tmpdir(), `agents-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await fs.mkdir(dir, { recursive: true })

    await fs.writeFile(
      path.join(dir, 'One.md'),
      ['---', 'name: "One Agent"', 'model: Opus', '---', 'body'].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(dir, 'two.md'), ['---', 'description: x', '---', 'body'].join('\n'), 'utf8')
    await fs.writeFile(path.join(dir, 'ignore.txt'), 'x', 'utf8')

    const out = await readAgentDir(dir)
    expect(out['one agent']).toMatchObject({
      name: 'One Agent',
      model: 'opus',
      filePath: path.join(dir, 'One.md'),
    })
    expect(out['two']).toMatchObject({
      name: 'two',
      model: 'inherit',
      filePath: path.join(dir, 'two.md'),
    })
    expect(Object.keys(out).some((k) => k.includes('ignore'))).toBe(false)
  })

  it('skips files that fail to read', async () => {
    const dir = '/tmp/x'
    vi.spyOn(fs, 'readdir').mockResolvedValue(['ok.md', 'bad.md'] as any)
    vi.spyOn(fs, 'readFile').mockImplementation(async (filePath: any) => {
      if (String(filePath).endsWith('bad.md')) throw new Error('bad read')
      return '---\nname: OK\n---\n'
    })

    const out = await readAgentDir(dir)
    expect(out['ok']).toBeTruthy()
    expect(out['bad']).toBeUndefined()
  })
})
