import React, { useEffect } from 'react'
import { render } from 'ink-testing-library'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReplController } from './useReplController'
import { createUserInputManager } from '../../tools/runtime/userInputManager'
import { UserInputProvider } from '../../tools/runtime/userInputContext'
import type { ChatEngine } from '../../chat/engine'
import type { RuntimeConfig } from '../../env/config'
import type { ToolDefinition } from '../../tools/types'
import type { StreamEvent } from '../../streaming/types'
import type { SlashCommandRegistry } from '../commands/registry'
import type { PromptBlock } from '../../prompts'
import { readSessionFile } from './sessionSave/reader'
import { SessionWriter } from './sessionSave/writer'

const { estimatePromptTokensMock } = vi.hoisted(() => ({
  estimatePromptTokensMock: vi.fn(() => 0),
}))

vi.mock('../../chat/context/estimate', () => ({
  estimatePromptTokens: estimatePromptTokensMock,
}))

const unmountFns: Array<() => void> = []

function renderTracked(node: React.ReactElement): ReturnType<typeof render> {
  const rendered = render(node)
  unmountFns.push(rendered.unmount)
  return rendered
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn()) return
    await tick(5)
  }
  throw new Error('Timed out waiting for condition')
}

function createCfg(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    llm: {
      provider: 'anthropic',
      baseUrl: '',
      apiKey: '',
      model: 'm',
      timeoutMs: 600000,
      // Keep deterministic; avoids depending on model defaults.
      contextWindowTokens: 10000,
      thinkingMode: true,
    },
    paths: { logsDir: '', subagentsDir: '', planDir: '' },
    context: {
      effectiveContextWindowPercent: 0.95,
      autoCompactTokenLimitPercent: 0.9,
      baselineTokens: 12000,
      compactKeepLastTurns: 4,
      enableAutoCompact: false,
      autoCompactMinTurnsBetweenRuns: 8,
    },
    ui: {
      assistantTextMode: 'buffered',
      promptProfile: 'lite',
      showContextMeter: true,
      showAutoCompactNotice: true,
      outputStyle: 'default',
      verboseOutput: false,
    },
    ...overrides,
  }
}

function Harness(args: {
  engine: ChatEngine
  tools?: ToolDefinition[]
  cfg?: RuntimeConfig
  commandRegistry?: SlashCommandRegistry
  initialSession?: { filePath?: string; messages?: any[]; history?: any[] }
  onController: (c: ReturnType<typeof useReplController>) => void
}): React.ReactNode {
  const controller = useReplController({
    engine: args.engine,
    tools: args.tools ?? [],
    cfg: args.cfg ?? createCfg(),
    mode: 'normal',
    commandRegistry: args.commandRegistry,
    initialSession: args.initialSession as any,
  })

  useEffect(() => {
    args.onController(controller)
  }, [args, controller])

  return null
}

function lastAssistantText(controller: ReturnType<typeof useReplController>): string {
  const msgs = controller.state.messages
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!
    if (m.role === 'assistant') return m.content
  }
  return ''
}

function isTextPromptBlock(b: PromptBlock): b is PromptBlock & { type: 'text'; text: string } {
  return (b as any).type === 'text' && typeof (b as any).text === 'string'
}

afterEach(async () => {
  vi.useRealTimers()
  for (const unmount of unmountFns.splice(0)) unmount()
  // Allow async cleanup (SessionWriter shutdown) to complete.
  await tick(20)
  estimatePromptTokensMock.mockReset()
  vi.restoreAllMocks()
})

beforeEach(() => {
  process.env.FORMAX_SESSION_SAVE = '0'
  delete process.env.FORMAX_SESSION_SAVE_DISABLED
})

