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

  it('dispatches /status as a local command when status is provided', () => {
    const reg = createSlashCommandRegistry({
      cwd: process.cwd(),
      status: {
        get: () => ({
          version: '0.0.0-test',
          cwd: '/tmp/repo',
          llm: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'm', timeoutMs: 123 },
          paths: { logsDir: '/tmp/logs', subagentsDir: '/tmp/subagents', planDir: '/tmp/plans' },
          ui: { promptProfile: 'lite', assistantTextMode: 'stream' },
        }),
      },
    })

    const effect = reg.dispatch('/status')
    expect(effect?.kind).toBe('local')
    if (!effect || effect.kind !== 'local') return
    expect(effect.stdout).toContain('Formax v0.0.0-test')
    expect(effect.stdout).toContain('LLM:')
  })

  it('dispatches /doctor as an async local command when doctor is provided', async () => {
    const reg = createSlashCommandRegistry({
      cwd: process.cwd(),
      doctor: { run: async () => 'Doctor OK\n' },
    })

    const effect = reg.dispatch('/doctor')
    expect(effect?.kind).toBe('local_async')
    if (!effect || effect.kind !== 'local_async') return
    const out = await effect.run()
    expect(out.stdout).toContain('Doctor OK')
  })
})
