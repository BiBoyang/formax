import { describe, expect, it } from 'vitest'
import { createChatEngine } from './engine'
import type { PromptMessage } from '../prompts'
import type { ToolExecutor } from '../tools/executor'
import type { LlmStreamClient, LlmStreamOnceArgs, StreamEvent, StreamTurnResult } from '../streaming/types'
import type { HooksRuntime } from '../hooks/runtime'
import type { AuditEventV1 } from '../core/audit/schema.js'

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

  it('prunes oversized tool loop messages when promptBudget is provided', async () => {
    const tailMark = 'TAIL_MARK_SHOULD_NOT_SURVIVE'
    const huge = 'x'.repeat(9000) + tailMark
    let callCount = 0
    let secondCallMessages: PromptMessage[] | null = null

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        callCount++
        if (callCount === 1) {
          return {
            assistantBlocks: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/tmp/a' } }],
            stopReason: 'tool_use',
            toolResults: [{ tool_use_id: 't1', content: huge }],
          }
        }
        secondCallMessages = args.messages
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

    const engine = createChatEngine({ client, executor })
    await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
      promptBudget: { contextWindowTokens: 1000, effectiveContextWindowPercent: 1, autoCompactLimitPercent: 1, baselineTokens: 0 },
    })

    expect(callCount).toBe(2)
    expect(secondCallMessages).not.toBeNull()
    expect(JSON.stringify(secondCallMessages)).not.toContain(tailMark)
  })

  it('injects PostToolUse.additionalContext as a text block after tool_result (and does not persist it)', async () => {
    let callCount = 0
    let secondCallMessages: PromptMessage[] | null = null
    const auditEvents: AuditEventV1[] = []

    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
      runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runSessionStart: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runPostToolUse: async () => ({
        runs: [
          {
            command: 'echo hook',
            exitCode: 0,
            signal: null,
            stdout: '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"CTX_FROM_HOOK"}}',
            stderr: '',
            durationMs: 1,
            timedOut: false,
            parsedJson: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'CTX_FROM_HOOK' } },
          },
        ],
        additionalContext: ['CTX_FROM_HOOK'],
        blockingErrors: [],
      }),
    }

    const executor: ToolExecutor = async (call) => {
      return { tool_use_id: call.id, content: 'ok' }
    }

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        callCount++
        if (callCount === 1) {
          const call = { id: 't1', name: 'Bash', input: { command: 'echo ok' } }
          const toolResult = await args.executeTool(call as any)
          return {
            assistantBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo ok' } }],
            stopReason: 'tool_use',
            toolResults: [toolResult],
          }
        }

        secondCallMessages = args.messages
        return {
          assistantBlocks: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const engine = createChatEngine({
      client,
      executor,
      hooks,
      audit: {
        append: async (e) => {
          auditEvents.push(e)
        },
      },
    })
    const out = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    expect(callCount).toBe(2)
    expect(secondCallMessages).not.toBeNull()

    const injectedUserMsg = secondCallMessages!.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        (m.content as any[]).some((b) => b?.type === 'tool_result' && b?.tool_use_id === 't1'),
    )
    expect(injectedUserMsg).toBeTruthy()

    const blocks = (injectedUserMsg as any).content as any[]
    const idx = blocks.findIndex((b) => b?.type === 'tool_result' && b?.tool_use_id === 't1')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(blocks[idx + 1]?.type).toBe('text')
    expect(String(blocks[idx + 1]?.text || '')).toContain('<system-reminder>')
    expect(String(blocks[idx + 1]?.text || '')).toContain('PostToolUse:Bash hook additional context:')
    expect(String(blocks[idx + 1]?.text || '')).toContain('CTX_FROM_HOOK')

    const outJson = JSON.stringify(out)
    expect(outJson).not.toContain('PostToolUse:Bash hook additional context:')
    expect(outJson).not.toContain('CTX_FROM_HOOK')

    const hookRuns = auditEvents.filter((e) => e.kind === 'hook.run') as any[]
    expect(hookRuns).toHaveLength(1)
    expect(hookRuns[0].hook.eventName).toBe('PostToolUse')
    expect(hookRuns[0].hook.command).toBe('echo hook')
    expect(hookRuns[0].hook.status).toBe('ok')
    expect(hookRuns[0].hook.parsedJson).toBe(true)
    expect(hookRuns[0].hook.stdoutPreview).toBeUndefined()
  })

  it('injects PostToolUse blocking errors as a system-reminder text block after tool_result', async () => {
    let callCount = 0
    let secondCallMessages: PromptMessage[] | null = null

    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
      runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runSessionStart: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runPostToolUse: async () => ({
        runs: [],
        additionalContext: [],
        blockingErrors: [
          {
            command: 'echo bad',
            exitCode: 2,
            signal: null,
            stdout: '',
            stderr: 'HOOK_BLOCKED',
            durationMs: 1,
            timedOut: false,
            parsedJson: null,
          },
        ],
      }),
    }

    const executor: ToolExecutor = async (call) => {
      return { tool_use_id: call.id, content: 'ok' }
    }

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        callCount++
        if (callCount === 1) {
          const call = { id: 't1', name: 'Bash', input: { command: 'echo ok' } }
          const toolResult = await args.executeTool(call as any)
          return {
            assistantBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo ok' } }],
            stopReason: 'tool_use',
            toolResults: [toolResult],
          }
        }

        secondCallMessages = args.messages
        return {
          assistantBlocks: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const engine = createChatEngine({ client, executor, hooks })
    const out = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    expect(callCount).toBe(2)
    expect(secondCallMessages).not.toBeNull()

    const injectedUserMsg = secondCallMessages!.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        (m.content as any[]).some((b) => b?.type === 'tool_result' && b?.tool_use_id === 't1'),
    )
    expect(injectedUserMsg).toBeTruthy()

    const blocks = (injectedUserMsg as any).content as any[]
    const idx = blocks.findIndex((b) => b?.type === 'tool_result' && b?.tool_use_id === 't1')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(blocks[idx + 1]?.type).toBe('text')
    const injected = String(blocks[idx + 1]?.text || '')
    expect(injected).toContain('<system-reminder>')
    expect(injected).toContain('PostToolUse:Bash hook blocking error from command:')
    expect(injected).toContain('echo bad')
    expect(injected).toContain('HOOK_BLOCKED')

    const outJson = JSON.stringify(out)
    expect(outJson).not.toContain('HOOK_BLOCKED')
  })

  it('injects UserPromptSubmit additionalContext as a text block after the user prompt (and does not persist it)', async () => {
    let firstCallMessages: PromptMessage[] | null = null

    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
      runUserPromptSubmit: async () => ({
        runs: [
          {
            command: 'echo hook',
            exitCode: 0,
            signal: null,
            stdout: '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"CTX_FROM_HOOK"}}',
            stderr: '',
            durationMs: 1,
            timedOut: false,
            parsedJson: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'CTX_FROM_HOOK' } },
          },
        ],
        additionalContext: ['CTX_FROM_HOOK'],
        blocked: false,
      }),
      runSessionStart: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runPostToolUse: async () => ({ runs: [], additionalContext: [], blockingErrors: [] }),
    }

    const executor: ToolExecutor = async () => {
      throw new Error('executor should not be called by ChatEngine')
    }

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        firstCallMessages = args.messages
        return {
          assistantBlocks: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const engine = createChatEngine({ client, executor, hooks })
    const out = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    expect(firstCallMessages).not.toBeNull()
    const last = firstCallMessages![firstCallMessages!.length - 1]
    expect(last.role).toBe('user')
    const blocks = last.content as any[]
    expect(blocks[0]?.type).toBe('text')
    expect(blocks[1]?.type).toBe('text')
    expect(String(blocks[1]?.text || '')).toContain('<system-reminder>')
    expect(String(blocks[1]?.text || '')).toContain('UserPromptSubmit hook additional context:')
    expect(String(blocks[1]?.text || '')).toContain('CTX_FROM_HOOK')

    const outJson = JSON.stringify(out)
    expect(outJson).not.toContain('UserPromptSubmit hook additional context:')
    expect(outJson).not.toContain('CTX_FROM_HOOK')
  })

  it('injects SessionStart additionalContext once, as a text block after the initial user prompt (and does not persist it)', async () => {
    const seenMessages: PromptMessage[][] = []

    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
      runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runSessionStart: async () => ({
        runs: [
          {
            command: 'echo hook',
            exitCode: 0,
            signal: null,
            stdout: '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"CTX_SESSION"}}',
            stderr: '',
            durationMs: 1,
            timedOut: false,
            parsedJson: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'CTX_SESSION' } },
          },
        ],
        additionalContext: ['CTX_SESSION'],
        blocked: false,
      }),
      runPostToolUse: async () => ({ runs: [], additionalContext: [], blockingErrors: [] }),
    }

    const executor: ToolExecutor = async () => {
      throw new Error('executor should not be called by ChatEngine')
    }

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        seenMessages.push(args.messages)
        return {
          assistantBlocks: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const engine = createChatEngine({ client, executor, hooks })

    const out1 = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go-1' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    const out2 = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go-2' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    expect(seenMessages).toHaveLength(2)

    const firstLast = seenMessages[0]![seenMessages[0]!.length - 1]!
    expect(firstLast.role).toBe('user')
    const firstBlocks = firstLast.content as any[]
    expect(firstBlocks[0]?.type).toBe('text')
    expect(firstBlocks[1]?.type).toBe('text')
    expect(String(firstBlocks[1]?.text || '')).toContain('SessionStart hook additional context:')
    expect(String(firstBlocks[1]?.text || '')).toContain('CTX_SESSION')

    const secondLast = seenMessages[1]![seenMessages[1]!.length - 1]!
    expect(secondLast.role).toBe('user')
    const secondBlocks = secondLast.content as any[]
    expect(secondBlocks[0]?.type).toBe('text')
    expect(secondBlocks.length).toBe(1)

    expect(JSON.stringify(out1)).not.toContain('SessionStart hook additional context:')
    expect(JSON.stringify(out2)).not.toContain('SessionStart hook additional context:')
  })
})