describe('useReplController', () => {
  it('injects /config into next turn only for Output style changes', async () => {
    const captured: PromptBlock[][] = []
    const engine: ChatEngine = {
      async runTurn({ history, onEvent, user, thinkingEnabled }) {
        captured.push(user.content as PromptBlock[])
        expect(thinkingEnabled).toBe(true)
        onEvent({ type: 'complete' } as StreamEvent)
        return [...history, user]
      },
    }

    const userInput = createUserInputManager()
    let controller!: ReturnType<typeof useReplController>
    renderTracked(
      <UserInputProvider userInput={userInput}>
        <Harness
          engine={engine}
          cfg={createCfg({ ui: { ...createCfg().ui, outputStyle: 'explanatory' } })}
          onController={(c) => (controller = c)}
        />
      </UserInputProvider>,
    )
    await waitFor(() => Boolean(controller))

    controller.actions.closeConfigDialog({ kind: 'changed', message: 'Set output style to Explanatory' })
    await controller.actions.send('hi')
    expect(captured).toHaveLength(1)
    expect(
      captured[0].some((b) => isTextPromptBlock(b) && b.text.includes('<command-name>/config</command-name>')),
    ).toBe(true)
    expect(
      captured[0].some(
        (b) => isTextPromptBlock(b) && b.text.includes('Explanatory output style is active'),
      ),
    ).toBe(true)

    await controller.actions.send('hi2')
    expect(captured).toHaveLength(2)
    expect(
      captured[1].some((b) => isTextPromptBlock(b) && b.text.includes('<command-name>/config</command-name>')),
    ).toBe(false)

    controller.actions.closeConfigDialog({ kind: 'changed', message: 'Set verbose output to true' })
    await controller.actions.send('hi3')
    expect(captured).toHaveLength(3)
    expect(
      captured[2].some((b) => isTextPromptBlock(b) && b.text.includes('<command-name>/config</command-name>')),
    ).toBe(false)
  })

	  it('buffered mode: merges assistant_delta into a single assistant message on complete', async () => {
    const engine: ChatEngine = {
      async runTurn({ history, onEvent, user }) {
        onEvent({ type: 'assistant_delta', text: 'Hi' } as StreamEvent)
        onEvent({ type: 'assistant_delta', text: ' there' } as StreamEvent)
        onEvent({ type: 'complete' } as StreamEvent)
        return [...history, user]
      },
    }

    const userInput = createUserInputManager()
    let controller!: ReturnType<typeof useReplController>
    renderTracked(
      <UserInputProvider userInput={userInput}>
        <Harness engine={engine} onController={(c) => (controller = c)} />
      </UserInputProvider>,
    )

	    await waitFor(() => Boolean(controller))
	    await controller.actions.send('hello')
	    await waitFor(() => controller.state.messages.some((m) => m.role === 'assistant'))

	    const assistants = controller.state.messages.filter((m) => m.role === 'assistant')
	    expect(assistants).toHaveLength(1)
	    expect(assistants[0]?.content).toBe('Hi there')
	  })

  it('injects todo reminder into request but does not persist it into history', async () => {
    const calls: Array<{ history: unknown[]; user: { role: string; content: PromptBlock[] } }> = []

    const engine: ChatEngine = {
      async runTurn({ history, user }) {
        calls.push({ history, user })
        return [
          ...history,
          user,
          { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        ] as any
      },
    }

    const tmpConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-reminders-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    process.env.FORMAX_CONFIG_DIR = tmpConfigDir

    try {
      let controller!: ReturnType<typeof useReplController>
      renderTracked(
        <Harness
          engine={engine}
          cfg={createCfg({ ui: { ...createCfg().ui, promptProfile: 'full' } })}
          onController={(c) => (controller = c)}
        />,
      )

      await waitFor(() => Boolean(controller))

      await controller.actions.send('hello')
      await tick()
      await controller.actions.send('next')
      await tick()

      expect(calls).toHaveLength(2)

      // 1) The reminder should exist in the *request* (last user message content),
      // not in history.
      const first = calls[0]!
      expect(first.history).toHaveLength(0)
      expect(first.user.role).toBe('user')
      expect(Array.isArray(first.user.content)).toBe(true)
      expect(
        first.user.content.some((b) => typeof (b as any)?.text === 'string' && /<system-reminder>/i.test((b as any).text)),
      ).toBe(true)

      // 2) It should NOT persist into long-term history: the next turn's history
      // must not contain system-reminder blocks from the previous request.
      const second = calls[1]!
      const firstUserFromHistory = second.history.find((m: any) => m?.role === 'user') as any
      expect(Array.isArray(firstUserFromHistory?.content)).toBe(true)
      expect(
        (firstUserFromHistory.content as any[]).some(
          (b) => typeof b?.text === 'string' && /<system-reminder>/i.test(b.text),
        ),
      ).toBe(false)
      expect(firstUserFromHistory.content).toEqual([{ type: 'text', text: 'hello' }])
    } finally {
      if (typeof prevConfigDir === 'string') process.env.FORMAX_CONFIG_DIR = prevConfigDir
      else delete process.env.FORMAX_CONFIG_DIR
      await fsp.rm(tmpConfigDir, { recursive: true, force: true })
    }
  })

	  it('stream mode: creates a streaming assistant message and appends deltas incrementally', async () => {
    let releaseSecondDelta!: () => void
    const secondDeltaGate = new Promise<void>((resolve) => {
      releaseSecondDelta = resolve
    })

    const engine: ChatEngine = {
      async runTurn({ history, onEvent, user }) {
        onEvent({ type: 'assistant_delta', text: 'Hi' } as StreamEvent)
        await tick()
        await secondDeltaGate
        onEvent({ type: 'assistant_delta', text: ' there' } as StreamEvent)
        onEvent({ type: 'complete' } as StreamEvent)
        return [...history, user]
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(
      <Harness
        engine={engine}
        cfg={createCfg({ ui: { ...createCfg().ui, assistantTextMode: 'stream' } })}
        onController={(c) => (controller = c)}
      />,
    )

	    await waitFor(() => Boolean(controller))
	
	    const sendPromise = controller.actions.send('hello')
	    await waitFor(() =>
	      controller.state.transientMessages.some((m) => m.role === 'assistant' && m.isStreaming && m.content.includes('Hi')),
	    )
	    expect(controller.state.staticMessages.some((m) => m.role === 'assistant')).toBe(false)
		    releaseSecondDelta()
		    await sendPromise
		    await waitFor(() => controller.state.messages.some((m) => m.role === 'assistant' && m.content.includes('Hi there')))

		    const assistants = controller.state.messages.filter((m) => m.role === 'assistant')
		    expect(assistants).toHaveLength(1)
		    expect(assistants[0]?.content).toBe('Hi there')
    expect(assistants[0]?.isStreaming).toBe(false)
    expect(controller.state.transientMessages).toEqual([])
    expect(controller.state.staticMessages.filter((m) => m.role === 'assistant')).toHaveLength(1)
  })

  it('thinking_delta is throttled (updates only after 200ms)', async () => {
    const engine: ChatEngine = {
      async runTurn({ history, onEvent, user }) {
        onEvent({ type: 'thinking_delta', thinking: 'a' } as StreamEvent)
        await tick(10)
        onEvent({ type: 'thinking_delta', thinking: 'b' } as StreamEvent)
        await tick(220)
        onEvent({ type: 'thinking_delta', thinking: 'c' } as StreamEvent)
        onEvent({ type: 'complete' } as StreamEvent)
        return [...history, user]
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} />)

    await waitFor(() => Boolean(controller))

    const sendPromise = controller.actions.send('hello')
    await waitFor(() => controller.state.thinkingText === 'a')
    await waitFor(() => controller.state.thinkingText === 'a') // second delta should not flush
    await waitFor(() => controller.state.thinkingText === 'abc')
    await sendPromise
  })

  it('usage events update context with source=usage', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const engine: ChatEngine = {
      async runTurn({ history, onEvent, user }) {
        onEvent({ type: 'usage', usage: { input_tokens: 123 } } as StreamEvent)
        await gate
        onEvent({ type: 'complete' } as StreamEvent)
        return [...history, user]
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} />)

    await waitFor(() => Boolean(controller))

    const sendPromise = controller.actions.send('hello')
    await waitFor(() => controller.state.context?.source === 'usage')
    expect(controller.state.context?.usedTokens).toBeGreaterThan(0)
    release()
    await sendPromise
  })

  it('send ignores whitespace-only input and does not call engine', async () => {
    const runTurn = vi.fn(async ({ history, user }) => [...history, user])
    const engine: ChatEngine = { runTurn } as any

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} />)

    await waitFor(() => Boolean(controller))

    await controller.actions.send('   ')
    expect(runTurn).not.toHaveBeenCalled()
    expect(controller.state.messages).toEqual([])
  })

  it('send is a no-op while a send is already in progress', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const runTurn = vi.fn(async ({ history, user }) => {
      await gate
      return [...history, user]
    })
    const engine: ChatEngine = { runTurn } as any

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} />)

    await waitFor(() => Boolean(controller))

    const p1 = controller.actions.send('first')
    await waitFor(() => controller.state.isLoading === true)

    await controller.actions.send('second')
    expect(runTurn).toHaveBeenCalledTimes(1)

    release()
    await p1
  })

	  it('tracks thinking time from real thinking_delta and freezes during tool execution', async () => {
    let nowMs = 0
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)

    const engine: ChatEngine = {
      async runTurn({ history, onEvent, user }) {
        nowMs = 0
        onEvent({ type: 'thinking_delta', thinking: 'a' } as StreamEvent)
        nowMs = 1000
        onEvent({ type: 'thinking_delta', thinking: 'b' } as StreamEvent)
        nowMs = 3000
        onEvent({ type: 'tool_start', id: 't1', name: 'Read' } as StreamEvent)
        nowMs = 10000
        onEvent({ type: 'assistant_delta', text: 'ok' } as StreamEvent)
        onEvent({ type: 'complete' } as StreamEvent)
        return [...history, user]
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} />)
    await waitFor(() => Boolean(controller))

	    await controller.actions.send('hello')
	    await waitFor(() => controller.state.thinkingText.includes('ab'))

	    expect(controller.state.thinkingText).toContain('ab')
	    expect(controller.state.thinkingStartedAtMs).toBe(null)
	    expect(controller.state.thinkingTotalMs).toBe(3000)

    dateNowSpy.mockRestore()
  })
})

	describe('useReplController tool lifecycle', () => {
	  it('updates a tool message via tool_input/tool_update and completes it on tool_end', async () => {
    let releaseEnd!: () => void
    const endGate = new Promise<void>((resolve) => {
      releaseEnd = resolve
    })

    const engine: ChatEngine = {
      async runTurn({ history, onEvent, user }) {
        onEvent({ type: 'tool_start', id: 't1', name: 'Read' } as StreamEvent)
        onEvent({ type: 'tool_input', id: 't1', input: { file_path: '/tmp/x' } } as StreamEvent)
        onEvent({ type: 'tool_update', id: 't1', middleLines: ['Working…'] } as StreamEvent)
        await endGate
        onEvent({ type: 'tool_end', id: 't1', result: { tool_use_id: 't1', content: 'ok' } } as StreamEvent)
        onEvent({ type: 'complete' } as StreamEvent)
        return [...history, user]
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} />)
    await waitFor(() => Boolean(controller))

    const sendPromise = controller.actions.send('hello')

    // Verify that generic tools set loadingText to 'Working' (AskUserQuestion uses 'Waiting')
    await waitFor(() => controller.state.loadingText === 'Working')
    await waitFor(() => controller.state.messages.some((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't1'))
    await waitFor(() => {
      const msg = controller.state.messages.find((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't1')
      return (
        msg?.toolInfo?.status === 'running' &&
        (msg.toolInfo as any)?.input?.file_path === '/tmp/x' &&
        Array.isArray(msg.toolInfo?.middleLines) &&
        msg.toolInfo?.middleLines?.[0] === 'Working…'
      )
    })
    expect(controller.state.transientMessages.some((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't1')).toBe(true)
    expect(controller.state.staticMessages.some((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't1')).toBe(false)

	    releaseEnd()
	    await sendPromise
	    await waitFor(() => controller.state.messages.some((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't1' && m.toolInfo?.status === 'completed'))

	    const msg = controller.state.messages.find((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't1')
	    expect(msg?.toolInfo?.status).toBe('completed')
	    expect(msg?.toolInfo?.result).toBe('ok')
	    expect(msg?.content).toBeTruthy()
    expect(controller.state.transientMessages.some((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't1')).toBe(false)
    expect(controller.state.staticMessages.some((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't1')).toBe(true)
  })

  it('formats Task completion as Done(...tool uses · tokens · duration)', async () => {
    let releaseEnd!: () => void
    const endGate = new Promise<void>((resolve) => {
      releaseEnd = resolve
    })

    const engine: ChatEngine = {
      async runTurn({ history, onEvent, user }) {
        onEvent({ type: 'tool_start', id: 't-task', name: 'Task' } as StreamEvent)
        onEvent({ type: 'tool_update', id: 't-task', toolUses: 2, usage: { input_tokens: 10, output_tokens: 5 } } as StreamEvent)
        await endGate
        onEvent({ type: 'tool_end', id: 't-task', result: { tool_use_id: 't-task', content: 'ok' } } as StreamEvent)
        onEvent({ type: 'complete' } as StreamEvent)
        return [...history, user]
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} />)
    await waitFor(() => Boolean(controller))

    const sendPromise = controller.actions.send('hello')
    await waitFor(() => controller.state.messages.some((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't-task'))

	    releaseEnd()
	    await sendPromise
	    await waitFor(() => controller.state.messages.some((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't-task' && m.toolInfo?.status === 'completed'))

	    const msg = controller.state.messages.find((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't-task')
	    expect(msg?.toolInfo?.status).toBe('completed')
	    expect(msg?.toolInfo?.toolUses).toBe(2)
	    expect(msg?.content).toContain('Done (')
    expect(msg?.content).toContain('2 tool uses')
    expect(msg?.content).toContain('15 tokens')
    expect(msg?.content).toMatch(/\d+s\)$/)
  })

  it('hides Skill summary content on success', async () => {
    const engine: ChatEngine = {
      async runTurn({ history, onEvent, user }) {
        onEvent({ type: 'tool_start', id: 't-skill', name: 'Skill' } as StreamEvent)
        onEvent({ type: 'tool_end', id: 't-skill', result: { tool_use_id: 't-skill', content: JSON.stringify({ summary: 'ok' }) } } as StreamEvent)
        onEvent({ type: 'complete' } as StreamEvent)
        return [...history, user]
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} />)
    await waitFor(() => Boolean(controller))

    await controller.actions.send('hello')
    await waitFor(() => controller.state.messages.some((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't-skill'))

    const msg = controller.state.messages.find((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't-skill')
    expect(msg?.toolInfo?.status).toBe('completed')
    expect(msg?.content).toBe('')
    expect(msg?.toolInfo?.result).toContain('summary')
  })
})

	describe('useReplController /compact', () => {
	  it('runs a tools-free compact turn and uses the summary in the next turn history', async () => {
	    const tools: ToolDefinition[] = [{ name: 'T', description: 't', input_schema: {} }]
	    const runTurn = vi.fn(async (args: any) => {
	      if (Array.isArray(args.tools) && args.tools.length === 0) {
        expect(String(args.user?.role)).toBe('user')
        const text = String(args.user?.content?.[0]?.text ?? '')
        expect(text).toContain('Summarize the conversation so far')
        expect(text).toContain('Additional user instructions:')
        expect(text).toContain('because keep it short')
	        return [
	          ...args.history,
	          args.user,
	          { role: 'assistant', content: [{ type: 'text', text: 'SUMMARY' }] },
	        ]
	      }

      const hasSummaryInHistory = (args.history ?? []).some((m: any) => {
        if (m?.role !== 'assistant' || !Array.isArray(m?.content)) return false
        return m.content.some((b: any) => b?.type === 'text' && b?.text === 'SUMMARY')
	      })
	      expect(hasSummaryInHistory).toBe(true)

	      args.onEvent?.({ type: 'assistant_delta', text: 'OK' } as StreamEvent)
	      args.onEvent?.({ type: 'complete' } as StreamEvent)

	      return [...args.history, args.user, { role: 'assistant', content: [{ type: 'text', text: 'OK' }] }]
	    })

    const engine: ChatEngine = { runTurn } as any
    const base = createCfg()
    const cfg = createCfg({
      llm: { ...base.llm, contextWindowTokens: 0 },
      ui: { ...base.ui, showContextMeter: false },
    })

    const userInput = createUserInputManager()
    let controller!: ReturnType<typeof useReplController>
    renderTracked(
      <UserInputProvider userInput={userInput}>
        <Harness engine={engine} tools={tools} cfg={cfg} onController={(c) => (controller = c)} />
      </UserInputProvider>,
    )
    await waitFor(() => Boolean(controller))

	    const compactPromise = controller.actions.send('/compact because keep it short')
	    await compactPromise
	    await waitFor(() => lastAssistantText(controller).includes('Conversation history compacted'))

	    await controller.actions.send('hello')
	    await waitFor(() => lastAssistantText(controller).includes('OK'))

    expect(runTurn).toHaveBeenCalledTimes(2)
    expect((runTurn.mock.calls[0]?.[0] as any)?.tools).toEqual([])
  })

	  it('shows a user-facing error when the compact summary is empty', async () => {
    const engine: ChatEngine = {
      async runTurn({ history, user }) {
        return [...history, user]
      },
    }

    const base = createCfg()
    const cfg = createCfg({
      llm: { ...base.llm, contextWindowTokens: 0 },
      ui: { ...base.ui, showContextMeter: false },
    })

    const userInput = createUserInputManager()
    let controller!: ReturnType<typeof useReplController>
    renderTracked(
      <UserInputProvider userInput={userInput}>
        <Harness engine={engine} cfg={cfg} onController={(c) => (controller = c)} />
      </UserInputProvider>,
    )
    await waitFor(() => Boolean(controller))

	    await controller.actions.send('/compact')
	    await waitFor(() => controller.state.isLoading === false)
	    await waitFor(() => controller.state.error !== null)

	    expect(controller.state.isLoading).toBe(false)
	    expect(controller.state.error).toContain('Compact failed')
	    expect(lastAssistantText(controller)).toContain('Error: Compact failed')
	  })

	  it('shows a user-facing error when the compact turn throws', async () => {
    const engine: ChatEngine = {
      async runTurn() {
        throw new Error('boom')
      },
    }

    const base = createCfg()
    const cfg = createCfg({
      llm: { ...base.llm, contextWindowTokens: 0 },
      ui: { ...base.ui, showContextMeter: false },
    })

    const userInput = createUserInputManager()
    let controller!: ReturnType<typeof useReplController>
    renderTracked(
      <UserInputProvider userInput={userInput}>
        <Harness engine={engine} cfg={cfg} onController={(c) => (controller = c)} />
      </UserInputProvider>,
    )
    await waitFor(() => Boolean(controller))

	    await controller.actions.send('/compact')
	    await waitFor(() => controller.state.isLoading === false)
	    await waitFor(() => controller.state.error !== null)

	    expect(controller.state.isLoading).toBe(false)
	    expect(controller.state.error).toBe('boom')
	    expect(lastAssistantText(controller)).toBe('Error: boom')
	  })
})

describe('useReplController /clear', () => {
  it('clears prompt history and replaces the UI message list', async () => {
    const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-save-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevSessionSave = process.env.FORMAX_SESSION_SAVE
    process.env.FORMAX_CONFIG_DIR = configDir
    process.env.FORMAX_SESSION_SAVE = '1'

    const listSessionFiles = async (): Promise<string[]> => {
      const root = path.join(configDir, 'sessions')
      const out: string[] = []
      const walk = async (dir: string) => {
        const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const ent of ents) {
          const full = path.join(dir, ent.name)
          if (ent.isDirectory()) await walk(full)
          else if (ent.isFile() && ent.name.endsWith('.jsonl')) out.push(full)
        }
      }
      await walk(root)
      return out.sort()
    }

    const waitForSessionFiles = async (minCount: number) => {
      const start = Date.now()
      while (Date.now() - start < 2000) {
        const files = await listSessionFiles()
        if (files.length >= minCount) return files
        await tick(10)
      }
      throw new Error('Timed out waiting for session files')
    }

    try {
      const historyLens: number[] = []
      const runTurn = vi.fn(async (args: any) => {
        historyLens.push((args.history ?? []).length)
        return [
          ...(args.history ?? []),
          args.user,
          { role: 'assistant', content: [{ type: 'text', text: `HISTLEN:${(args.history ?? []).length}` }] },
        ]
      })
      const engine: ChatEngine = { runTurn } as any

      const cfg = createCfg({ ui: { ...createCfg().ui, showContextMeter: false } })
      const userInput = createUserInputManager()
      let controller!: ReturnType<typeof useReplController>
      renderTracked(
        <UserInputProvider userInput={userInput}>
          <Harness engine={engine} cfg={cfg} onController={(c) => (controller = c)} />
        </UserInputProvider>,
      )
      await waitFor(() => Boolean(controller))
      const filesBefore = await waitForSessionFiles(1)
      expect(filesBefore).toHaveLength(1)

      await controller.actions.send('hi')
      await waitFor(() => controller.state.isLoading === false)
      expect(historyLens[0]).toBe(0)

      await controller.actions.send('hi2')
      await waitFor(() => controller.state.isLoading === false)
      expect(historyLens[1]).toBeGreaterThan(0)

      const seqBefore = controller.state.transcriptSeq
      await controller.actions.send('/clear')
      await waitFor(() => controller.state.transcriptSeq === seqBefore + 1 && controller.state.messages.length === 0)
      expect(controller.state.messages).toHaveLength(0)
      const filesAfterClear = await waitForSessionFiles(2)
      expect(filesAfterClear.length).toBeGreaterThanOrEqual(2)

      await controller.actions.send('hi3')
      await waitFor(() => controller.state.isLoading === false)
      expect(historyLens[2]).toBe(0)
      expect(runTurn).toHaveBeenCalledTimes(3)
    } finally {
      process.env.FORMAX_CONFIG_DIR = prevConfigDir
      process.env.FORMAX_SESSION_SAVE = prevSessionSave
      await fsp.rm(configDir, { recursive: true, force: true })
    }
  })

  it('does not race session writer creation after /clear', async () => {
    const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-save-race-'))
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevSessionSave = process.env.FORMAX_SESSION_SAVE
    process.env.FORMAX_CONFIG_DIR = configDir
    process.env.FORMAX_SESSION_SAVE = '1'

    const listSessionFiles = async (): Promise<string[]> => {
      const root = path.join(configDir, 'sessions')
      const out: string[] = []
      const walk = async (dir: string) => {
        const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const ent of ents) {
          const full = path.join(dir, ent.name)
          if (ent.isDirectory()) await walk(full)
          else if (ent.isFile() && ent.name.endsWith('.jsonl')) out.push(full)
        }
      }
      await walk(root)
      return out.sort()
    }

    const waitForSessionFiles = async (minCount: number) => {
      const start = Date.now()
      while (Date.now() - start < 2000) {
        const files = await listSessionFiles()
        if (files.length >= minCount) return files
        await tick(10)
      }
      throw new Error('Timed out waiting for session files')
    }

    const realCreateNew = SessionWriter.createNew.bind(SessionWriter)
    const createNewSpy = vi
      .spyOn(SessionWriter, 'createNew')
      .mockImplementation(async (args: any) => {
        // Keep the writer init pending long enough for a second send() to overlap.
        await tick(50)
        return realCreateNew(args)
      })

    try {
      const runTurn = vi.fn(async (args: any) => {
        return [
          ...(args.history ?? []),
          args.user,
          { role: 'assistant', content: [{ type: 'text', text: 'OK' }] },
        ]
      })
      const engine: ChatEngine = { runTurn } as any

      const cfg = createCfg({ ui: { ...createCfg().ui, showContextMeter: false } })
      const userInput = createUserInputManager()
      let controller!: ReturnType<typeof useReplController>
      renderTracked(
        <UserInputProvider userInput={userInput}>
          <Harness engine={engine} cfg={cfg} onController={(c) => (controller = c)} />
        </UserInputProvider>,
      )
      await waitFor(() => Boolean(controller))
      await waitForSessionFiles(1)
      createNewSpy.mockClear()

      const seqBefore = controller.state.transcriptSeq
      await controller.actions.send('/clear')
      await waitFor(() => controller.state.transcriptSeq === seqBefore + 1 && controller.state.messages.length === 0)

      await controller.actions.send('hi after clear')
      await waitFor(() => controller.state.isLoading === false)

      // Should only create a single new writer for the cleared session.
      expect(createNewSpy).toHaveBeenCalledTimes(1)
      const filesAfter = await waitForSessionFiles(2)
      expect(filesAfter.length).toBeGreaterThanOrEqual(2)
    } finally {
      createNewSpy.mockRestore()
      process.env.FORMAX_CONFIG_DIR = prevConfigDir
      process.env.FORMAX_SESSION_SAVE = prevSessionSave
      await fsp.rm(configDir, { recursive: true, force: true })
    }
  })
})

describe('useReplController sessionSave resume', () => {
  it('does not duplicate existing ui_msg records when resuming a session', async () => {
    const cwdDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-cwd-'))
    const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-config-'))
    const prevCwd = process.cwd()
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevSessionSave = process.env.FORMAX_SESSION_SAVE

    process.env.FORMAX_CONFIG_DIR = configDir
    process.env.FORMAX_SESSION_SAVE = '1'

    try {
      process.chdir(cwdDir)

      const { writer, filePath } = await SessionWriter.createNew({ cwd: cwdDir, env: process.env, maxLineBytes: 5000 })
      await writer.appendStableMsg({
        id: 'assistant-1',
        role: 'assistant',
        content: 'hello',
        timestamp: new Date('2026-02-02T00:00:00.000Z'),
      } as any)
      await writer.appendHistorySnapshot([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] as any)
      await writer.shutdown()

      const replay = await readSessionFile(filePath)

      const engine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          onEvent({ type: 'complete' } as any)
          return [...history, user]
        },
      }

      const cfg = createCfg({ ui: { ...createCfg().ui, showContextMeter: false } })
      const userInput = createUserInputManager()
      let controller!: ReturnType<typeof useReplController>
      renderTracked(
        <UserInputProvider userInput={userInput}>
          <Harness
            engine={engine}
            cfg={cfg}
            initialSession={{ filePath, messages: replay.messages as any, history: replay.history as any }}
            onController={(c) => (controller = c)}
          />
        </UserInputProvider>,
      )
      await waitFor(() => Boolean(controller))

      let observedResume = false
      const start = Date.now()
      while (Date.now() - start < 2000) {
        const raw = await fsp.readFile(filePath, 'utf8')
        const recs = raw
          .split('\n')
          .map((l) => l.trimEnd())
          .filter(Boolean)
          .map((l) => JSON.parse(l))

        const uiMsgs = recs.filter((r: any) => r.type === 'ui_msg')
        const hasResume = recs.some((r: any) => r.type === 'event' && r.name === 'resume')
        if (hasResume) {
          observedResume = true
          expect(uiMsgs).toHaveLength(1)
          break
        }
        await tick(10)
      }
      expect(observedResume).toBe(true)
    } finally {
      process.chdir(prevCwd)
      process.env.FORMAX_CONFIG_DIR = prevConfigDir
      process.env.FORMAX_SESSION_SAVE = prevSessionSave
      await fsp.rm(cwdDir, { recursive: true, force: true })
      await fsp.rm(configDir, { recursive: true, force: true })
    }
  })

  it('uses the last persisted history_state as the starting history when resuming', async () => {
    const cwdDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-cwd-'))
    const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-config-'))
    const prevCwd = process.cwd()
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevSessionSave = process.env.FORMAX_SESSION_SAVE

    process.env.FORMAX_CONFIG_DIR = configDir
    process.env.FORMAX_SESSION_SAVE = '1'

    try {
      process.chdir(cwdDir)

      const { writer, filePath } = await SessionWriter.createNew({ cwd: cwdDir, env: process.env, maxLineBytes: 5000 })
      await writer.appendHistorySnapshot([{ role: 'user', content: [{ type: 'text', text: 'fromHistory' }] }] as any)
      await writer.shutdown()

      const replay = await readSessionFile(filePath)

      const runTurn = vi.fn(async ({ history, user, onEvent }: any) => {
        expect((history[0] as any)?.content?.[0]?.text).toBe('fromHistory')
        onEvent({ type: 'complete' } as any)
        return [...history, user]
      })
      const engine: ChatEngine = { runTurn } as any

      const cfg = createCfg({ ui: { ...createCfg().ui, showContextMeter: false } })
      const userInput = createUserInputManager()
      let controller!: ReturnType<typeof useReplController>
      renderTracked(
        <UserInputProvider userInput={userInput}>
          <Harness
            engine={engine}
            cfg={cfg}
            initialSession={{ filePath, messages: replay.messages as any, history: replay.history as any }}
            onController={(c) => (controller = c)}
          />
        </UserInputProvider>,
      )
      await waitFor(() => Boolean(controller))

      await controller.actions.send('next')
      await waitFor(() => controller.state.isLoading === false)
      expect(runTurn).toHaveBeenCalled()
    } finally {
      process.chdir(prevCwd)
      process.env.FORMAX_CONFIG_DIR = prevConfigDir
      process.env.FORMAX_SESSION_SAVE = prevSessionSave
      await fsp.rm(cwdDir, { recursive: true, force: true })
      await fsp.rm(configDir, { recursive: true, force: true })
    }
  })
})

describe('useReplController sessionSave injected events', () => {
  it('records CLAUDE.md injection metadata as an event (no text persisted)', async () => {
    const cwdDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-cwd-'))
    const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-config-'))
    const prevCwd = process.cwd()
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevSessionSave = process.env.FORMAX_SESSION_SAVE

    process.env.FORMAX_CONFIG_DIR = configDir
    process.env.FORMAX_SESSION_SAVE = '1'

    await fsp.writeFile(path.join(cwdDir, 'CLAUDE.md'), '# PROJECT\n', 'utf8')
    await fsp.writeFile(path.join(configDir, 'CLAUDE.md'), '# GLOBAL\n', 'utf8')

    const listSessionFiles = async (): Promise<string[]> => {
      const root = path.join(configDir, 'sessions')
      const out: string[] = []
      const walk = async (dir: string) => {
        const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const ent of ents) {
          const full = path.join(dir, ent.name)
          if (ent.isDirectory()) await walk(full)
          else if (ent.isFile() && ent.name.endsWith('.jsonl')) out.push(full)
        }
      }
      await walk(root)
      return out.sort()
    }

    try {
      process.chdir(cwdDir)

      const engine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          onEvent({ type: 'complete' } as any)
          return [...history, user]
        },
      }

      const cfg = createCfg({ ui: { ...createCfg().ui, promptProfile: 'full', showContextMeter: false } })
      const userInput = createUserInputManager()
      let controller!: ReturnType<typeof useReplController>
      renderTracked(
        <UserInputProvider userInput={userInput}>
          <Harness engine={engine} cfg={cfg} onController={(c) => (controller = c)} />
        </UserInputProvider>,
      )
      await waitFor(() => Boolean(controller))

      await controller.actions.send('hi')
      await waitFor(() => controller.state.isLoading === false)

      const start = Date.now()
      let filePath: string | null = null
      while (Date.now() - start < 2000) {
        const files = await listSessionFiles()
        if (files.length > 0) {
          filePath = files[0]!
          break
        }
        await tick(10)
      }
      expect(filePath).toBeTruthy()

      const raw = await fsp.readFile(filePath!, 'utf8')
      const lines = raw
        .split('\n')
        .map((l) => l.trimEnd())
        .filter(Boolean)
        .map((l) => JSON.parse(l))

      const ev = lines.find((l: any) => l.type === 'event' && l.name === 'claude_md_injection')
      expect(ev).toBeTruthy()
      expect(ev.data?.project?.filePath).toContain('CLAUDE.md')
      expect(ev.data?.global?.filePath).toContain('CLAUDE.md')
      expect(String(ev.data?.project?.includedSha256 || '')).toMatch(/^[a-f0-9]{64}$/)
      expect(String(ev.data?.global?.includedSha256 || '')).toMatch(/^[a-f0-9]{64}$/)
      // Ensure we did not persist the injected text itself.
      expect(JSON.stringify(ev)).not.toContain('# claudeMd')
    } finally {
      process.chdir(prevCwd)
      process.env.FORMAX_CONFIG_DIR = prevConfigDir
      process.env.FORMAX_SESSION_SAVE = prevSessionSave
      await fsp.rm(cwdDir, { recursive: true, force: true })
      await fsp.rm(configDir, { recursive: true, force: true })
    }
  })

  it('records output style changes and local command injection metadata (no injected text persisted)', async () => {
    const cwdDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-cwd-'))
    const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-config-'))
    const prevCwd = process.cwd()
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevSessionSave = process.env.FORMAX_SESSION_SAVE

    process.env.FORMAX_CONFIG_DIR = configDir
    process.env.FORMAX_SESSION_SAVE = '1'

    const listSessionFiles = async (): Promise<string[]> => {
      const root = path.join(configDir, 'sessions')
      const out: string[] = []
      const walk = async (dir: string) => {
        const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const ent of ents) {
          const full = path.join(dir, ent.name)
          if (ent.isDirectory()) await walk(full)
          else if (ent.isFile() && ent.name.endsWith('.jsonl')) out.push(full)
        }
      }
      await walk(root)
      return out.sort()
    }

    try {
      process.chdir(cwdDir)

      const engine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          onEvent({ type: 'complete' } as any)
          return [...history, user]
        },
      }

      const cfg = createCfg({ ui: { ...createCfg().ui, promptProfile: 'full', showContextMeter: false } })
      const userInput = createUserInputManager()
      let controller!: ReturnType<typeof useReplController>
      renderTracked(
        <UserInputProvider userInput={userInput}>
          <Harness engine={engine} cfg={cfg} onController={(c) => (controller = c)} />
        </UserInputProvider>,
      )
      await waitFor(() => Boolean(controller))

      // Ensure a session file exists.
      await controller.actions.send('hi')
      await waitFor(() => controller.state.isLoading === false)

      controller.actions.closeConfigDialog({ kind: 'changed', message: 'Set output style to Explanatory' } as any)

      const start = Date.now()
      let filePath: string | null = null
      while (Date.now() - start < 2000) {
        const files = await listSessionFiles()
        if (files.length > 0) {
          filePath = files[0]!
          break
        }
        await tick(10)
      }
      expect(filePath).toBeTruthy()

      const started = Date.now()
      let raw = ''
      let lines: any[] = []
      let styleEv: any | undefined
      let injEv: any | undefined
      while (Date.now() - started < 2000) {
        raw = await fsp.readFile(filePath!, 'utf8')
        lines = raw
          .split('\n')
          .map((l) => l.trimEnd())
          .filter(Boolean)
          .map((l) => JSON.parse(l))
        styleEv = lines.find((l: any) => l.type === 'event' && l.name === 'output_style_changed')
        injEv = lines.find((l: any) => l.type === 'event' && l.name === 'local_command_injection')
        if (styleEv && injEv) break
        await tick(10)
      }

      expect(styleEv?.data?.style).toBe('explanatory')
      expect(injEv?.data?.commandName).toBe('/config')
      expect(injEv?.data?.stdoutChars).toBeGreaterThan(0)
      expect(injEv?.data?.injectedChars).toBeGreaterThan(0)

      // Ensure the injected blocks aren't persisted.
      expect(raw).not.toContain('<local-command-stdout>')
    } finally {
      process.chdir(prevCwd)
      process.env.FORMAX_CONFIG_DIR = prevConfigDir
      process.env.FORMAX_SESSION_SAVE = prevSessionSave
      await fsp.rm(cwdDir, { recursive: true, force: true })
      await fsp.rm(configDir, { recursive: true, force: true })
    }
  })

  it('records local command injection metadata for slash commands with recordForNextTurn', async () => {
    const cwdDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-cwd-'))
    const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-config-'))
    const prevCwd = process.cwd()
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevSessionSave = process.env.FORMAX_SESSION_SAVE

    process.env.FORMAX_CONFIG_DIR = configDir
    process.env.FORMAX_SESSION_SAVE = '1'

    const listSessionFiles = async (): Promise<string[]> => {
      const root = path.join(configDir, 'sessions')
      const out: string[] = []
      const walk = async (dir: string) => {
        const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const ent of ents) {
          const full = path.join(dir, ent.name)
          if (ent.isDirectory()) await walk(full)
          else if (ent.isFile() && ent.name.endsWith('.jsonl')) out.push(full)
        }
      }
      await walk(root)
      return out.sort()
    }

    try {
      process.chdir(cwdDir)

      const engine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          onEvent({ type: 'complete' } as any)
          return [...history, user]
        },
      }

      const cfg = createCfg({ ui: { ...createCfg().ui, promptProfile: 'full', showContextMeter: false } })

      const commandRegistry = {
        dispatch(input: string) {
          if (!input.startsWith('/todos')) return null
          return {
            kind: 'local' as const,
            stdout: 'Todos output',
            recordForNextTurn: {
              commandName: '/todos',
              commandMessage: 'todos',
              commandArgs: '',
              stdout: 'Todos output',
            },
          }
        },
      } as any

      const userInput = createUserInputManager()
      let controller!: ReturnType<typeof useReplController>
      renderTracked(
        <UserInputProvider userInput={userInput}>
          <Harness engine={engine} cfg={cfg} commandRegistry={commandRegistry} onController={(c) => (controller = c)} />
        </UserInputProvider>,
      )
      await waitFor(() => Boolean(controller))

      await controller.actions.send('/todos')
      await tick(20)

      const files = await listSessionFiles()
      expect(files.length).toBeGreaterThan(0)
      const filePath = files[0]!

      const raw = await fsp.readFile(filePath, 'utf8')
      const lines = raw
        .split('\n')
        .map((l) => l.trimEnd())
        .filter(Boolean)
        .map((l) => JSON.parse(l))

      const injEv = lines.find((l: any) => l.type === 'event' && l.name === 'local_command_injection')
      expect(injEv?.data?.source).toBe('slash_local')
      expect(injEv?.data?.commandName).toBe('/todos')
      expect(injEv?.data?.stdoutChars).toBeGreaterThan(0)
      expect(raw).not.toContain('<local-command-stdout>')
    } finally {
      process.chdir(prevCwd)
      process.env.FORMAX_CONFIG_DIR = prevConfigDir
      process.env.FORMAX_SESSION_SAVE = prevSessionSave
      await fsp.rm(cwdDir, { recursive: true, force: true })
      await fsp.rm(configDir, { recursive: true, force: true })
    }
  })

  it('records local command injection metadata for local_async recordForNextTurn', async () => {
    const cwdDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-cwd-'))
    const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-session-config-'))
    const prevCwd = process.cwd()
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevSessionSave = process.env.FORMAX_SESSION_SAVE

    process.env.FORMAX_CONFIG_DIR = configDir
    process.env.FORMAX_SESSION_SAVE = '1'

    const listSessionFiles = async (): Promise<string[]> => {
      const root = path.join(configDir, 'sessions')
      const out: string[] = []
      const walk = async (dir: string) => {
        const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const ent of ents) {
          const full = path.join(dir, ent.name)
          if (ent.isDirectory()) await walk(full)
          else if (ent.isFile() && ent.name.endsWith('.jsonl')) out.push(full)
        }
      }
      await walk(root)
      return out.sort()
    }

    try {
      process.chdir(cwdDir)

      const engine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          onEvent({ type: 'complete' } as any)
          return [...history, user]
        },
      }

      const cfg = createCfg({ ui: { ...createCfg().ui, promptProfile: 'full', showContextMeter: false } })

      const commandRegistry = {
        dispatch(input: string) {
          if (!input.startsWith('/async')) return null
          return {
            kind: 'local_async' as const,
            loadingText: 'Working',
            async run() {
              return {
                stdout: 'ok',
                recordForNextTurn: {
                  commandName: '/async',
                  commandMessage: 'async',
                  commandArgs: '',
                  stdout: 'Async output',
                },
              }
            },
          }
        },
      } as any

      const userInput = createUserInputManager()
      let controller!: ReturnType<typeof useReplController>
      renderTracked(
        <UserInputProvider userInput={userInput}>
          <Harness engine={engine} cfg={cfg} commandRegistry={commandRegistry} onController={(c) => (controller = c)} />
        </UserInputProvider>,
      )
      await waitFor(() => Boolean(controller))

      await controller.actions.send('/async')
      await waitFor(() => controller.state.isLoading === false)

      const files = await listSessionFiles()
      expect(files.length).toBeGreaterThan(0)
      const filePath = files[0]!

      const raw = await fsp.readFile(filePath, 'utf8')
      const lines = raw
        .split('\n')
        .map((l) => l.trimEnd())
        .filter(Boolean)
        .map((l) => JSON.parse(l))

      const injEv = lines.find((l: any) => l.type === 'event' && l.name === 'local_command_injection' && l.data?.commandName === '/async')
      expect(injEv?.data?.source).toBe('slash_local_async')
      expect(injEv?.data?.stdoutChars).toBeGreaterThan(0)
      expect(raw).not.toContain('<local-command-stdout>')
    } finally {
      process.chdir(prevCwd)
      process.env.FORMAX_CONFIG_DIR = prevConfigDir
      process.env.FORMAX_SESSION_SAVE = prevSessionSave
      await fsp.rm(cwdDir, { recursive: true, force: true })
      await fsp.rm(configDir, { recursive: true, force: true })
    }
  })
})

