import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { REPL } from '../REPL'
import type { ChatEngine } from '../../chat/engine'
import type { RuntimeConfig } from '../../env/config'
import type { PromptBlock, PromptMessage } from '../../prompts'

function tick(ms = 5): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForStableFrame(lastFrame: () => string | undefined, idleMs = 120, timeoutMs = 6000): Promise<string> {
  const start = Date.now()
  let last = lastFrame() || ''
  let lastChangeAt = Date.now()

  while (Date.now() - start < timeoutMs) {
    await tick(10)
    const next = lastFrame() || ''
    if (next !== last) {
      last = next
      lastChangeAt = Date.now()
      continue
    }
    if (Date.now() - lastChangeAt >= idleMs) return next
  }

  const frame = lastFrame() || ''
  throw new Error(`Timed out waiting for stable frame. Last frame:\n${frame}`)
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
  const frame = lastFrame() || ''
  throw new Error(`Timed out waiting for UI update. Last frame:\n${frame}`)
}

function getUserText(msg: PromptMessage): string {
  const content = msg.content as unknown
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const promptBlock = block as PromptBlock
      return promptBlock.type === 'text' ? String((promptBlock as { text?: unknown }).text ?? '') : ''
    })
    .join('')
}

const cfg: RuntimeConfig = {
  llm: {
    provider: 'anthropic',
    baseUrl: '',
    apiKey: '',
    model: 'surface-smoke-stub',
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

describe('surface smoke', () => {
  it(
    'supports cold ctrl+o and compact toggle sequence in forced Static mode',
    async () => {
      const prevForceStatic = process.env.FORMAX_FORCE_INK_STATIC
      process.env.FORMAX_FORCE_INK_STATIC = '1'

      try {
        const engine: ChatEngine = {
          async runTurn({ history, user, onEvent }) {
            const userText = getUserText(user)
            const isCompact = /Summarize the conversation/i.test(userText)
            const assistantText = isCompact ? 'SUMMARY' : `ECHO:${userText}`

            if (isCompact) {
              onEvent({ type: 'thinking_delta', thinking: 'compact-thought' })
              onEvent({ type: 'thinking_stop' })
              await tick(30)
            }
            onEvent({ type: 'assistant_delta', text: assistantText })
            onEvent({ type: 'complete' })

            return [
              ...history,
              user,
              { role: 'assistant', content: [{ type: 'text', text: assistantText }] as PromptBlock[] },
            ]
          },
        }

        const onClearTerminal = vi.fn(async () => {})
        const ui = render(<REPL engine={engine} tools={[]} cfg={cfg} onClearTerminal={onClearTerminal} />)

        await waitForFrame(ui.lastFrame, (frame) => frame.includes('Try "fix typecheck errors"'))

        ui.stdin.write('\u000f') // ctrl+o
        await waitForFrame(ui.lastFrame, (frame) => frame.includes('Showing detailed transcript · ctrl+o to toggle'))

        ui.stdin.write('\u000f') // ctrl+o
        await waitForFrame(ui.lastFrame, (frame) => frame.includes('? for shortcuts'))

        const sendAndWaitEcho = async (text: string) => {
          ui.stdin.write(text)
          await tick()
          ui.stdin.write('\r')
          await waitForFrame(ui.lastFrame, (frame) => frame.includes(`ECHO:${text}`))
          await waitForFrame(ui.lastFrame, (frame) => frame.includes('Try "fix typecheck errors"'))
        }

        await sendAndWaitEcho('1')
        await sendAndWaitEcho('2')

        const compactCommand = '/compact summarize this briefly'
        ui.stdin.write(compactCommand)
        await tick()
        ui.stdin.write('\r')
        await waitForFrame(
          ui.lastFrame,
          (frame) => frame.includes(`> ${compactCommand}`) && frame.includes('Compacting conversation'),
        )
        const compactFrame = await waitForFrame(
          ui.lastFrame,
          (frame) =>
            frame.includes('Conversation compacted · ctrl+o for history') &&
            frame.includes(`> ${compactCommand}`) &&
            frame.includes('Compacted (ctrl+o to see full summary)'),
        )
        const bannerIndex = compactFrame.indexOf('Conversation compacted · ctrl+o for history')
        const compactCommandIndex = compactFrame.indexOf(`> ${compactCommand}`, bannerIndex)
        const compactFinalSublineIndex = compactFrame.indexOf(
          'Compacted (ctrl+o to see full summary)',
          compactCommandIndex,
        )
        expect(bannerIndex).toBeGreaterThanOrEqual(0)
        expect(compactCommandIndex).toBeGreaterThanOrEqual(0)
        expect(compactFinalSublineIndex).toBeGreaterThanOrEqual(0)
        expect(bannerIndex).toBeLessThan(compactCommandIndex)
        expect(compactCommandIndex).toBeLessThan(compactFinalSublineIndex)

        ui.stdin.write('\u000f') // ctrl+o
        const expandedAfterCompactFrame = await waitForFrame(
          ui.lastFrame,
          (frame) =>
            frame.includes('Showing detailed transcript · ctrl+o to toggle') &&
            frame.includes('Conversation compacted · ctrl+o for history') &&
            frame.includes('SUMMARY') &&
            frame.includes(`> ${compactCommand}`) &&
            frame.includes('Compacted (ctrl+o to see full summary)'),
        )
        expect(expandedAfterCompactFrame.includes('compact-thought')).toBe(false)
        const expandedBannerIndex = expandedAfterCompactFrame.indexOf('Conversation compacted · ctrl+o for history')
        const summaryIndex = expandedAfterCompactFrame.indexOf('SUMMARY', expandedBannerIndex)
        const compactCmdIndex = expandedAfterCompactFrame.indexOf(`> ${compactCommand}`, summaryIndex)
        const compactSublineIndex = expandedAfterCompactFrame.indexOf(
          'Compacted (ctrl+o to see full summary)',
          compactCmdIndex,
        )
        expect(expandedBannerIndex).toBeGreaterThanOrEqual(0)
        expect(summaryIndex).toBeGreaterThanOrEqual(0)
        expect(compactCmdIndex).toBeGreaterThanOrEqual(0)
        expect(compactSublineIndex).toBeGreaterThanOrEqual(0)
        expect(expandedBannerIndex).toBeLessThan(summaryIndex)
        expect(summaryIndex).toBeLessThan(compactCmdIndex)
        expect(compactCmdIndex).toBeLessThan(compactSublineIndex)

        ui.stdin.write('\u000f') // ctrl+o
        await waitForFrame(
          ui.lastFrame,
          (frame) => frame.includes('? for shortcuts') && !frame.includes('Showing detailed transcript · ctrl+o to toggle'),
        )

        for (let i = 0; i < 20; i++) {
          ui.stdin.write('\u000f')
          await tick(8)
        }
        await waitForFrame(
          ui.lastFrame,
          (frame) => frame.includes('? for shortcuts') && !frame.includes('Showing detailed transcript · ctrl+o to toggle'),
        )
        await waitForStableFrame(ui.lastFrame)

        for (let i = 0; i < 12; i++) {
          await sendAndWaitEcho(`bulk-${i}`)
        }

        ui.stdin.write('\u000f')
        await waitForFrame(ui.lastFrame, (frame) => frame.includes('Showing detailed transcript · ctrl+o to toggle'))
        await waitForFrame(ui.lastFrame, (frame) => frame.includes('Ctrl+E to hide '))

        ui.stdin.write('\u0005')
        await waitForFrame(ui.lastFrame, (frame) => frame.includes('Ctrl+E to show '))

        ui.stdin.write('\u0005')
        await waitForFrame(ui.lastFrame, (frame) => frame.includes('Ctrl+E to hide '))

        ui.stdin.write('\u000f')
        await waitForFrame(
          ui.lastFrame,
          (frame) => frame.includes('? for shortcuts') && !frame.includes('Showing detailed transcript · ctrl+o to toggle'),
        )
        await waitForStableFrame(ui.lastFrame)

        await sendAndWaitEcho('after-ctrl-e')

        expect(onClearTerminal.mock.calls.length).toBeGreaterThanOrEqual(4)
      } finally {
        if (prevForceStatic === undefined) delete process.env.FORMAX_FORCE_INK_STATIC
        else process.env.FORMAX_FORCE_INK_STATIC = prevForceStatic
      }
    },
    30000,
  )
})
