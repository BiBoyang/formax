import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useInput } from 'ink'
import type { RuntimeConfig } from '../env/config'
import type { Msg } from '../components/tool/ToolMessage'
import { InputScopeProvider, useInputScope } from '../features/repl/inputScopeContext.js'

let mockState: any
let mockActions: any
let lastActiveScope = 'repl'
let inputEvents: Array<{ input: string; key: any; scope: string }> = []

vi.mock('../features/repl/useReplController', async () => {
  const actual = (await vi.importActual('../features/repl/useReplController')) as Record<string, unknown>
  return {
    ...actual,
    useReplController: () => ({
      state: mockState,
      actions: mockActions,
    }),
  }
})

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function ScopeSpy(): React.ReactNode {
  const { activeScope } = useInputScope()
  lastActiveScope = activeScope
  return null
}

function InputProbe(): React.ReactNode {
  useInput((input, key) => {
    inputEvents.push({ input, key, scope: lastActiveScope })
  })
  return null
}

async function waitForFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 5000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (predicate(frame)) return frame
    await tick()
  }
  const recent = inputEvents.slice(-15).map((e) => ({
    input: e.input,
    keyName: typeof e.key?.name === 'string' ? e.key.name : undefined,
    sequence: typeof e.key?.sequence === 'string' ? e.key.sequence : undefined,
    upArrow: Boolean((e.key as any)?.upArrow),
    downArrow: Boolean((e.key as any)?.downArrow),
    return: Boolean((e.key as any)?.return),
    escape: Boolean((e.key as any)?.escape),
    scope: e.scope,
  }))
  throw new Error(
    `Timed out waiting for UI update.\n\nlastActiveScope=${lastActiveScope}\nrecentInputs=${JSON.stringify(
      recent,
      null,
      2,
    )}\n\nLast frame:\n${lastFrame() || ''}`,
  )
}

async function waitForScope(predicate: (scope: string) => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate(lastActiveScope)) return
    await tick()
  }
  throw new Error(`Timed out waiting for scope. lastActiveScope=${lastActiveScope}`)
}

function makeCfg(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  const base: RuntimeConfig = {
    llm: {
      provider: 'anthropic',
      baseUrl: '',
      apiKey: '',
      model: '',
      timeoutMs: 600000,
    },
    paths: {
      logsDir: '',
      subagentsDir: '',
      planDir: '',
    },
    context: {
      effectiveContextWindowPercent: 0.95,
      autoCompactTokenLimitPercent: 0.9,
      baselineTokens: 12000,
      compactKeepLastTurns: 4,
      enableAutoCompact: true,
      autoCompactMinTurnsBetweenRuns: 8,
    },
    ui: {
      assistantTextMode: 'stream',
      promptProfile: 'lite',
      showContextMeter: true,
      showAutoCompactNotice: true,
    },
  }
  if (!overrides) return base
  return {
    ...base,
    ...overrides,
    llm: { ...base.llm, ...(overrides.llm ?? {}) },
    paths: { ...base.paths, ...(overrides.paths ?? {}) },
    ui: { ...base.ui, ...(overrides.ui ?? {}) },
    context: { ...base.context, ...(overrides.context ?? {}) },
  }
}

function baseState(overrides?: Partial<any>): any {
  const staticMessages: Msg[] = []
  const transientMessages: Msg[] = []
  return {
    messages: [],
    staticMessages,
    transientMessages,
    transcriptSeq: 0,
    isLoading: false,
    loadingText: '',
    thinkingText: '',
    error: null,
    allowedSubagents: [],
    agentsDialogOpen: false,
    permissionsDialogOpen: false,
    hooksDialogOpen: false,
    context: null,
    ...overrides,
  }
}

