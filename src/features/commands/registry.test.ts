import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createStatusSnapshot } from '../../core/diagnostics/status.js'
import { createSlashCommandRegistry } from './registry'

function stripAnsi(text: string): string {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '')
}

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

  it('includes /compact in suggestions (handled by controller)', () => {
    const reg = createSlashCommandRegistry({ cwd: process.cwd() })
    expect(reg.list().some((c) => c.command === '/compact')).toBe(true)
    expect(reg.suggest('/co').some((c) => c.command === '/compact')).toBe(true)
    expect(reg.dispatch('/compact')).toBe(null)
  })

  it('dispatches /agents to open the agents dialog', () => {
    const reg = createSlashCommandRegistry({ cwd: process.cwd() })
    const effect = reg.dispatch('/agents')
    expect(effect?.kind).toBe('open_agents_dialog')
  })

  it('dispatches /agents with args as usage output', () => {
    const reg = createSlashCommandRegistry({ cwd: process.cwd() })
    const effect = reg.dispatch('/agents extra')
    expect(effect?.kind).toBe('local')
    if (!effect || effect.kind !== 'local') return
    expect(effect.stdout).toBe('Usage: /agents')
  })

  it('loads .formax/commands/*.md as commands', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    const dir = path.join(cwd, '.formax', 'commands')
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, 'hello.md'), 'Say hello', 'utf8')

    const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
    expect(reg.list().some((c) => c.command === '/hello')).toBe(true)
  })

  it('does not dispatch disable-model-invocation commands to the model', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    const dir = path.join(cwd, '.formax', 'commands')
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(
      path.join(dir, 'disabled.md'),
      ['---', 'description: Disabled command', 'disable-model-invocation: true', '---', '', 'Do not run'].join('\n'),
      'utf8',
    )

    const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
    const effect = reg.dispatch('/disabled')
    expect(effect?.kind).toBe('local')
    if (!effect || effect.kind !== 'local') return
    expect(stripAnsi(effect.stdout)).toContain('disabled for model invocation')
  })

  it('dispatches /status as a local command when status is provided', () => {
    const snapshot = createStatusSnapshot({
      version: '0.0.0-test',
      cwd: '/tmp/repo',
      runtime: {
        llm: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'm', timeoutMs: 123, apiKey: '' },
        paths: { logsDir: '/tmp/logs', subagentsDir: '/tmp/subagents', planDir: '/tmp/plans' },
        ui: { promptProfile: 'lite', assistantTextMode: 'stream' },
      },
    })

    const reg = createSlashCommandRegistry({
      cwd: process.cwd(),
      status: {
        get: () => snapshot,
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

  it('dispatches /todos as empty when no store exists', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-todos-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      process.env.FORMAX_CONFIG_DIR = cwd
      process.env.FORMAX_TODOS_SESSION_ID = 'test-session'

      const reg = createSlashCommandRegistry({ cwd })
      const effect = reg.dispatch('/todos')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') return
      expect(effect.stdout).toBe('No todos currently tracked')
    } finally {
      if (prevTodosPath === undefined) delete process.env.FORMAX_TODOS_PATH
      else process.env.FORMAX_TODOS_PATH = prevTodosPath
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir
      if (prevTodosSessionId === undefined) delete process.env.FORMAX_TODOS_SESSION_ID
      else process.env.FORMAX_TODOS_SESSION_ID = prevTodosSessionId
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /todos with list when store exists', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-todos-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      process.env.FORMAX_CONFIG_DIR = cwd
      process.env.FORMAX_TODOS_SESSION_ID = 'test-session'

      const todosPath = path.join(cwd, 'todos', 'test-session-agent-test-session.json')
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify({ todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] }, null, 2),
        'utf8',
      )

      const reg = createSlashCommandRegistry({ cwd })
      const effect = reg.dispatch('/todos')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') return
      const stdout = stripAnsi(effect.stdout)
      expect(stdout).toContain('1 todo:')
      expect(stdout).toContain('☐ x')
    } finally {
      if (prevTodosPath === undefined) delete process.env.FORMAX_TODOS_PATH
      else process.env.FORMAX_TODOS_PATH = prevTodosPath
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir
      if (prevTodosSessionId === undefined) delete process.env.FORMAX_TODOS_SESSION_ID
      else process.env.FORMAX_TODOS_SESSION_ID = prevTodosSessionId
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })
})
