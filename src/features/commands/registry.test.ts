import { describe, it, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createStatusSnapshot } from '../../core/diagnostics/status.js'
import { createSlashCommandRegistry } from './registry'

function stripAnsi(text: string): string {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '')
}

describe('SlashCommandRegistry', () => {
  it('returns empty when not a slash command', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
    expect(reg.suggest('hello')).toEqual([])
    await fsp.rm(cwd, { recursive: true, force: true })
  })

  it('returns all commands when only slash is provided', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
    const res = reg.suggest('/')
    expect(res.length).toBeGreaterThan(0)
    await fsp.rm(cwd, { recursive: true, force: true })
  })

  it('filters by prefix', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
    const res = reg.suggest('/ta')
    expect(res.some((c) => c.command === '/tasks')).toBe(true)
    await fsp.rm(cwd, { recursive: true, force: true })
  })

  it('suggests /dir:cmd when query matches the last segment', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const dir = path.join(cwd, '.formax', 'commands', 'git')
      await fsp.mkdir(dir, { recursive: true })
      await fsp.writeFile(path.join(dir, 'status.md'), 'Git status', 'utf8')

      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      expect(reg.suggest('/st').some((c) => c.command === '/git:status')).toBe(true)
      expect(reg.suggest('/st ').some((c) => c.command === '/git:status')).toBe(true)
      expect(reg.suggest('/st extra-args').some((c) => c.command === '/git:status')).toBe(true)
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('fuzzy-matches by subsequence on command id (e.g. /tus matches /status)', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const res = reg.suggest('/tus')
      expect(res.some((c) => c.command === '/status')).toBe(true)
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('fuzzy-matches by subsequence on description (e.g. /diag suggests /doctor)', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const res = reg.suggest('/diag')
      expect(res.some((c) => c.command === '/doctor')).toBe(true)
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('includes /compact in suggestions (handled by controller)', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
    expect(reg.list().some((c) => c.command === '/compact')).toBe(true)
    expect(reg.suggest('/co').some((c) => c.command === '/compact')).toBe(true)
    expect(reg.dispatch('/compact')).toBe(null)
    await fsp.rm(cwd, { recursive: true, force: true })
  })

  it('includes /clear in suggestions (handled by controller)', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
    expect(reg.list().some((c) => c.command === '/clear')).toBe(true)
    expect(reg.suggest('/cl').some((c) => c.command === '/clear')).toBe(true)
    expect(reg.dispatch('/clear')).toBe(null)
    await fsp.rm(cwd, { recursive: true, force: true })
  })

  it('dispatches /agents to open the agents dialog', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
    const effect = reg.dispatch('/agents')
    expect(effect?.kind).toBe('open_agents_dialog')
    await fsp.rm(cwd, { recursive: true, force: true })
  })

  it('dispatches /agents with args as usage output', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const effect = reg.dispatch('/agents extra')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(effect.stdout).toBe('Usage: /agents')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /permissions to open the permissions dialog', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
    const effect = reg.dispatch('/permissions')
    expect(effect?.kind).toBe('open_permissions_dialog')
    await fsp.rm(cwd, { recursive: true, force: true })
  })

  it('dispatches /permissions with args as usage output', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const effect = reg.dispatch('/permissions extra')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(effect.stdout).toBe('Usage: /permissions')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /hooks to open the hooks dialog', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
    const effect = reg.dispatch('/hooks')
    expect(effect?.kind).toBe('open_hooks_dialog')
    await fsp.rm(cwd, { recursive: true, force: true })
  })

  it('dispatches /hooks with args as usage output', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const effect = reg.dispatch('/hooks extra')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(effect.stdout).toBe('Usage: /hooks')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /model to show current default tier', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        modelTier: { get: () => 'sonnet', set: async () => 'sonnet' },
      })
      const effect = reg.dispatch('/model')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') return
      expect(effect.stdout).toContain('Default model tier: sonnet')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /model <tier> as an async local command', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const set = vi.fn(async () => 'haiku' as const)
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        modelTier: { get: () => 'sonnet', set },
      })
      const effect = reg.dispatch('/model haiku')
      expect(effect?.kind).toBe('local_async')
      if (!effect || effect.kind !== 'local_async') return
      const out = await effect.run()
      expect(set).toHaveBeenCalledWith('haiku')
      expect(out.stdout).toContain('haiku')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('reports effective tier when project override wins over global /model update', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const set = vi.fn(async () => 'opus' as const)
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        modelTier: { get: () => 'sonnet', set },
      })
      const effect = reg.dispatch('/model haiku')
      expect(effect?.kind).toBe('local_async')
      if (!effect || effect.kind !== 'local_async') return
      const out = await effect.run()
      expect(out.stdout).toContain('Saved global default model tier: haiku')
      expect(out.stdout).toContain('Current effective tier: opus')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('loads .formax/commands/*.md as commands', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    const dir = path.join(cwd, '.formax', 'commands')
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, 'hello.md'), 'Say hello', 'utf8')

    const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
    expect(reg.list().some((c) => c.command === '/hello')).toBe(true)
  })

  it('keeps builtin commands and lists custom variants (user/project) without overriding by default', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      const projectDir = path.join(cwd, '.formax', 'commands')
      const userDir = path.join(cwd, 'commands')
      await fsp.mkdir(projectDir, { recursive: true })
      await fsp.mkdir(userDir, { recursive: true })
      await fsp.writeFile(path.join(projectDir, 'status.md'), 'Project status', 'utf8')
      await fsp.writeFile(path.join(userDir, 'status.md'), 'User status', 'utf8')

      const snapshot = createStatusSnapshot({
        version: '0.0.0-test',
        cwd: '/tmp/repo',
        runtime: {
          llm: {
            provider: 'anthropic',
            baseUrl: 'https://api.anthropic.com/v1',
            model: 'm',
            timeoutMs: 123,
            apiKey: '',
          },
          paths: { logsDir: '/tmp/logs', subagentsDir: '/tmp/subagents', planDir: '/tmp/plans' },
          ui: { promptProfile: 'lite', assistantTextMode: 'stream' },
        },
      })

      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        status: { get: () => snapshot },
      })

      const statusVariants = reg.list().filter((c) => c.command === '/status')
      expect(statusVariants.length).toBeGreaterThanOrEqual(3)

      // Default dispatch should prefer builtin when present.
      const builtinEffect = reg.dispatch('/status')
      expect(builtinEffect?.kind).toBe('local')

      // If a specific variant is selected in the UI, it should be dispatchable.
      const projectEffect = reg.dispatch('/status', { preferredSpecId: 'project:/status' })
      expect(projectEffect?.kind).toBe('llm')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('does not override builtin /help by default even if a custom command exists', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      const dir = path.join(cwd, '.formax', 'commands')
      await fsp.mkdir(dir, { recursive: true })
      await fsp.writeFile(path.join(dir, 'help.md'), 'Custom help', 'utf8')

      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const effect = reg.dispatch('/help')
      expect(effect?.kind).toBe('local')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
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

  it('dispatches /status as a local command when status is provided', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const snapshot = createStatusSnapshot({
        version: '0.0.0-test',
        cwd: '/tmp/repo',
        runtime: {
          llm: {
            provider: 'anthropic',
            baseUrl: 'https://api.anthropic.com/v1',
            model: 'm',
            timeoutMs: 123,
            apiKey: '',
          },
          paths: { logsDir: '/tmp/logs', subagentsDir: '/tmp/subagents', planDir: '/tmp/plans' },
          ui: { promptProfile: 'lite', assistantTextMode: 'stream' },
        },
      })

      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        status: {
          get: () => snapshot,
        },
      })

      const effect = reg.dispatch('/status')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(effect.stdout).toContain('Formax v0.0.0-test')
      expect(effect.stdout).toContain('LLM:')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /doctor as an async local command when doctor is provided', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        doctor: { run: async () => 'Doctor OK\n' },
      })

      const effect = reg.dispatch('/doctor')
      expect(effect?.kind).toBe('local_async')
      if (!effect || effect.kind !== 'local_async') throw new Error('Expected local_async effect')
      const out = await effect.run()
      expect(out.stdout).toContain('Doctor OK')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
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
