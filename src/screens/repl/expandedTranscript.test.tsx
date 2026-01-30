import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { REPL } from '../REPL'
import type { ChatEngine } from '../../chat/engine'
import type { RuntimeConfig } from '../../env/config'
import type { PromptBlock, PromptMessage } from '../../prompts'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'

function tick(ms = 5): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  const frame = lastFrame() || ''
  throw new Error(`Timed out waiting for UI update. Last frame:\n${frame}`)
}

function getUserText(msg: PromptMessage): string {
  const content = msg.content as any
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b: PromptBlock) => (b?.type === 'text' ? String((b as any).text ?? '') : ''))
    .join('')
}

describe('Expanded Transcript (ctrl+o)', () => {
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
      showContextMeter: false,
      showAutoCompactNotice: false,
    },
  }

  it(
    'hides thinking blocks in the default transcript, shows them when expanded',
    async () => {
    const engine: ChatEngine = {
      async runTurn({ history, user, onEvent }) {
        const userText = getUserText(user)
        if (userText.trim()) {
          onEvent({ type: 'thinking_delta', thinking: 'THINKING: hello\n' })
          onEvent({ type: 'assistant_delta', text: 'OK' })
          onEvent({ type: 'tool_start', id: 't1', name: 'Task' })
          onEvent({
            type: 'tool_end',
            id: 't1',
            result: {
              is_error: false,
              content: JSON.stringify({ transcript: ['TASK TRANSCRIPT: line 1'] }),
            } as any,
          })
          onEvent({ type: 'complete' })
        }
        return [
          ...history,
          user,
          { role: 'assistant', content: [{ type: 'text', text: 'OK' }] as any },
        ]
      },
    }

    const ui = render(
      <InputScopeProvider initialScope="repl">
        <REPL engine={engine} tools={[]} cfg={cfg} />
      </InputScopeProvider>,
    )
    await tick()

    ui.stdin.write('hi')
    await tick()
    ui.stdin.write('\r')

    await waitForFrame(ui.lastFrame, (f) => f.includes('OK'), 10000)

    const baseline = ui.lastFrame() || ''
    expect(baseline).not.toContain('∴ Thinking')
    expect(baseline).not.toContain('THINKING: hello')
    expect(baseline).not.toContain('TASK TRANSCRIPT: line 1')

    ui.stdin.write('\u000f') // ctrl+o
    const expanded = await waitForFrame(ui.lastFrame, (f) => f.includes('TASK TRANSCRIPT: line 1'), 10000)
    expect(expanded).toContain('∴ Thinking')
    expect(expanded).toContain('THINKING: hello')

    ui.stdin.write('\u000f') // ctrl+o again
    await waitForFrame(ui.lastFrame, (f) => !f.includes('∴ Thinking'), 10000)
  },
    20000,
  )
})
