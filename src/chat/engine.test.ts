import { describe, expect, it } from 'vitest'
import { createChatEngine } from './engine'
import type { PromptMessage } from '../prompts'
import type { ToolExecutor } from '../tools/executor'
import type { LlmStreamClient, LlmStreamOnceArgs, StreamEvent, StreamTurnResult } from '../streaming/types'

describe('ChatEngine', () => {
  it('loops on stopReason=tool_use and appends tool_result messages', async () => {
    let callCount = 0

    const client: LlmStreamClient = {
      async streamOnce(_args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        callCount++
        if (callCount === 1) {
          return {
            assistantBlocks: [
              { type: 'text', text: 'hi' },
              { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/tmp/a' } },
            ],
            stopReason: 'tool_use',
            toolResults: [{ tool_use_id: 't1', content: 'ok' }],
          }
        }
        return {
          assistantBlocks: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const executor: ToolExecutor = async () => {
      throw new Error('executor should not be called by ChatEngine')
    }

    const events: StreamEvent[] = []
    const history: PromptMessage[] = []

    const engine = createChatEngine({ client, executor })
    const out = await engine.runTurn({
      history,
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [],
      onEvent: (ev) => events.push(ev),
      cwd: '/tmp',
    })

    expect(callCount).toBe(2)
    expect(out).toHaveLength(4)
    expect(out[0]!.role).toBe('user')
    expect(out[1]!.role).toBe('assistant')
    expect(out[2]!.role).toBe('user')
    expect((out[2]!.content[0] as any).type).toBe('tool_result')
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })
})