describe('useReplController auto-compact', () => {
  it('runs an auto-compact turn once and shows the notice', async () => {
    estimatePromptTokensMock.mockReturnValue(9000)

    const tools: ToolDefinition[] = [{ name: 'T', description: 't', input_schema: {} }]
    const runTurn = vi.fn(async (args: any) => {
      if (Array.isArray(args.tools) && args.tools.length === 0) {
        return [
          ...args.history,
          args.user,
          { role: 'assistant', content: [{ type: 'text', text: 'AUTO_SUMMARY' }] },
        ]
      }
      return [...args.history, args.user, { role: 'assistant', content: [{ type: 'text', text: 'OK' }] }]
    })
    const engine: ChatEngine = { runTurn } as any

    const base = createCfg()
    const cfg = createCfg({
      context: { ...base.context, enableAutoCompact: true },
    })

    const userInput = createUserInputManager()
    let controller!: ReturnType<typeof useReplController>
    renderTracked(
      <UserInputProvider userInput={userInput}>
        <Harness engine={engine} tools={tools} cfg={cfg} onController={(c) => (controller = c)} />
      </UserInputProvider>,
    )
    await waitFor(() => Boolean(controller))

    // Seed history with >= 2 non-tool user turns.
    await controller.actions.send('first')
    await waitFor(() => controller.state.isLoading === false)
    await controller.actions.send('second')
    await waitFor(() => controller.state.isLoading === false)

    await controller.actions.send('third')
    await waitFor(() =>
      controller.state.messages.some(
        (m) => m.role === 'assistant' && m.content.includes('Conversation history auto-compacted'),
      ),
    )
    await waitFor(() => controller.state.isLoading === false)

    // 1st: first, 2nd: second, 3rd: compact, 4th: third
    expect(runTurn).toHaveBeenCalledTimes(4)
    const toolsFreeCalls = runTurn.mock.calls.filter((c) => Array.isArray(c[0]?.tools) && c[0].tools.length === 0)
    expect(toolsFreeCalls).toHaveLength(1)

    await controller.actions.send('fourth')
    await waitFor(() => controller.state.isLoading === false)
    await tick()

    // No additional compact due to minTurnsBetweenRuns.
    expect(runTurn).toHaveBeenCalledTimes(5)
    const toolsFreeCallsAfter = runTurn.mock.calls.filter((c) => Array.isArray(c[0]?.tools) && c[0].tools.length === 0)
    expect(toolsFreeCallsAfter).toHaveLength(1)
  })
})

