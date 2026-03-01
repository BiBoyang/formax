import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { RuntimeConfig } from '../env/config'
import type { Msg } from '../shared/toolMessageTypes'
import type { SlashCommandRegistry, SlashCommandSpec } from '../features/commands/registry'
import { InputScopeProvider } from '../features/repl/inputScopeContext'

let sendSpy: ReturnType<typeof vi.fn>

const commandSuggestions: SlashCommandSpec[] = [
  {
    id: 'project:/status',
    source: 'project',
    command: '/status',
    description: 'Custom command (project) — Show status',
    implemented: true,
  },
  {
    id: 'user:/status',
    source: 'user',
    command: '/status',
    description: 'Custom command (user) — Show status',
    implemented: true,
  },
  {
    id: 'builtin:/compact',
    source: 'builtin',
    command: '/compact',
    description: 'Clear conversation history but keep a summary in context.',
    argHint: '<optional custom summarization instructions>',
    implemented: true,
  },
]

const mockCommandRegistry: SlashCommandRegistry = {
  list: () => commandSuggestions,
  suggest: (input: string) => {
    if (!String(input).startsWith('/')) return []
    return commandSuggestions
  },
  dispatch: () => null,
}

vi.mock('./repl/createReplCommandRegistry', async () => {
  const actual = (await vi.importActual('./repl/createReplCommandRegistry')) as Record<string, unknown>
  return {
    ...actual,
    createReplCommandRegistry: () => mockCommandRegistry,
  }
})

vi.mock('../features/commands/registry', async () => {
  const actual = (await vi.importActual('../features/commands/registry')) as Record<string, unknown>
  return {
    ...actual,
    createSlashCommandRegistry: () => mockCommandRegistry,
  }
})

vi.mock('../features/repl/useReplController', async () => {
  const actual = (await vi.importActual('../features/repl/useReplController')) as Record<string, unknown>

  const staticMessages: Msg[] = []
  const transientMessages: Msg[] = []

  return {
    ...actual,
    useReplController: () => ({
      state: {
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
      },
      actions: {
        send: sendSpy,
        newSession: vi.fn(),
        abort: vi.fn(),
        closeAgentsDialog: vi.fn(),
        closePermissionsDialog: vi.fn(),
        closeHooksDialog: vi.fn(),
        generateAgentDraft: vi.fn(),
        saveAgentFromDialog: vi.fn(),
      },
    }),
  }
})

const cfg: RuntimeConfig = {
  llm: {
    provider: 'anthropic',
    baseUrl: '',
    apiKey: '',
    model: '',
    timeoutMs: 600000,
    thinkingMode: true,
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
    outputStyle: 'default',
    verboseOutput: false,
  },
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 15000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (predicate(frame)) return frame
    await tick()
  }
  throw new Error('Timed out waiting for UI update')
}

describe('REPL slash suggestions', () => {
  beforeEach(() => {
    sendSpy = vi.fn()
  })

  it('autocompletes on Enter without sending when input mismatches selected suggestion', async () => {
    const { REPL } = await import('./REPL')
    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="repl">
        <REPL engine={{ runTurn: async () => [] }} tools={[]} cfg={cfg} />
      </InputScopeProvider>,
    )

    try {
      // Let layout effects register scoped input handlers before sending keys.
      for (let i = 0; i < 3; i++) await tick()
      await waitForFrame(lastFrame, (f) => f.includes('> '))
      stdin.write('/st')
      await waitForFrame(lastFrame, (f) => f.includes('> /st'))
      await waitForFrame(lastFrame, (f) => f.includes('/status'))

      stdin.write('\r')
      await tick()

      expect(sendSpy).not.toHaveBeenCalled()
      await waitForFrame(lastFrame, (f) => f.includes('/status'))
    } finally {
      unmount()
    }
  }, 20000)

  it('autocompletes on Tab without sending', async () => {
    const { REPL } = await import('./REPL')
    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="repl">
        <REPL engine={{ runTurn: async () => [] }} tools={[]} cfg={cfg} />
      </InputScopeProvider>,
    )

    try {
      // Let layout effects register scoped input handlers before sending keys.
      for (let i = 0; i < 3; i++) await tick()
      await waitForFrame(lastFrame, (f) => f.includes('> '))
      stdin.write('/st')
      await waitForFrame(lastFrame, (f) => f.includes('> /st'))
      await waitForFrame(lastFrame, (f) => f.includes('/status'))

      stdin.write('\t')
      await tick()

      expect(sendSpy).not.toHaveBeenCalled()
      await waitForFrame(lastFrame, (f) => f.includes('/status'))
    } finally {
      unmount()
    }
  }, 20000)

  it('sends selected duplicate command with preferredSlashSpecId', async () => {
    const { REPL } = await import('./REPL')
    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="repl">
        <REPL engine={{ runTurn: async () => [] }} tools={[]} cfg={cfg} />
      </InputScopeProvider>,
    )

    try {
      // Let layout effects register scoped input handlers before sending keys.
      for (let i = 0; i < 3; i++) await tick()
      await waitForFrame(lastFrame, (f) => f.includes('> '))
      stdin.write('/status')
      await waitForFrame(lastFrame, (f) => f.includes('> /status'))
      await tick()

      // Move selection to the second suggestion (user:/status).
      stdin.write('\u001B[B')
      await tick()

      stdin.write('\r')
      await tick()

      await waitForFrame(lastFrame, (f) => f.includes('> '))
      expect(sendSpy).toHaveBeenCalledWith('/status', { preferredSlashSpecId: 'user:/status' })
    } finally {
      unmount()
    }
  }, 20000)

  it('shows compact arg hint when /compact has no args', async () => {
    const { REPL } = await import('./REPL')
    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="repl">
        <REPL engine={{ runTurn: async () => [] }} tools={[]} cfg={cfg} />
      </InputScopeProvider>,
    )

    try {
      for (let i = 0; i < 3; i++) await tick()
      await waitForFrame(lastFrame, (f) => f.includes('> '))

      stdin.write('/compact')
      await waitForFrame(lastFrame, (f) => f.includes('> /compact'))
      await waitForFrame(lastFrame, (f) => f.includes('<optional custom summarization instructions>'))
    } finally {
      unmount()
    }
  }, 20000)

  it('hides compact arg hint when args are present', async () => {
    const { REPL } = await import('./REPL')
    const { stdin, lastFrame, unmount } = render(
      <InputScopeProvider initialScope="repl">
        <REPL engine={{ runTurn: async () => [] }} tools={[]} cfg={cfg} />
      </InputScopeProvider>,
    )

    try {
      for (let i = 0; i < 3; i++) await tick()
      await waitForFrame(lastFrame, (f) => f.includes('> '))

      stdin.write('/compact custom')
      await waitForFrame(lastFrame, (f) => f.includes('> /compact custom'))
      await tick()

      const frame = lastFrame() || ''
      expect(frame).not.toContain('<optional custom summarization instructions>')
    } finally {
      unmount()
    }
  }, 20000)
})
