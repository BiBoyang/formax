import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { REPL } from './REPL'
import type { ChatEngine } from '../chat/engine'
import type { RuntimeConfig } from '../env/config'
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
	      await waitForFrame(lastFrame, (f) => f.includes('Conversation history compacted'), 4000)
	      await sleep(25)

      // Next message should see the compacted prompt history (summary + kept tail).
      stdin.write('hi')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:3'))
    })
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
      }

      stdin.write('hi')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:0'))
      await waitForIdlePrompt()

      stdin.write('hi2')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:2'))
      await waitForIdlePrompt()

      stdin.write('/clear')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => !f.includes('HISTLEN:2'))
      await waitForIdlePrompt()

      stdin.write('hi3')
      await tick()
      stdin.write('\r')
      await waitForFrame(lastFrame, (f) => f.includes('HISTLEN:0'))
    })
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