describe('REPL overlay input gating', () => {
  const originalCwd = process.cwd()
  const originalConfigDir = process.env.FORMAX_CONFIG_DIR

  beforeEach(() => {
    mockActions = {
      send: vi.fn(),
      newSession: vi.fn(),
      abort: vi.fn(),
      closeAgentsDialog: vi.fn(),
      closePermissionsDialog: vi.fn(),
      closeHooksDialog: vi.fn(),
      generateAgentDraft: vi.fn(),
      saveAgentFromDialog: vi.fn(),
    }
    mockState = baseState()
    lastActiveScope = 'repl'
    inputEvents = []
  })

  it('routes arrow keys to /permissions overlay and hides the REPL input bar', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-repl-permissions-overlay-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    await writeFile(
      path.join(projectConfigDir, 'settings.local.json'),
      JSON.stringify(
        {
          version: 1,
          permissions: {
            allow: ['WebFetch', 'Bash(ls:*)'],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    try {
      mockState = baseState({ permissionsDialogOpen: true })

      const { REPL } = await import('./REPL')
      const { lastFrame, stdin } = render(
        <InputScopeProvider initialScope="repl">
          <ScopeSpy />
          <InputProbe />
          <REPL engine={{ runTurn: async () => [] }} tools={[]} cfg={makeCfg()} />
        </InputScopeProvider>,
      )

      await waitForFrame(lastFrame, (f) => f.includes('Permissions:'))
      await waitForFrame(lastFrame, (f) => f.includes('Add a new rule'))
      await waitForFrame(lastFrame, (f) => /\n│\s*2\.\s+WebFetch\b/.test(f))
      await waitForScope((s) => s === 'overlay:permissions')

      const initial = lastFrame() || ''
      expect(initial).not.toContain('Try "fix typecheck errors"')
      expect(initial).toMatch(/❯\s*\d+\.\s+Add a new rule/)

      stdin.write('\u001B[B')

      const afterDown = await waitForFrame(lastFrame, (f) => /❯\s*\d+\.\s+WebFetch/.test(f))
      expect(afterDown).toMatch(/❯\s*\d+\.\s+WebFetch/)
      expect(mockActions.abort).toHaveBeenCalledTimes(0)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)

  it('does not route navigation keys to the REPL while /permissions overlay is open', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-repl-permissions-keys-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    await writeFile(
      path.join(projectConfigDir, 'settings.local.json'),
      JSON.stringify(
        {
          version: 1,
          permissions: {
            allow: ['WebFetch', 'Bash(ls:*)'],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    try {
      mockState = baseState({ permissionsDialogOpen: true })

      const { REPL } = await import('./REPL')
      const { lastFrame, stdin } = render(
        <InputScopeProvider initialScope="repl">
          <ScopeSpy />
          <InputProbe />
          <REPL engine={{ runTurn: async () => [] }} tools={[]} cfg={makeCfg()} />
        </InputScopeProvider>,
      )

      await waitForFrame(lastFrame, (f) => f.includes('Permissions:'))
      await waitForFrame(lastFrame, (f) => f.includes('Add a new rule'))
      await waitForFrame(lastFrame, (f) => f.includes('WebFetch'))
      await waitForScope((s) => s === 'overlay:permissions')
      await tick()

      inputEvents = []

      stdin.write('\u001B[D') // ←
      await tick()
      stdin.write('\u001B[C') // →
      await tick()
      stdin.write('1')
      await tick()
      stdin.write('\u007F') // Backspace
      await tick()
      stdin.write('\u001B[3~') // Delete
      await tick()
      stdin.write('\r') // Enter
      await tick()

      expect(mockActions.abort).toHaveBeenCalledTimes(0)
      expect(mockActions.send).toHaveBeenCalledTimes(0)

      // overlay 自己能消费：Tab 切到 Ask 后，WebFetch 不应再出现（ask 为空）
      stdin.write('\t')
      const afterTab = await waitForFrame(lastFrame, (f) => f.includes('Permissions:') && !f.includes('WebFetch'))
      expect(afterTab).not.toContain('WebFetch')
      expect(mockActions.abort).toHaveBeenCalledTimes(0)
      expect(mockActions.send).toHaveBeenCalledTimes(0)

      // Esc 不应触发 abort（交给 overlay 处理）
      stdin.write('\u001B')
      await tick()
      expect(mockActions.abort).toHaveBeenCalledTimes(0)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)

  it('closes /permissions overlay on Esc (does not bubble to REPL)', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-repl-permissions-esc-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    await writeFile(
      path.join(projectConfigDir, 'settings.local.json'),
      JSON.stringify(
        {
          version: 1,
          permissions: {
            allow: ['WebFetch', 'Bash(ls:*)'],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    try {
      mockState = baseState({ permissionsDialogOpen: true })

      const { REPL } = await import('./REPL')
      const { lastFrame, stdin } = render(
        <InputScopeProvider initialScope="repl">
          <ScopeSpy />
          <InputProbe />
          <REPL engine={{ runTurn: async () => [] }} tools={[]} cfg={makeCfg()} />
        </InputScopeProvider>,
      )

      await waitForFrame(lastFrame, (f) => f.includes('Permissions:'))
      await waitForScope((s) => s === 'overlay:permissions')
      await tick()

      stdin.write('\u001B')
      await tick()

      expect(mockActions.abort).toHaveBeenCalledTimes(0)
      expect(mockActions.send).toHaveBeenCalledTimes(0)
      expect(mockActions.closePermissionsDialog).toHaveBeenCalledTimes(1)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)

  it('routes arrow keys to /agents overlay and hides the REPL input bar', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-repl-agents-overlay-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const projectAgentsDir = path.join(projectConfigDir, 'agents')
    const globalConfigDir = path.join(repoRoot, 'global-formax')
    const userAgentsDir = path.join(globalConfigDir, 'agents')

    await mkdir(projectAgentsDir, { recursive: true })
    await mkdir(userAgentsDir, { recursive: true })

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    try {
      mockState = baseState({
        agentsDialogOpen: true,
        allowedSubagents: [
          { name: 'design-planner', description: '' },
          { name: 'general-purpose', description: '' },
          { name: 'statusline-setup', description: '' },
          { name: 'Explore', description: '' },
          { name: 'Plan', description: '' },
          { name: 'claude-code-guide', description: '' },
        ],
      })

      const { REPL } = await import('./REPL')
      const { lastFrame, stdin } = render(
        <InputScopeProvider initialScope="repl">
          <ScopeSpy />
          <InputProbe />
          <REPL
            engine={{ runTurn: async () => [] }}
            tools={[]}
            cfg={makeCfg({ paths: { logsDir: '', planDir: '', subagentsDir: projectAgentsDir } })}
          />
        </InputScopeProvider>,
      )

      await waitForFrame(lastFrame, (f) => f.includes('Agents'))
      await waitForFrame(lastFrame, (f) => f.includes('Create new agent'))
      await waitForFrame(lastFrame, (f) => f.includes('design-planner'))
      await waitForScope((s) => s === 'overlay:agents')
      // Ink 的 useInput 订阅可能在 scope 切换的同一 tick 尚未就绪；多等一拍避免方向键丢失
      await tick()

      const initial = lastFrame() || ''
      expect(initial).not.toContain('Try "fix typecheck errors"')
      expect(initial).toMatch(/>\s+Create new agent/)

      stdin.write('\u001B[B')

      const afterDown = await waitForFrame(lastFrame, (f) => />\s+design-planner/.test(f))
      expect(afterDown).toMatch(/>\s+design-planner/)
      expect(mockActions.abort).toHaveBeenCalledTimes(0)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)

  it('closes /agents overlay on Esc (does not bubble to REPL)', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-repl-agents-esc-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const projectAgentsDir = path.join(projectConfigDir, 'agents')
    const globalConfigDir = path.join(repoRoot, 'global-formax')
    const userAgentsDir = path.join(globalConfigDir, 'agents')

    await mkdir(projectAgentsDir, { recursive: true })
    await mkdir(userAgentsDir, { recursive: true })

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    try {
      mockState = baseState({
        agentsDialogOpen: true,
        allowedSubagents: [
          { name: 'design-planner', description: '' },
          { name: 'general-purpose', description: '' },
          { name: 'statusline-setup', description: '' },
          { name: 'Explore', description: '' },
          { name: 'Plan', description: '' },
          { name: 'claude-code-guide', description: '' },
        ],
      })

      const { REPL } = await import('./REPL')
      const { lastFrame, stdin } = render(
        <InputScopeProvider initialScope="repl">
          <ScopeSpy />
          <InputProbe />
          <REPL
            engine={{ runTurn: async () => [] }}
            tools={[]}
            cfg={makeCfg({ paths: { logsDir: '', planDir: '', subagentsDir: projectAgentsDir } })}
          />
        </InputScopeProvider>,
      )

      await waitForFrame(lastFrame, (f) => f.includes('Agents'))
      await waitForScope((s) => s === 'overlay:agents')
      await tick()

      stdin.write('\u001B')
      await tick()

      expect(mockActions.abort).toHaveBeenCalledTimes(0)
      expect(mockActions.send).toHaveBeenCalledTimes(0)
      expect(mockActions.closeAgentsDialog).toHaveBeenCalledTimes(1)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)

  it('routes arrow keys to /hooks overlay and hides the REPL input bar', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-repl-hooks-overlay-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    await writeFile(path.join(projectConfigDir, 'settings.local.json'), JSON.stringify({ version: 1, hooks: {} }, null, 2), 'utf8')

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    try {
      mockState = baseState({ hooksDialogOpen: true })

      const { REPL } = await import('./REPL')
      const { lastFrame, stdin } = render(
        <InputScopeProvider initialScope="repl">
          <ScopeSpy />
          <InputProbe />
          <REPL engine={{ runTurn: async () => [] }} tools={[]} cfg={makeCfg()} />
        </InputScopeProvider>,
      )

      await waitForFrame(lastFrame, (f) => f.includes('Hook Configuration'))
      await waitForFrame(lastFrame, (f) => f.includes('Select hook event:'))
      await waitForFrame(lastFrame, (f) => f.includes('PreToolUse - Before tool execution'))
      await waitForScope((s) => s === 'overlay:hooks')
      // 同 /agents：scope 切换后的同一 tick 里，overlay 可能还没绑定到键盘事件
      await tick()

      const initial = lastFrame() || ''
      expect(initial).not.toContain('Try "fix typecheck errors"')
      expect(initial).toMatch(/❯\s*1\.\s+PreToolUse\b/)

      stdin.write('\u001B[B')

      const afterDown = await waitForFrame(lastFrame, (f) => /❯\s*2\.\s+PermissionRequest\b/.test(f))
      expect(afterDown).toMatch(/❯\s*2\.\s+PermissionRequest\b/)
      expect(mockActions.abort).toHaveBeenCalledTimes(0)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)

  it('closes /hooks overlay on Esc (does not bubble to REPL)', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-repl-hooks-esc-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    await writeFile(path.join(projectConfigDir, 'settings.local.json'), JSON.stringify({ version: 1, hooks: {} }, null, 2), 'utf8')

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    try {
      mockState = baseState({ hooksDialogOpen: true })

      const { REPL } = await import('./REPL')
      const { lastFrame, stdin } = render(
        <InputScopeProvider initialScope="repl">
          <ScopeSpy />
          <InputProbe />
          <REPL engine={{ runTurn: async () => [] }} tools={[]} cfg={makeCfg()} />
        </InputScopeProvider>,
      )

      await waitForFrame(lastFrame, (f) => f.includes('Hook Configuration'))
      await waitForScope((s) => s === 'overlay:hooks')
      await tick()

      stdin.write('\u001B')
      await tick()

      expect(mockActions.abort).toHaveBeenCalledTimes(0)
      expect(mockActions.send).toHaveBeenCalledTimes(0)
      expect(mockActions.closeHooksDialog).toHaveBeenCalledTimes(1)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)

  it('updates prompt mode when /hooks overlay opens', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-repl-hooks-prompt-mode-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    await writeFile(path.join(projectConfigDir, 'settings.local.json'), JSON.stringify({ version: 1, hooks: {} }, null, 2), 'utf8')

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    try {
      mockState = baseState({ hooksDialogOpen: false })

      const { REPL } = await import('./REPL')
      const ui = render(
        <InputScopeProvider initialScope="repl">
          <ScopeSpy />
          <InputProbe />
          <REPL engine={{ runTurn: async () => [] }} tools={[]} cfg={makeCfg()} />
        </InputScopeProvider>,
      )

      await waitForFrame(ui.lastFrame, (f) => f.includes('Try "fix typecheck errors"'))

      mockState = baseState({ hooksDialogOpen: true })
      ui.rerender(
        <InputScopeProvider initialScope="repl">
          <ScopeSpy />
          <InputProbe />
          <REPL engine={{ runTurn: async () => [] }} tools={[]} cfg={makeCfg()} />
        </InputScopeProvider>,
      )

      const afterOpen = await waitForFrame(ui.lastFrame, (f) => f.includes('Hook Configuration'))
      expect(afterOpen).not.toContain('Try "fix typecheck errors"')
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)
})
