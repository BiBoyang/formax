import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createChatEngine } from './engine'
import type { PromptMessage } from '../prompts'
import type { ToolExecutor } from '../tools/executor'
import type { LlmStreamClient, LlmStreamOnceArgs, StreamEvent, StreamTurnResult } from '../streaming/types'
import { resolveTodosPath } from '../tools/runtime/todosFile'
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

  it('injects todo_stale reminder as an ephemeral system block after threshold', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-engine-'))
    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevConfigDir = process.env.FORMAX_CONFIG_DIR
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID

    try {
      if (prevTodosPath !== undefined) delete process.env.FORMAX_TODOS_PATH
      process.env.FORMAX_CONFIG_DIR = dir
      process.env.FORMAX_TODOS_SESSION_ID = 'test-session'

      const todosPath = resolveTodosPath(dir)
      await fsp.mkdir(path.dirname(todosPath), { recursive: true })
      await fsp.writeFile(
        todosPath,
        JSON.stringify(
          {
            todos: [
              { content: 'Task A', status: 'completed', activeForm: 'Doing A' },
              { content: 'Task B', status: 'in_progress', activeForm: 'Doing B' },
            ],
          },
          null,
          2,
        ),
        'utf8',
      )

      let callCount = 0
      let secondCallMessages: PromptMessage[] | null = null
      let secondCallSystem: any[] | null = null

      const client: LlmStreamClient = {
        async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
          callCount++

          if (callCount === 1) {
            return {
              assistantBlocks: [
                { type: 'tool_use', id: 'todo', name: 'TodoWrite', input: { todos: [] } },
                { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm run typecheck' } },
                { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm run build' } },
                { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'node dist/cli/index.js --help' } },
              ],
              stopReason: 'tool_use',
              toolResults: [
                { tool_use_id: 'todo', content: 'ok' },
                { tool_use_id: 't1', content: 'typecheck ok' },
                { tool_use_id: 't2', content: 'build ok' },
                { tool_use_id: 't3', content: 'Usage: bilibili2str [options] <url>' },
              ],
            }
          }

          secondCallMessages = args.messages
          secondCallSystem = args.system
          return { assistantBlocks: [{ type: 'text', text: 'done' }], stopReason: 'end_turn', toolResults: [] }
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
        cwd: dir,
      })

      expect(callCount).toBe(2)
      expect(secondCallMessages).not.toBeNull()
      expect(secondCallSystem).not.toBeNull()

      const last = secondCallMessages![secondCallMessages!.length - 1]!
      expect(last.role).toBe('user')
      const tr = Array.isArray(last.content) ? (last.content[0] as any) : null
      expect(tr?.type).toBe('tool_result')
      expect(String(tr?.content || '')).not.toContain('<system-reminder>')

      const reminder = secondCallSystem!.find((b: any) => b?.type === 'text' && String(b?.text || '').includes('<system-reminder>'))
      expect(reminder).toBeTruthy()
      expect(reminder.cache_control).toEqual({ type: 'ephemeral' })
      expect(String(reminder.text || '')).toContain("The TodoWrite tool hasn't been used recently")
      expect(String(reminder.text || '')).toContain('Here are the existing contents of your todo list:')
      expect(String(reminder.text || '')).toContain('[1. [completed] Task A')
    } finally {
      if (prevTodosPath === undefined) delete process.env.FORMAX_TODOS_PATH
      else process.env.FORMAX_TODOS_PATH = prevTodosPath
      if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = prevConfigDir
      if (prevTodosSessionId === undefined) delete process.env.FORMAX_TODOS_SESSION_ID
      else process.env.FORMAX_TODOS_SESSION_ID = prevTodosSessionId
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('injects PostToolUse.additionalContext as a text block after tool_result (and does not persist it)', async () => {
    let callCount = 0
    let secondCallMessages: PromptMessage[] | null = null
    const auditEvents: AuditEventV1[] = []

    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
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
  })

  it('injects PostToolUse blocking errors as a system-reminder text block after tool_result', async () => {
    let callCount = 0
    let secondCallMessages: PromptMessage[] | null = null

    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
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
})
