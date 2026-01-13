import { describe, expect, it } from 'vitest'
import { createToolExecutor, type ToolHandler } from './index'
import type { ToolCall, ToolResult } from '../types'

describe('createToolExecutor', () => {
  it('runs preflight and short-circuits when it returns a result', async () => {
    let handlerExecuted = false

    const handler: ToolHandler = {
      canHandle: () => true,
      execute: async (): Promise<ToolResult> => {
        handlerExecuted = true
        return { tool_use_id: 't1', content: 'handler' }
      },
    }

    const preflight = async (): Promise<ToolResult> => ({
      tool_use_id: 't1',
      content: 'blocked',
      is_error: true,
    })

    const exec = createToolExecutor([handler], { preflight })
    const res = await exec({ id: 't1', name: 'Any', input: {} } as ToolCall, { cwd: process.cwd(), agentDepth: 0 })

    expect(res.content).toBe('blocked')
    expect(res.is_error).toBe(true)
    expect(handlerExecuted).toBe(false)
  })

  it('runs the handler when preflight returns null', async () => {
    const handler: ToolHandler = {
      canHandle: (name) => name === 'Any',
      execute: async (): Promise<ToolResult> => ({ tool_use_id: 't2', content: 'handler' }),
    }

    const preflight = async (): Promise<ToolResult | null> => null

    const exec = createToolExecutor([handler], { preflight })
    const res = await exec({ id: 't2', name: 'Any', input: {} } as ToolCall, { cwd: process.cwd(), agentDepth: 0 })

    expect(res.content).toBe('handler')
    expect(res.is_error).toBeUndefined()
  })
})