describe('useReplController injected blocks', () => {
  it('injects the next-turn blocks into the user message, then strips them from future history', async () => {
    const runTurn = vi.fn(async (args: any) => {
      return [...args.history, args.user, { role: 'assistant', content: [{ type: 'text', text: 'OK' }] }]
    })
    const engine: ChatEngine = { runTurn } as any

    const commandRegistry: SlashCommandRegistry = {
      list: () => [],
      suggest: () => [],
      dispatch: (input) => {
        if (input.startsWith('/record')) {
          return {
            kind: 'local',
            stdout: 'recorded',
            recordForNextTurn: {
              commandName: 'record',
              commandMessage: 'record for next turn',
              commandArgs: '',
              stdout: 'SENTINEL_STDOUT',
            },
          }
        }
        return null
      },
    }

    const base = createCfg()
    const cfg = createCfg({
      llm: { ...base.llm, contextWindowTokens: 0 },
      ui: { ...base.ui, showContextMeter: false },
    })

    const userInput = createUserInputManager()
    let controller!: ReturnType<typeof useReplController>
    renderTracked(
      <UserInputProvider userInput={userInput}>
        <Harness
          engine={engine}
          cfg={cfg}
          commandRegistry={commandRegistry}
          onController={(c) => (controller = c)}
        />
      </UserInputProvider>,
    )
    await waitFor(() => Boolean(controller))

    await controller.actions.send('/record')
    await tick()
    expect(runTurn).toHaveBeenCalledTimes(0)

    await controller.actions.send('hello')
    await tick()
    expect(runTurn).toHaveBeenCalledTimes(1)

    const firstArgs = runTurn.mock.calls[0]?.[0] as any
    const injectedInUser = (firstArgs.user?.content ?? []).some(
      (b: any) => b?.type === 'text' && String(b?.text ?? '').includes('SENTINEL_STDOUT'),
    )
    expect(injectedInUser).toBe(true)

    await controller.actions.send('again')
    await tick()
    expect(runTurn).toHaveBeenCalledTimes(2)

    const secondArgs = runTurn.mock.calls[1]?.[0] as any
    const injectedInHistory = (secondArgs.history ?? []).some((m: any) => {
      if (m?.role !== 'user' || !Array.isArray(m?.content)) return false
      return m.content.some((b: any) => b?.type === 'text' && String(b?.text ?? '').includes('SENTINEL_STDOUT'))
    })
    expect(injectedInHistory).toBe(false)
  })

  it('accumulates multiple injectNextTurn blocks and consumes them in the next send', async () => {
    const runTurn = vi.fn(async (args: any) => {
      return [...args.history, args.user, { role: 'assistant', content: [{ type: 'text', text: 'OK' }] }]
    })
    const engine: ChatEngine = { runTurn } as any

    const commandRegistry: SlashCommandRegistry = {
      list: () => [],
      suggest: () => [],
      dispatch: (input) => {
        if (input === '/record1') {
          return {
            kind: 'local',
            stdout: 'recorded1',
            recordForNextTurn: {
              commandName: 'record1',
              commandMessage: 'record for next turn',
              commandArgs: '',
              stdout: 'SENTINEL_ONE',
            },
          }
        }
        if (input === '/record2') {
          return {
            kind: 'local',
            stdout: 'recorded2',
            recordForNextTurn: {
              commandName: 'record2',
              commandMessage: 'record for next turn',
              commandArgs: '',
              stdout: 'SENTINEL_TWO',
            },
          }
        }
        return null
      },
    }

    const base = createCfg()
    const cfg = createCfg({
      llm: { ...base.llm, contextWindowTokens: 0 },
      ui: { ...base.ui, showContextMeter: false },
    })

    const userInput = createUserInputManager()
    let controller!: ReturnType<typeof useReplController>
    renderTracked(
      <UserInputProvider userInput={userInput}>
        <Harness
          engine={engine}
          cfg={cfg}
          commandRegistry={commandRegistry}
          onController={(c) => (controller = c)}
        />
      </UserInputProvider>,
    )
    await waitFor(() => Boolean(controller))

    await controller.actions.send('/record1')
    await controller.actions.send('/record2')
    await tick()
    expect(runTurn).toHaveBeenCalledTimes(0)

    await controller.actions.send('hello')
    await tick()
    expect(runTurn).toHaveBeenCalledTimes(1)

    const firstArgs = runTurn.mock.calls[0]?.[0] as any
    const userText = JSON.stringify(firstArgs.user?.content ?? [])
    expect(userText).toContain('SENTINEL_ONE')
    expect(userText).toContain('SENTINEL_TWO')

    await controller.actions.send('again')
    await tick()
    expect(runTurn).toHaveBeenCalledTimes(2)

    const secondArgs = runTurn.mock.calls[1]?.[0] as any
    const historyText = JSON.stringify(secondArgs.history ?? [])
    expect(historyText).not.toContain('SENTINEL_ONE')
    expect(historyText).not.toContain('SENTINEL_TWO')
  })
})

	describe('useReplController abort', () => {
  it('is safe to call abort() when idle', async () => {
    const engine: ChatEngine = {
      async runTurn({ history, user }) {
        return [...history, user]
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} />)
    await waitFor(() => Boolean(controller))

    const before = controller.state
    controller.actions.abort()
    await tick()

    expect(controller.state.isLoading).toBe(false)
    expect(controller.state.error).toBeNull()
    expect(controller.state.messages).toEqual(before.messages)
  })

  it('marks running tools as error and appends a declined message for AskUserQuestion', async () => {
    const engine: ChatEngine = {
      async runTurn({ history, onEvent, user, signal }) {
        onEvent({ type: 'tool_start', id: 't-ask', name: 'AskUserQuestion' } as StreamEvent)
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) return reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
          signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('AbortError'), { name: 'AbortError' })),
            { once: true },
          )
        })
        return [...history, user]
      },
    }

    const userInput = createUserInputManager()
    let controller!: ReturnType<typeof useReplController>
    renderTracked(
      <UserInputProvider userInput={userInput}>
        <Harness engine={engine} onController={(c) => (controller = c)} />
      </UserInputProvider>,
    )
    await waitFor(() => Boolean(controller))

    const sendPromise = controller.actions.send('hello')
    await waitFor(() => controller.state.messages.some((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't-ask'))
    // Verify that AskUserQuestion sets loadingText to 'Waiting' (not 'Working')
    expect(controller.state.loadingText).toBe('Waiting')

	    controller.actions.abort()
	    await sendPromise
	    await waitFor(() => {
	      const toolMsg = controller.state.messages.find((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't-ask')
	      return toolMsg?.toolInfo?.status === 'error'
	    })

	    const toolMsg = controller.state.messages.find((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't-ask')
	    expect(toolMsg?.toolInfo?.status).toBe('error')
	    expect(toolMsg?.content).toContain('Request aborted')

    const declined = controller.state.messages.filter(
      (m) => m.role === 'assistant' && /declined to answer questions/i.test(m.content),
    )
    expect(declined).toHaveLength(1)

    const assistantErrors = controller.state.messages.filter(
      (m) => m.role === 'assistant' && /^Error:\s*/.test(m.content),
    )
    expect(assistantErrors).toHaveLength(0)

    controller.actions.abort()
    await tick()
    const declinedAfterSecondAbort = controller.state.messages.filter(
      (m) => m.role === 'assistant' && /declined to answer questions/i.test(m.content),
    )
    expect(declinedAfterSecondAbort).toHaveLength(1)
  })
})

	describe('useReplController consumed slash commands', () => {
  it('opens agents/permissions overlays without calling the engine', async () => {
    const runTurn = vi.fn(async ({ history, user }) => [...history, user])
    const engine: ChatEngine = { runTurn } as any

    const commandRegistry: SlashCommandRegistry = {
      list: () => [],
      suggest: () => [],
      dispatch: (input) => {
        if (input === '/agents') return { kind: 'open_agents_dialog' }
        if (input === '/permissions') return { kind: 'open_permissions_dialog' }
        return null
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(
      <Harness
        engine={engine}
        onController={(c) => (controller = c)}
        commandRegistry={commandRegistry}
      />,
    )

    await waitFor(() => Boolean(controller))

    await controller.actions.send('/agents')
    await waitFor(() => controller.state.agentsDialogOpen === true)
    expect(controller.state.permissionsDialogOpen).toBe(false)
    expect(runTurn).toHaveBeenCalledTimes(0)

    await controller.actions.send('/permissions')
    await waitFor(() => controller.state.permissionsDialogOpen === true)
    expect(runTurn).toHaveBeenCalledTimes(0)
  })

  it('passes preferredSlashSpecId through to commandRegistry.dispatch as preferredSpecId', async () => {
    const runTurn = vi.fn(async ({ history, user }) => [...history, user])
    const engine: ChatEngine = { runTurn } as any

    const dispatch = vi.fn((input: string, opts?: { preferredSpecId?: string }) => {
      if (input === '/status') {
        expect(opts).toEqual({ preferredSpecId: 'user:/status' })
        return { kind: 'local', stdout: 'ok' }
      }
      return null
    })
    const commandRegistry: SlashCommandRegistry = {
      list: () => [],
      suggest: () => [],
      dispatch: dispatch as any,
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} commandRegistry={commandRegistry} />)
    await waitFor(() => Boolean(controller))

    await controller.actions.send('/status', { preferredSlashSpecId: 'user:/status' })
    await waitFor(() =>
      controller.state.messages.some(
        (m) => m.role === 'assistant' && m.ui?.kind === 'command_subline' && m.content.trim() === 'ok',
      ),
    )

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(runTurn).toHaveBeenCalledTimes(0)
    expect(
      controller.state.messages.some(
        (m) => m.role === 'assistant' && m.ui?.kind === 'command_subline' && m.content.trim() === 'ok',
      ),
    ).toBe(true)
  })

  it('splits multiline local command stdout into multiple command_subline messages', async () => {
    const runTurn = vi.fn(async ({ history, user }) => [...history, user])
    const engine: ChatEngine = { runTurn } as any

    const commandRegistry: SlashCommandRegistry = {
      list: () => [],
      suggest: () => [],
      dispatch: (input) => {
        if (input === '/multi') return { kind: 'local', stdout: 'one\ntwo\nthree' }
        return null
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} commandRegistry={commandRegistry} />)
    await waitFor(() => Boolean(controller))

    await controller.actions.send('/multi')
    await waitFor(
      () =>
        controller.state.messages.filter((m) => m.role === 'assistant' && m.ui?.kind === 'command_subline').length === 3,
    )

    expect(runTurn).toHaveBeenCalledTimes(0)

    const sublines = controller.state.messages
      .filter((m) => m.role === 'assistant' && m.ui?.kind === 'command_subline')
      .map((m) => m.content)
    expect(sublines).toEqual(['one', 'two', 'three'])
  })

	  it('runs local_async commands and appends stdout without calling the engine', async () => {
    const runTurn = vi.fn(async ({ history, user }) => [...history, user])
    const engine: ChatEngine = { runTurn } as any

    const run = vi.fn(async () => ({ stdout: 'ok' }))
    const commandRegistry: SlashCommandRegistry = {
      list: () => [],
      suggest: () => [],
      dispatch: (input) => {
        if (input === '/doctor') return { kind: 'local_async', loadingText: 'Diagnosing', run }
        return null
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} commandRegistry={commandRegistry} />)
    await waitFor(() => Boolean(controller))

	    const sendPromise = controller.actions.send('/doctor')
	    await sendPromise
	    await waitFor(() => run.mock.calls.length === 1)
	    await waitFor(() => controller.state.messages.some((m) => m.role === 'assistant' && m.ui?.kind === 'command_subline'))
	    expect(runTurn).toHaveBeenCalledTimes(0)
	    expect(run).toHaveBeenCalledTimes(1)

	    const assistantTexts = controller.state.messages.filter((m) => m.role === 'assistant').map((m) => m.content)
	    expect(assistantTexts.some((t) => t.includes('Diagnosing'))).toBe(true)
	    expect(assistantTexts.some((t) => t.trim() === 'ok')).toBe(true)
    expect(
      controller.state.messages.some(
        (m) => m.role === 'assistant' && m.ui?.kind === 'command_subline' && m.content.includes('Diagnosing'),
      ),
    ).toBe(true)
    expect(
      controller.state.messages.some((m) => m.role === 'assistant' && m.ui?.kind === 'command_subline' && m.content.trim() === 'ok'),
    ).toBe(true)
  })

	  it('splits multiline local_async stdout into multiple command_subline messages', async () => {
    const runTurn = vi.fn(async ({ history, user }) => [...history, user])
    const engine: ChatEngine = { runTurn } as any

    const run = vi.fn(async () => ({ stdout: 'ok1\nok2\nok3' }))
    const commandRegistry: SlashCommandRegistry = {
      list: () => [],
      suggest: () => [],
      dispatch: (input) => {
        if (input === '/doctor') return { kind: 'local_async', loadingText: 'Diagnosing', run }
        return null
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} commandRegistry={commandRegistry} />)
    await waitFor(() => Boolean(controller))

	    await controller.actions.send('/doctor')
	    await waitFor(() => run.mock.calls.length === 1)
	    await waitFor(() => controller.state.messages.filter((m) => m.role === 'assistant' && m.ui?.kind === 'command_subline').length >= 4)

	    expect(runTurn).toHaveBeenCalledTimes(0)
	    expect(run).toHaveBeenCalledTimes(1)

    const sublines = controller.state.messages
      .filter((m) => m.role === 'assistant' && m.ui?.kind === 'command_subline')
      .map((m) => m.content.trim())
    expect(sublines).toEqual(['Diagnosing...', 'ok1', 'ok2', 'ok3'])
  })

	  it('surfaces errors from local_async commands without calling the engine', async () => {
    const runTurn = vi.fn(async ({ history, user }) => [...history, user])
    const engine: ChatEngine = { runTurn } as any

    const run = vi.fn(async () => {
      throw new Error('boom')
    })
    const commandRegistry: SlashCommandRegistry = {
      list: () => [],
      suggest: () => [],
      dispatch: (input) => {
        if (input === '/doctor') return { kind: 'local_async', loadingText: 'Diagnosing', run }
        return null
      },
    }

    let controller!: ReturnType<typeof useReplController>
    renderTracked(<Harness engine={engine} onController={(c) => (controller = c)} commandRegistry={commandRegistry} />)
    await waitFor(() => Boolean(controller))

	    await controller.actions.send('/doctor')
	    await waitFor(() => run.mock.calls.length === 1)
	    await waitFor(() => controller.state.messages.some((m) => m.role === 'assistant' && m.ui?.kind === 'command_subline' && m.content.includes('Error: boom')))

	    expect(runTurn).toHaveBeenCalledTimes(0)
	    expect(run).toHaveBeenCalledTimes(1)
	    expect(lastAssistantText(controller)).toContain('Error: boom')
    expect(
      controller.state.messages.some((m) => m.role === 'assistant' && m.ui?.kind === 'command_subline' && m.content.includes('Error: boom')),
    ).toBe(true)
  })
})
