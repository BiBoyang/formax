import { afterEach, describe, it, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createStatusSnapshot } from '../../core/diagnostics/status.js'
import { createSlashCommandRegistry, parseSlashCommand } from './registry'

function stripAnsi(text: string): string {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '')
}

function restoreEnv(
  name: 'FORMAX_TODOS_PATH' | 'FORMAX_CONFIG_DIR' | 'FORMAX_TODOS_SESSION_ID',
  value: string | undefined,
): void {
  if (typeof value === 'string') process.env[name] = value
  else delete process.env[name]
}

afterEach(() => {
  vi.unstubAllEnvs()
})

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

  it('dispatches /config to open config dialog', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const effect = reg.dispatch('/config')
      expect(effect?.kind).toBe('open_config_dialog')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /config with args as usage output', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const effect = reg.dispatch('/config extra')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(effect.stdout).toBe('Usage: /config')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /resume to open resume dialog', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const effect = reg.dispatch('/resume')
      expect(effect?.kind).toBe('open_resume_dialog')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /resume with args as usage output', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const effect = reg.dispatch('/resume extra')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(effect.stdout).toBe('Usage: /resume')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /model to open model dialog', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        modelTier: { get: () => 'sonnet', set: async () => 'sonnet' },
      })
      const effect = reg.dispatch('/model')
      expect(effect?.kind).toBe('open_model_dialog')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('accepts /model default as sonnet tier', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const set = vi.fn(async () => 'sonnet' as const)
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        modelTier: { get: () => 'sonnet', set },
      })
      const effect = reg.dispatch('/model default')
      expect(effect?.kind).toBe('local_async')
      if (!effect || effect.kind !== 'local_async') return
      await effect.run()
      expect(set).toHaveBeenCalledWith('sonnet')
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

  it('dispatches project-only custom command when no builtin exists', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      const projectDir = path.join(cwd, '.formax', 'commands')
      await fsp.mkdir(projectDir, { recursive: true })
      await fsp.writeFile(path.join(projectDir, 'hello.md'), 'Project hello', 'utf8')

      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const effect = reg.dispatch('/hello')
      expect(effect?.kind).toBe('llm')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches user-only custom command when no builtin/project exists', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      const userDir = path.join(cwd, 'commands')
      await fsp.mkdir(userDir, { recursive: true })
      await fsp.writeFile(path.join(userDir, 'solo.md'), 'User solo command', 'utf8')

      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const effect = reg.dispatch('/solo')
      expect(effect?.kind).toBe('llm')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('allows preferredSpecId to resolve from registry id map fallback', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const effect = reg.dispatch('/status', { preferredSpecId: 'builtin:/help' })
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(effect.stdout).toContain('Formax help')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
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

  it('dispatches /plan when no plan exists', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        plan: { getPlanPath: () => null },
      })
      const effect = reg.dispatch('/plan')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(effect.stdout).toContain('No plan found')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /plan with plan file contents when present', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const planPath = path.join(cwd, 'plan.md')
      await fsp.writeFile(planPath, 'Plan line 1\nPlan line 2\n', 'utf8')
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        plan: { getPlanPath: () => planPath },
      })
      const effect = reg.dispatch('/plan')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(effect.stdout).toBe('Plan line 1\nPlan line 2')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /plan as no plan found when reading plan fails', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        plan: { getPlanPath: () => path.join(cwd, 'missing-plan.md') },
      })
      const effect = reg.dispatch('/plan')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(effect.stdout).toContain('No plan found')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /prompt with usage when no args provided', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        promptProfile: { get: () => 'lite', set: () => {} },
      })
      const effect = reg.dispatch('/prompt')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(effect.stdout).toContain('Prompt profile: lite')
      expect(effect.stdout).toContain('/prompt full')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /prompt with unknown profile message', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        promptProfile: { get: () => 'full', set: () => {} },
      })
      const effect = reg.dispatch('/prompt weird')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(effect.stdout).toContain('Unknown profile: weird')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /prompt and updates profile when value is valid', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const set = vi.fn()
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        promptProfile: { get: () => 'full', set },
      })
      const effect = reg.dispatch('/prompt lite')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') throw new Error('Expected local effect')
      expect(set).toHaveBeenCalledWith('lite')
      expect(effect.stdout).toContain('Prompt profile set to: lite')
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
      vi.stubEnv('FORMAX_CONFIG_DIR', cwd)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const reg = createSlashCommandRegistry({ cwd })
      const effect = reg.dispatch('/todos')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') return
      expect(effect.stdout).toBe('No todos currently tracked')
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
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
      vi.stubEnv('FORMAX_CONFIG_DIR', cwd)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

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
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('renders /todos with in_progress and completed statuses', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-todos-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', cwd)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const todosPath = path.join(cwd, 'todos', 'test-session-agent-test-session.json')
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify(
          {
            todos: [
              { content: 'doing', status: 'in_progress', activeForm: 'doing' },
              { content: 'done', status: 'completed', activeForm: 'done' },
            ],
          },
          null,
          2,
        ),
        'utf8',
      )

      const reg = createSlashCommandRegistry({ cwd })
      const effect = reg.dispatch('/todos')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') return
      const stdout = stripAnsi(effect.stdout)
      expect(stdout).toContain('☐ doing')
      expect(stdout).toContain('☒ done')
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('renders /todos robustly when todo fields are missing', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-todos-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      vi.stubEnv('FORMAX_CONFIG_DIR', cwd)
      vi.stubEnv('FORMAX_TODOS_SESSION_ID', 'test-session')

      const todosPath = path.join(cwd, 'todos', 'test-session-agent-test-session.json')
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(todosPath, JSON.stringify({ todos: [{}] }, null, 2), 'utf8')

      const reg = createSlashCommandRegistry({ cwd })
      const effect = reg.dispatch('/todos')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') return
      const stdout = stripAnsi(effect.stdout)
      expect(stdout).toContain('1 todo:')
      expect(stdout).toContain('☐ ')
    } finally {
      restoreEnv('FORMAX_TODOS_PATH', prevTodosPath)
      restoreEnv('FORMAX_CONFIG_DIR', prevConfigDir)
      restoreEnv('FORMAX_TODOS_SESSION_ID', prevTodosSessionId)
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches unimplemented builtins as unimplemented effect', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({ cwd, globalConfigDir: cwd })
      const effect = reg.dispatch('/stats')
      expect(effect?.kind).toBe('unimplemented')
      if (!effect || effect.kind !== 'unimplemented') return
      expect(effect.message).toContain('/stats')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /tasks with formatted task list output', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        taskManager: {
          list: () => [
            { id: 'task-1', status: 'running', kind: 'shell', label: 'Build project' },
            { id: 'task-2', status: 'done' },
          ],
        } as any,
      })
      const effect = reg.dispatch('/tasks')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') return
      expect(effect.stdout).toContain('Background tasks:')
      expect(effect.stdout).toContain('- running shell task-1')
      expect(effect.stdout).toContain('Build project')
      expect(effect.stdout).toContain('Tip: ask me to run TaskOutput')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('dispatches /tasks with empty task list message', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-registry-'))
    try {
      const reg = createSlashCommandRegistry({
        cwd,
        globalConfigDir: cwd,
        taskManager: {
          list: () => [],
        } as any,
      })
      const effect = reg.dispatch('/tasks')
      expect(effect?.kind).toBe('local')
      if (!effect || effect.kind !== 'local') return
      expect(effect.stdout).toBe('No background tasks.')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('parses undefined input safely as non-slash command', () => {
    expect(parseSlashCommand(undefined as any)).toBeNull()
  })
})
