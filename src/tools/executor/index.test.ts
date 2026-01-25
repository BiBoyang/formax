import { describe, expect, it } from 'vitest'
import { createToolExecutor, type ToolHandler } from './index'
import type { ToolCall, ToolResult } from '../types'
import type { HooksRuntime } from '../../hooks/runtime.js'
import type { AuditEventV1 } from '../../core/audit/schema.js'

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

  it('runs PreToolUse hooks before preflight', async () => {
    let preflightCalls = 0
    let handlerCalls = 0
    const auditEvents: AuditEventV1[] = []

    const handler: ToolHandler = {
      canHandle: (name) => name === 'Any',
      execute: async (): Promise<ToolResult> => {
        handlerCalls++
        return { tool_use_id: 't3', content: 'handler' }
      },
    }

    const preflight = async (): Promise<ToolResult | null> => {
      preflightCalls++
      return null
    }

    const blockedBy = {
      command: 'echo nope',
      exitCode: 2,
      signal: null,
      stdout: '',
      stderr: 'blocked',
      durationMs: 1,
      timedOut: false,
      parsedJson: null,
    }

    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({
        runs: [blockedBy],
        blocked: true,
        blockedBy,
      }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
      runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runSessionStart: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runPostToolUse: async () => ({ runs: [], additionalContext: [], blockingErrors: [] }),
    }

    const exec = createToolExecutor([handler], {
      preflight,
      audit: {
        append: async (e) => {
          auditEvents.push(e)
        },
      },
    })
    const res = await exec(
      { id: 't3', name: 'Any', input: {} } as ToolCall,
      { cwd: process.cwd(), agentDepth: 0, hooks },
    )

    expect(String(res.content)).toContain('Error: Tool blocked by PreToolUse hook')
    expect(String(res.content)).toContain('blocked')
    expect(res.is_error).toBe(true)
    expect(preflightCalls).toBe(0)
    expect(handlerCalls).toBe(0)

    const hookRuns = auditEvents.filter((e) => e.kind === 'hook.run') as any[]
    expect(hookRuns).toHaveLength(1)
    expect(hookRuns[0].hook.eventName).toBe('PreToolUse')
    expect(hookRuns[0].hook.command).toBe('echo nope')
  })
})
