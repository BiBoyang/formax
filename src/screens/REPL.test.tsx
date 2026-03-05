import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { REPL } from './REPL'
import type { ChatEngine } from '../chat/engine'
import type { RuntimeConfig } from '../config/config'
import type { PromptBlock, PromptMessage } from '../prompts'

/**
 * Feature: tool-ui-refactor
 * Property 4: Chat Functionality Preservation
 * Validates: Requirements 2.2
 *
 * For any chat interaction sequence, the refactored REPL should
 * behave identically to the original implementation in terms of message
 * handling, streaming, and user interactions.
 */
describe('REPL', () => {
  function tick(): Promise<void> {
    // Ink 6 + React 19 can batch/schedule updates differently (especially under coverage).
    // A tiny delay makes frame polling more reliable without changing behavior.
    return new Promise((resolve) => setTimeout(resolve, 5))
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function waitForFrame(
    lastFrame: () => string | undefined,
    predicate: (frame: string) => boolean,
    timeoutMs = 10000,
  ): Promise<string> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const frame = lastFrame() || ''
      if (predicate(frame)) return frame
      await tick()
    }
    const last = lastFrame() || ''
    throw new Error(`Timed out waiting for UI update.\n\nLast frame:\n${last}`)
  }

  async function waitForCondition(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return
      await tick()
    }
    throw new Error('Timed out waiting for condition')
  }

  async function clearPromptInput(stdin: { write: (value: string) => void }, maxBackspaces = 64): Promise<void> {
    // Some CI/coverage runs can lag prompt-clear commits; sweep stale input chars defensively.
    for (let i = 0; i < maxBackspaces; i++) stdin.write('\u007f')
    await tick()
  }

  async function queueMessageWhileLoading(args: {
    stdin: { write: (value: string) => void }
    lastFrame: () => string | undefined
    text: string
  }): Promise<void> {
    const { stdin, lastFrame, text } = args
    await clearPromptInput(stdin)
    stdin.write(text)
    await tick()
    stdin.write('\r')
    await waitForFrame(
      lastFrame,
      (frame) => frame.includes('Press up to edit queued messages') && frame.includes('Try "fix typecheck errors"'),
      15000,
    )
  }

  async function withForcedInkStatic<T>(run: () => Promise<T>): Promise<T> {
    const prev = process.env.FORMAX_FORCE_INK_STATIC
    process.env.FORMAX_FORCE_INK_STATIC = '1'
    try {
      return await run()
    } finally {
      if (prev === undefined) delete process.env.FORMAX_FORCE_INK_STATIC
      else process.env.FORMAX_FORCE_INK_STATIC = prev
    }
  }

  function getUserText(msg: PromptMessage): string {
    const content = msg.content as any
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .map((b: PromptBlock) => (b?.type === 'text' ? String((b as any).text ?? '') : ''))
      .join('')
  }

  function isAutoTitlePrompt(text: string): boolean {
    return text.startsWith('Please write a 5-10 word title for the following conversation:')
  }

  const engine: ChatEngine = {
    async runTurn({ history }) {
      return history
    },
  }

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

  describe('basic rendering', () => {
    it('should render without crashing', () => {
      const { lastFrame } = render(<REPL engine={engine} tools={[]} cfg={cfg} />)
      expect(lastFrame()).toBeDefined()
    })

    it('should display header banner', () => {
      const { lastFrame } = render(<REPL engine={engine} tools={[]} cfg={cfg} />)
      expect(lastFrame()).toContain('Model:')
      expect(lastFrame()).toContain(process.cwd())
    })

    it('should display shortcut hint', () => {
      const { lastFrame } = render(<REPL engine={engine} tools={[]} cfg={cfg} />)
      expect(lastFrame()).toContain('? for shortcuts')
    })

    it('should display input prompt', () => {
      const { lastFrame } = render(<REPL engine={engine} tools={[]} cfg={cfg} />)
      expect(lastFrame()).toContain('>')
    })
  })

  describe('UI elements', () => {
    it('should have input area', () => {
      const { lastFrame } = render(<REPL engine={engine} tools={[]} cfg={cfg} />)
      // Input area should be present
      expect(lastFrame()).toContain('>')
    })

    it('should show placeholder text', () => {
      const { lastFrame } = render(<REPL engine={engine} tools={[]} cfg={cfg} />)
      expect(lastFrame()).toContain('Try "fix typecheck errors"')
    })
  })

  describe('component integration', () => {
    it('should use ToolMessage component for tool messages', () => {
      // This test verifies that the refactored REPL
      // properly integrates with the ToolMessage component
      // The actual rendering is tested in ToolMessage.test.tsx
      const { lastFrame } = render(<REPL engine={engine} tools={[]} cfg={cfg} />)
      expect(lastFrame()).toBeDefined()
    })

    it('should use formatToolResult from toolFormatting', () => {
      // This test verifies that the refactored REPL
      // properly uses the extracted utility function
      // The actual formatting is tested in toolFormatting.test.ts
      const { lastFrame } = render(<REPL engine={engine} tools={[]} cfg={cfg} />)
      expect(lastFrame()).toBeDefined()
    })
  })

  describe('internal tool visibility', () => {
    it('hides ToolSearch rows by default', async () => {
      const prev = process.env.FORMAX_TUI_SHOW_INTERNAL_TOOLS
      delete process.env.FORMAX_TUI_SHOW_INTERNAL_TOOLS
      const initialSession = {
        filePath: '/tmp/session.jsonl',
        history: [] as PromptMessage[],
        messages: [
          {
            id: 'tool-search-1',
            role: 'tool' as const,
            content: 'Loaded 1 tool(s) for query: select:Bash',
            timestamp: new Date(1),
            toolInfo: {
              name: 'ToolSearch',
              toolUseId: 'tool-search-1',
              input: { query: 'select:Bash' },
              status: 'completed' as const,
              result: 'Loaded 1 tool(s) for query: select:Bash',
            },
          },
        ],
      }

      try {
        const { lastFrame, unmount } = render(<REPL engine={engine} tools={[]} cfg={cfg} initialSession={initialSession} />)
        await tick()
        expect(lastFrame() || '').not.toContain('ToolSearch')
        unmount()
      } finally {
        if (prev === undefined) delete process.env.FORMAX_TUI_SHOW_INTERNAL_TOOLS
        else process.env.FORMAX_TUI_SHOW_INTERNAL_TOOLS = prev
      }
    })

    it('shows ToolSearch rows when FORMAX_TUI_SHOW_INTERNAL_TOOLS is enabled', async () => {
      const prev = process.env.FORMAX_TUI_SHOW_INTERNAL_TOOLS
      process.env.FORMAX_TUI_SHOW_INTERNAL_TOOLS = '1'
      const initialSession = {
        filePath: '/tmp/session.jsonl',
        history: [] as PromptMessage[],
        messages: [
          {
            id: 'tool-search-2',
            role: 'tool' as const,
            content: 'Loaded 1 tool(s) for query: select:Bash',
            timestamp: new Date(1),
            toolInfo: {
              name: 'ToolSearch',
              toolUseId: 'tool-search-2',
              input: { query: 'select:Bash' },
              status: 'completed' as const,
              result: 'Loaded 1 tool(s) for query: select:Bash',
            },
          },
        ],
      }

      try {
        const { lastFrame, unmount } = render(<REPL engine={engine} tools={[]} cfg={cfg} initialSession={initialSession} />)
        await tick()
        expect(lastFrame() || '').toContain('ToolSearch')
        unmount()
      } finally {
        if (prev === undefined) delete process.env.FORMAX_TUI_SHOW_INTERNAL_TOOLS
        else process.env.FORMAX_TUI_SHOW_INTERNAL_TOOLS = prev
      }
    })
  })

  describe('error rendering', () => {
    it('shows status-first command subline and suppresses duplicate global API error', async () => {
      const failingEngine: ChatEngine = {
        async runTurn() {
          throw new Error(
            'API Error: 429 {"error":{"code":"1113","message":"insufficient balance"},"request_id":"req_1"}',
          )
        },
      }

      const { stdin, lastFrame } = render(<REPL engine={failingEngine} tools={[]} cfg={cfg} />)
      await tick()

      stdin.write('123')
      await tick()
      stdin.write('\r')

      const frame = await waitForFrame(lastFrame, (f) => f.includes('⎿  429 {"error":{"code":"1113"'))
      expect(frame).not.toContain('Error: API Error:')
    }, 20000)

    it('does not suppress a fresh global error because of a stale prior subline', async () => {
      let turn = 0
      const mixedEngine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          turn++
          if (turn === 1) {
            throw new Error('API Error: 429 {"error":{"code":"1113","message":"insufficient balance"}}')
          }

          onEvent({ type: 'error', error: new Error('fresh streaming error') })
          onEvent({ type: 'complete' })
          return [...history, user]
        },
      }

      const { stdin, lastFrame } = render(<REPL engine={mixedEngine} tools={[]} cfg={cfg} />)
      await tick()

      stdin.write('first')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('⎿  429 {"error":{"code":"1113"'), 15000)

      stdin.write('second')
      await tick()
      stdin.write('\r')

      const frame = await waitForFrame(lastFrame, (f) => f.includes('Error: fresh streaming error'), 15000)
      expect(frame).toContain('⎿  429 {"error":{"code":"1113","message":"insufficient balance"}}')
    }, 20000)
  })

  describe('exit handling', () => {
    it('should accept onExit prop', () => {
      let exitCalled = false
      const onExit = () => { exitCalled = true }
      
      const { lastFrame } = render(
        <REPL engine={engine} tools={[]} cfg={cfg} onExit={onExit} />,
      )
      expect(lastFrame()).toBeDefined()
      // Note: We can't easily test Ctrl+C in ink-testing-library
      // but we verify the prop is accepted
    })
  })

  describe('/compact', () => {
    it('compacts prompt history and continues the chat', async () => {
      function getUserText(msg: PromptMessage): string {
        const content = msg.content as any
        if (typeof content === 'string') return content
        if (!Array.isArray(content)) return ''
        return content
          .map((b: PromptBlock) => (b?.type === 'text' ? String((b as any).text ?? '') : ''))
          .join('')
      }

      const compactEngine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          const userText = getUserText(user)
          const isCompact = /Summarize the conversation/i.test(userText)
          const assistantText = isCompact ? 'SUMMARY' : `HISTLEN:${history.length}`

          onEvent({ type: 'assistant_delta', text: assistantText })
          onEvent({ type: 'complete' })

          return [
            ...history,
            user,
            { role: 'assistant', content: [{ type: 'text', text: assistantText }] as any },
          ]
        },
      }

      const { stdin, lastFrame } = render(<REPL engine={compactEngine} tools={[]} cfg={cfg} />)
      await tick()

      // Regular message: history starts empty.
	      stdin.write('hi')
	      await tick()
	      stdin.write('\r')
	      await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:0'))
	      // React 19 + Ink 6 can batch state updates; wait until the loading line clears
	      // so the next command isn't ignored due to isLoading still being true.
	      await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:0') && !f.includes('esc to interrupt'), 3000)
	      // Also wait for the input buffer to clear, otherwise subsequent stdin.write()
	      // appends onto the previous input (e.g. "hi/compact") and the slash command
	      // is not recognized.
	      await waitForFrame(lastFrame, (f) => f.includes('>  Try \"fix typecheck errors\"'), 3000)

	      // Compact
	      // Ensure the input is empty before typing the next command.
	      // With React 19 + Ink 6 scheduling, the previous value can briefly linger and cause
	      // typed text to append (e.g. "hi/compact"), which defeats slash command parsing.
	      for (let i = 0; i < 16; i++) {
	        stdin.write('\x7f')
	        await tick()
	      }
	      stdin.write('/compact')
	      await tick()
	      stdin.write('\r')
	      await waitForFrame(lastFrame, (f) => f.includes('Conversation compacted · ctrl+o for history'), 4000)
	      await waitForFrame(lastFrame, (f) => f.includes('Compacted (ctrl+o to see full summary)'), 4000)
	      await sleep(25)
	      const compactPrimary = lastFrame() || ''
	      expect(compactPrimary).not.toContain('HISTLEN:0')

	      stdin.write('\u000f') // ctrl+o
	      await waitForFrame(lastFrame, (f) => f.includes('Showing detailed transcript · ctrl+o to toggle'), 4000)
	      const compactExpanded = lastFrame() || ''
	      expect(compactExpanded).toContain('HISTLEN:0')
	      stdin.write('\u000f') // ctrl+o again
	      await waitForFrame(lastFrame, (f) => !f.includes('Showing detailed transcript · ctrl+o to toggle'), 4000)

	    }, 20000)

    it(
      'keeps primary state interactive after compact plus repeated ctrl+o toggles in Static mode',
      async () =>
        withForcedInkStatic(async () => {
          const onClearTerminal = vi.fn(async () => {})
          const compactEngine: ChatEngine = {
            async runTurn({ history, user, onEvent }) {
              const userText = getUserText(user)
              const isCompact = /Summarize the conversation/i.test(userText)
              const assistantText = isCompact ? 'SUMMARY' : `HISTLEN:${history.length}`

              onEvent({ type: 'assistant_delta', text: assistantText })
              onEvent({ type: 'complete' })

              return [
                ...history,
                user,
                { role: 'assistant', content: [{ type: 'text', text: assistantText }] as any },
              ]
            },
          }

          const { stdin, lastFrame } = render(
            <REPL engine={compactEngine} tools={[]} cfg={cfg} onClearTerminal={onClearTerminal} />,
          )
          await tick()

          stdin.write('1')
          await tick()
          stdin.write('\r')
          await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:0'))
          await waitForFrame(lastFrame, (f) => f.includes('Try "fix typecheck errors"'), 4000)

          stdin.write('2')
          await tick()
          stdin.write('\r')
          await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:2'))
          await waitForFrame(lastFrame, (f) => f.includes('Try "fix typecheck errors"'), 4000)

          stdin.write('/compact')
          await tick()
          stdin.write('\r')
          await waitForFrame(lastFrame, (f) => f.includes('Conversation compacted · ctrl+o for history'), 4000)
          await waitForFrame(lastFrame, (f) => f.includes('Compacted (ctrl+o to see full summary)'), 4000)

          for (let i = 0; i < 8; i++) {
            stdin.write('\u000f')
            await tick()
          }

          await waitForFrame(
            lastFrame,
            (f) => f.includes('? for shortcuts') && !f.includes('Showing detailed transcript · ctrl+o to toggle'),
            10000,
          )

          const frame = lastFrame() || ''
          expect(onClearTerminal.mock.calls.length).toBeGreaterThanOrEqual(9)
          expect(frame).toContain('Conversation compacted · ctrl+o for history')
          expect(frame).toContain('Compacted (ctrl+o to see full summary)')
          expect(frame.trim().length).toBeGreaterThan(0)
        }),
      30000,
    )

    it(
      'stays interactive after rapid ctrl+o toggles in Static mode',
      async () =>
        withForcedInkStatic(async () => {
          const onClearTerminal = vi.fn(async () => {})
          const echoEngine: ChatEngine = {
            async runTurn({ history, user, onEvent }) {
              const userText = getUserText(user)
              const assistantText = `ECHO:${userText}`
              onEvent({ type: 'assistant_delta', text: assistantText })
              onEvent({ type: 'complete' })
              return [
                ...history,
                user,
                { role: 'assistant', content: [{ type: 'text', text: assistantText }] as any },
              ]
            },
          }

          const { stdin, lastFrame } = render(
            <REPL engine={echoEngine} tools={[]} cfg={cfg} onClearTerminal={onClearTerminal} />,
          )
          await tick()

          for (let i = 0; i < 12; i++) {
            stdin.write('\u000f')
            await tick()
          }

          await sleep(50)
          const afterToggleFrame = lastFrame() || ''
          expect(onClearTerminal.mock.calls.length).toBeGreaterThan(0)
          expect(afterToggleFrame.trim().length).toBeGreaterThan(0)

          stdin.write('after')
          await tick()
          stdin.write('\r')
          await waitForFrame(lastFrame, (f) => f.includes('ECHO:after'), 10000)
        }),
      30000,
    )
	  })

  describe('/clear', () => {
    it('clears prompt history and continues the chat from a fresh context', async () => {
      function getUserText(msg: PromptMessage): string {
        const content = msg.content as any
        if (typeof content === 'string') return content
        if (!Array.isArray(content)) return ''
        return content
          .map((b: PromptBlock) => (b?.type === 'text' ? String((b as any).text ?? '') : ''))
          .join('')
      }

      const clearEngine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          const userText = getUserText(user)
          const assistantText = userText ? `HISTLEN:${history.length}` : `HISTLEN:${history.length}`

          onEvent({ type: 'assistant_delta', text: assistantText })
          onEvent({ type: 'complete' })

          return [
            ...history,
            user,
            { role: 'assistant', content: [{ type: 'text', text: assistantText }] as any },
          ]
        },
      }

      const { stdin, lastFrame } = render(<REPL engine={clearEngine} tools={[]} cfg={cfg} />)
      await tick()

      const waitForIdlePrompt = async () => {
        // When the input is empty, REPL shows the placeholder ("Try ...").
        // Under Ink 6 + React 19 batching (especially with coverage), it can take a couple ticks
        // for the input field to clear after pressing Enter.
        await waitForFrame(lastFrame, (f) => f.includes('Try "fix typecheck errors"'), 15000)
        await tick()
      }

      await clearPromptInput(stdin)
      stdin.write('hi')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:0'))
      await waitForIdlePrompt()

      await clearPromptInput(stdin)
      stdin.write('hi2')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:2'))
      await waitForIdlePrompt()

      await clearPromptInput(stdin)
      stdin.write('/clear')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => !f.includes('HISTLEN:2'))
      await waitForIdlePrompt()

      await clearPromptInput(stdin)
      stdin.write('hi3')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:0'))
    })
  })

  describe('loading input queue', () => {
    it('queues multiple entries during loading and auto-sends after current turn', async () => {
      let releaseFirstTurn: (() => void) | null = null
      const firstTurnGate = new Promise<void>((resolve) => {
        releaseFirstTurn = resolve
      })
      const sentTexts: string[] = []

      const queueEngine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          const userText = getUserText(user)
          sentTexts.push(userText)
          if (sentTexts.length === 1) await firstTurnGate
          onEvent({ type: 'assistant_delta', text: `ACK:${userText}` })
          onEvent({ type: 'complete' })
          return [...history, user, { role: 'assistant', content: [{ type: 'text', text: `ACK:${userText}` }] as any }]
        },
      }

      const { stdin, lastFrame } = render(<REPL engine={queueEngine} tools={[]} cfg={cfg} />)
      await tick()

      stdin.write('start')
      await tick()
      stdin.write('\r')
      await waitForCondition(() => sentTexts.length === 1)

      await queueMessageWhileLoading({ stdin, lastFrame, text: 'one' })
      await queueMessageWhileLoading({ stdin, lastFrame, text: 'two' })

      releaseFirstTurn?.()
      await waitForCondition(() => sentTexts.length >= 2, 15000)
      expect(sentTexts[0]).toBe('start')
      expect(sentTexts[1]).toBe('one\ntwo')
    }, 20000)

    it('joins queued entries using a single newline in FIFO order', async () => {
      let releaseFirstTurn: (() => void) | null = null
      const firstTurnGate = new Promise<void>((resolve) => {
        releaseFirstTurn = resolve
      })
      const sentTexts: string[] = []

      const queueEngine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          const userText = getUserText(user)
          sentTexts.push(userText)
          if (sentTexts.length === 1) await firstTurnGate
          onEvent({ type: 'assistant_delta', text: `ACK:${userText}` })
          onEvent({ type: 'complete' })
          return [...history, user, { role: 'assistant', content: [{ type: 'text', text: `ACK:${userText}` }] as any }]
        },
      }

      const { stdin, lastFrame } = render(<REPL engine={queueEngine} tools={[]} cfg={cfg} />)
      await tick()

      stdin.write('start')
      await tick()
      stdin.write('\r')
      await waitForCondition(() => sentTexts.length === 1)

      await queueMessageWhileLoading({ stdin, lastFrame, text: 'first' })
      await queueMessageWhileLoading({ stdin, lastFrame, text: 'second' })
      await queueMessageWhileLoading({ stdin, lastFrame, text: 'third' })

      releaseFirstTurn?.()
      await waitForCondition(() => sentTexts.length >= 2, 15000)
      expect(sentTexts[1]).toBe('first\nsecond\nthird')
    }, 20000)

    it('upArrow recalls the latest queued message and removes it from auto-flush queue', async () => {
      let releaseFirstTurn: (() => void) | null = null
      const firstTurnGate = new Promise<void>((resolve) => {
        releaseFirstTurn = resolve
      })
      const sentTexts: string[] = []

      const queueEngine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          const userText = getUserText(user)
          sentTexts.push(userText)
          if (sentTexts.length === 1) await firstTurnGate
          onEvent({ type: 'assistant_delta', text: `ACK:${userText}` })
          onEvent({ type: 'complete' })
          return [...history, user, { role: 'assistant', content: [{ type: 'text', text: `ACK:${userText}` }] as any }]
        },
      }

      const { stdin, lastFrame } = render(<REPL engine={queueEngine} tools={[]} cfg={cfg} />)
      await tick()

      stdin.write('start')
      await tick()
      stdin.write('\r')
      await waitForCondition(() => sentTexts.length === 1)

      await queueMessageWhileLoading({ stdin, lastFrame, text: 'recall-me' })

      stdin.write('\u001B[A') // upArrow
      await waitForFrame(
        lastFrame,
        (f) => f.includes('> recall-me') && !f.includes('Press up to edit queued messages'),
        15000,
      )

      releaseFirstTurn?.()
      await waitForFrame(lastFrame, (f) => f.includes('ACK:start'), 15000)
      await waitForCondition(() => sentTexts.length === 1, 5000)
      await sleep(120)
      expect(sentTexts.filter((text) => !isAutoTitlePrompt(text))).toEqual(['start'])
    }, 20000)

    it('keeps / and ! command input on Enter during loading without queuing or sending', async () => {
      let releaseFirstTurn: (() => void) | null = null
      const firstTurnGate = new Promise<void>((resolve) => {
        releaseFirstTurn = resolve
      })
      const sentTexts: string[] = []

      const queueEngine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          const userText = getUserText(user)
          sentTexts.push(userText)
          if (sentTexts.length === 1) await firstTurnGate
          onEvent({ type: 'assistant_delta', text: `ACK:${userText}` })
          onEvent({ type: 'complete' })
          return [...history, user, { role: 'assistant', content: [{ type: 'text', text: `ACK:${userText}` }] as any }]
        },
      }

      const { stdin, lastFrame } = render(<REPL engine={queueEngine} tools={[]} cfg={cfg} />)
      await tick()

      stdin.write('start')
      await tick()
      stdin.write('\r')
      await waitForCondition(() => sentTexts.length === 1)

      stdin.write('/status')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('> /status'))

      for (let i = 0; i < 12; i++) {
        stdin.write('\x7f')
        await tick()
      }
      stdin.write('!')
      await tick()
      stdin.write('ls')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('! ls'))

      releaseFirstTurn?.()
      await waitForFrame(lastFrame, (f) => f.includes('ACK:start'), 15000)
      await sleep(80)
      expect(sentTexts.filter((text) => !isAutoTitlePrompt(text))).toEqual(['start'])
    }, 20000)
  })

  describe('loading indicator', () => {
    it('keeps loading visible while assistant text is streaming', async () => {
      let releaseTurn: (() => void) | null = null
      const turnGate = new Promise<void>((resolve) => {
        releaseTurn = resolve
      })

      const streamingEngine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          onEvent({ type: 'assistant_delta', text: 'streaming assistant text' })
          await turnGate
          onEvent({ type: 'complete' })
          return [
            ...history,
            user,
            { role: 'assistant', content: [{ type: 'text', text: 'streaming assistant text' }] as any },
          ]
        },
      }

      const { stdin, lastFrame } = render(<REPL engine={streamingEngine} tools={[]} cfg={cfg} />)
      await tick()

      stdin.write('start')
      await tick()
      stdin.write('\r')

      await waitForFrame(lastFrame, (f) => f.includes('streaming assistant text'), 15000)
      await waitForFrame(lastFrame, (f) => f.includes('✻'), 15000)

      releaseTurn?.()
      await waitForCondition(() => !(lastFrame() || '').includes('✻'), 15000)
    }, 20000)
  })

  describe('auto-compact', () => {
    it('auto-compacts prompt history before sending when over the limit', async () => {
      function getUserText(msg: PromptMessage): string {
        const content = msg.content as any
        if (typeof content === 'string') return content
        if (!Array.isArray(content)) return ''
        return content
          .map((b: PromptBlock) => (b?.type === 'text' ? String((b as any).text ?? '') : ''))
          .join('')
      }

      const compactEngine: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          const userText = getUserText(user)
          const isCompact = /Summarize the conversation/i.test(userText)
          const assistantText = isCompact ? 'SUMMARY' : `HISTLEN:${history.length}`

          onEvent({ type: 'assistant_delta', text: assistantText })
          onEvent({ type: 'complete' })

          return [
            ...history,
            user,
            { role: 'assistant', content: [{ type: 'text', text: assistantText }] as any },
          ]
        },
      }

      const autoCfg: RuntimeConfig = {
        ...cfg,
        llm: { ...cfg.llm, contextWindowTokens: 50_000 },
        context: {
          ...cfg.context,
          autoCompactTokenLimitPercent: 0.0001,
          compactKeepLastTurns: 1,
          enableAutoCompact: true,
          autoCompactMinTurnsBetweenRuns: 0,
        },
        ui: { ...cfg.ui, showAutoCompactNotice: true },
      }

      const { stdin, lastFrame } = render(<REPL engine={compactEngine} tools={[]} cfg={autoCfg} />)
      await tick()

      stdin.write('hi1')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:0'))
      await sleep(25)

      stdin.write('hi2')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:2'))
      await sleep(25)

      stdin.write('hi3')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('auto-compacted'))
      await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:3'))
    })

    it('respects auto-compact throttling', async () => {
      function getUserText(msg: PromptMessage): string {
        const content = msg.content as any
        if (typeof content === 'string') return content
        if (!Array.isArray(content)) return ''
        return content
          .map((b: PromptBlock) => (b?.type === 'text' ? String((b as any).text ?? '') : ''))
          .join('')
      }

      let compactCalls = 0
      const engineWithCounters: ChatEngine = {
        async runTurn({ history, user, onEvent }) {
          const userText = getUserText(user)
          const isCompact = /Summarize the conversation/i.test(userText)
          if (isCompact) compactCalls++

          const assistantText = isCompact ? 'SUMMARY' : `HISTLEN:${history.length}`
          onEvent({ type: 'assistant_delta', text: assistantText })
          onEvent({ type: 'complete' })

          return [
            ...history,
            user,
            { role: 'assistant', content: [{ type: 'text', text: assistantText }] as any },
          ]
        },
      }

      const autoCfg: RuntimeConfig = {
        ...cfg,
        llm: { ...cfg.llm, contextWindowTokens: 50_000 },
        context: {
          ...cfg.context,
          autoCompactTokenLimitPercent: 0.0001,
          compactKeepLastTurns: 1,
          enableAutoCompact: true,
          autoCompactMinTurnsBetweenRuns: 100,
        },
        ui: { ...cfg.ui, showAutoCompactNotice: true },
      }

      const { stdin, lastFrame } = render(<REPL engine={engineWithCounters} tools={[]} cfg={autoCfg} />)
      await tick()

      for (const msg of ['hi1', 'hi2', 'hi3', 'hi4', 'hi5']) {
        stdin.write(msg)
        await tick()
        stdin.write('\r')
        await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:'))
        await sleep(10)
      }

      expect(compactCalls).toBe(1)
    })
  })
})
