import React, { useEffect } from 'react'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReplController } from './useReplController'
import { createUserInputManager } from '../../tools/runtime/userInputManager'
import { UserInputProvider } from '../../tools/runtime/userInputContext'
import type { ChatEngine } from '../../chat/engine'
import type { RuntimeConfig } from '../../env/config'
import type { ToolDefinition } from '../../tools/types'
import type { StreamEvent } from '../../streaming/types'
import type { SlashCommandRegistry } from '../commands/registry'

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
    },
    ...overrides,
  }
}

function Harness(args: {
  engine: ChatEngine
  tools?: ToolDefinition[]
  cfg?: RuntimeConfig
  commandRegistry?: SlashCommandRegistry
  onController: (c: ReturnType<typeof useReplController>) => void
}): React.ReactNode {
  const controller = useReplController({
    engine: args.engine,
    tools: args.tools ?? [],
    cfg: args.cfg ?? createCfg(),
    mode: 'normal',
    commandRegistry: args.commandRegistry,
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

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useReplController', () => {
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
    render(
      <UserInputProvider userInput={userInput}>
        <Harness engine={engine} onController={(c) => (controller = c)} />
      </UserInputProvider>,
    )

    await waitFor(() => Boolean(controller))
    await controller.actions.send('hello')
    await tick()

    const assistants = controller.state.messages.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0]?.content).toBe('Hi there')
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
    render(
      <Harness
        engine={engine}
        cfg={createCfg({ ui: { ...createCfg().ui, assistantTextMode: 'stream' } })}
        onController={(c) => (controller = c)}
      />,
    )

    await waitFor(() => Boolean(controller))

    const sendPromise = controller.actions.send('hello')
    await waitFor(() => lastAssistantText(controller) === 'Hi')
    releaseSecondDelta()
    await sendPromise
    await tick()

    const assistants = controller.state.messages.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0]?.content).toBe('Hi there')
    expect(assistants[0]?.isStreaming).toBe(false)
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
    render(<Harness engine={engine} onController={(c) => (controller = c)} />)

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
    render(<Harness engine={engine} onController={(c) => (controller = c)} />)

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
    render(<Harness engine={engine} onController={(c) => (controller = c)} />)

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
    render(<Harness engine={engine} onController={(c) => (controller = c)} />)

    await waitFor(() => Boolean(controller))

    const p1 = controller.actions.send('first')
    await waitFor(() => controller.state.isLoading === true)

    await controller.actions.send('second')
    expect(runTurn).toHaveBeenCalledTimes(1)

    release()
    await p1
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
    render(<Harness engine={engine} onController={(c) => (controller = c)} />)
    await waitFor(() => Boolean(controller))

    const sendPromise = controller.actions.send('hello')

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

    releaseEnd()
    await sendPromise

    const msg = controller.state.messages.find((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't1')
    expect(msg?.toolInfo?.status).toBe('completed')
    expect(msg?.toolInfo?.result).toBe('ok')
    expect(msg?.content).toBeTruthy()
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
    render(<Harness engine={engine} onController={(c) => (controller = c)} />)
    await waitFor(() => Boolean(controller))

    const sendPromise = controller.actions.send('hello')
    await waitFor(() => controller.state.messages.some((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't-task'))

    releaseEnd()
    await sendPromise

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
    render(<Harness engine={engine} onController={(c) => (controller = c)} />)
    await waitFor(() => Boolean(controller))

    await controller.actions.send('hello')
    await tick()

    const msg = controller.state.messages.find((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't-skill')
    expect(msg?.toolInfo?.status).toBe('completed')
    expect(msg?.content).toBe('')
    expect(msg?.toolInfo?.result).toContain('summary')
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
    render(<Harness engine={engine} onController={(c) => (controller = c)} />)
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
    render(
      <UserInputProvider userInput={userInput}>
        <Harness engine={engine} onController={(c) => (controller = c)} />
      </UserInputProvider>,
    )
    await waitFor(() => Boolean(controller))

    const sendPromise = controller.actions.send('hello')
    await waitFor(() => controller.state.messages.some((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't-ask'))

    controller.actions.abort()
    await sendPromise
    await tick()

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
    render(
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
    render(<Harness engine={engine} onController={(c) => (controller = c)} commandRegistry={commandRegistry} />)
    await waitFor(() => Boolean(controller))

    const sendPromise = controller.actions.send('/doctor')
    await waitFor(() => controller.state.isLoading === true)
    expect(controller.state.loadingText).toBe('Diagnosing')

    await sendPromise
    await waitFor(() => controller.state.isLoading === false)
    expect(runTurn).toHaveBeenCalledTimes(0)
    expect(run).toHaveBeenCalledTimes(1)

    const assistantTexts = controller.state.messages.filter((m) => m.role === 'assistant').map((m) => m.content)
    expect(assistantTexts.some((t) => t.includes('Diagnosing'))).toBe(true)
    expect(assistantTexts.some((t) => t.trim() === 'ok')).toBe(true)
  })
})
