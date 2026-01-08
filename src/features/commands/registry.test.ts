import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createSlashCommandRegistry } from './registry'

describe('SlashCommandRegistry', () => {
  it('returns empty when not a slash command', () => {
    const reg = createSlashCommandRegistry({ cwd: process.cwd() })
    expect(reg.suggest('hello')).toEqual([])
  })

  it('returns all commands when only slash is provided', () => {
    const reg = createSlashCommandRegistry({ cwd: process.cwd() })
    const res = reg.suggest('/')
    expect(res.length).toBeGreaterThan(0)
  })

  it('filters by prefix', () => {
    const reg = createSlashCommandRegistry({ cwd: process.cwd() })
    const res = reg.suggest('/ta')
    expect(res.some((c) => c.command === '/tasks')).toBe(true)
  })

  it('loads .claude/commands/*.md as commands', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    const dir = path.join(cwd, '.claude', 'commands')
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, 'hello.md'), 'Say hello', 'utf8')

    const reg = createSlashCommandRegistry({ cwd })
    expect(reg.list().some((c) => c.command === '/hello')).toBe(true)
  })
})
