import { describe, expect, it } from 'vitest'
import { createChatEngine } from './engine'
import type { PromptMessage } from '../prompts'
import type { ToolExecutor } from '../tools/executor'
import type { LlmStreamClient, LlmStreamOnceArgs, StreamEvent, StreamTurnResult } from '../streaming/types'
import type { HooksRuntime } from '../hooks/runtime'
import type { AuditEventV1 } from '../core/audit/schema.js'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createToolSearchToolHandler } from '../tools/modules/toolSearch/handler'
import { getDeferredToolExposureStore } from '../tools/runtime/deferredToolExposure'
import { createToolExecutor } from '../tools/executor'
import { buildCompactBoundaryMessage } from './context/compact'

describe('ChatEngine', () => {
  it('strips compact boundary messages before sending prompt history to the client', async () => {
    let capturedMessages: PromptMessage[] = []

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        capturedMessages = args.messages as PromptMessage[]
        return {
          assistantBlocks: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const executor: ToolExecutor = async () => ({ tool_use_id: 'unused', content: 'unused' })
    const engine = createChatEngine({ client, executor })

    const out = await engine.runTurn({
      history: [
        buildCompactBoundaryMessage({
          trigger: 'manual',
          preTokens: 42,
          summaryKind: 'model_summary',
          keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 0 },
        }),
        { role: 'user', content: [{ type: 'text', text: 'summary' }] },
      ],
      user: { role: 'user', content: [{ type: 'text', text: 'continue' }] },
      system: [],
      tools: [],
      onEvent: () => undefined,
      cwd: '/tmp',
    })

    expect(capturedMessages).toHaveLength(2)
    expect(capturedMessages.some((message) => message.meta?.compactBoundary)).toBe(false)
    expect((capturedMessages[0]!.content[0] as any).text).toBe('summary')
    expect((capturedMessages[1]!.content[0] as any).text).toBe('continue')
    expect(out[0]?.meta?.compactBoundary?.schemaVersion).toBe(1)
    expect(out[0]?.meta?.compactBoundary?.trigger).toBe('manual')
    expect(out).toHaveLength(4)
  })

  it('uses only the latest compact-boundary continuation view for prompt history', async () => {
    let capturedMessages: PromptMessage[] = []

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        capturedMessages = args.messages as PromptMessage[]
        return {
          assistantBlocks: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const executor: ToolExecutor = async () => ({ tool_use_id: 'unused', content: 'unused' })
    const engine = createChatEngine({ client, executor })

    await engine.runTurn({
      history: [
        buildCompactBoundaryMessage({
          trigger: 'manual',
          preTokens: 21,
          summaryKind: 'model_summary',
          keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 1 },
        }),
        { role: 'user', content: [{ type: 'text', text: 'summary-1' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'tail-1' }] },
        buildCompactBoundaryMessage({
          trigger: 'auto',
          preTokens: 42,
          summaryKind: 'session_memory',
          keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 1 },
        }),
        { role: 'user', content: [{ type: 'text', text: 'summary-2' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'tail-2' }] },
      ],
      user: { role: 'user', content: [{ type: 'text', text: 'continue' }] },
      system: [],
      tools: [],
      onEvent: () => undefined,
      cwd: '/tmp',
    })

    expect(capturedMessages).toHaveLength(3)
    expect(capturedMessages.some((message) => message.meta?.compactBoundary)).toBe(false)
    expect((capturedMessages[0]!.content[0] as any).text).toBe('summary-2')
    expect((capturedMessages[1]!.content[0] as any).text).toBe('tail-2')
    expect((capturedMessages[2]!.content[0] as any).text).toBe('continue')
  })

  it('captures request payload and skips network when request dry-run is enabled', async () => {
    const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-request-dry-run-'))
    let streamCalls = 0

    const client: LlmStreamClient = {
      async streamOnce(): Promise<StreamTurnResult> {
        streamCalls += 1
        return {
          assistantBlocks: [{ type: 'text', text: 'should-not-run' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const executor: ToolExecutor = async () => ({ tool_use_id: 'unused', content: 'unused' })
    const events: StreamEvent[] = []
    const engine = createChatEngine({
      client,
      executor,
      runtimeFlags: {
        sessionSaveEnabled: true,
        isVitest: true,
        hooksDebugEnabled: false,
        userShellPath: null,
        deferredToolExposureEnabled: false,
        deferredToolSoftFallbackEnabled: true,
        toolSearchEngine: null,
        showInternalToolsInTui: false,
        requestDryRunEnabled: true,
        requestDryRunOutputDir: outputDir,
      },
    })

    try {
      const out = await engine.runTurn({
        history: [],
        user: { role: 'user', content: [{ type: 'text', text: 'preview this request' }] },
        system: [{ type: 'text', text: 'system-seed' }],
        tools: [{ name: 'Read', description: 'read file', input_schema: { type: 'object' } }],
        onEvent: (ev) => events.push(ev),
        cwd: '/tmp',
      })

      expect(streamCalls).toBe(0)
      expect(events.some((ev) => ev.type === 'complete')).toBe(true)
      expect(JSON.stringify(out)).toContain('[dry-run] Request payload captured')
      const dryRunDelta = events.find((ev) => ev.type === 'assistant_delta') as
        | Extract<StreamEvent, { type: 'assistant_delta' }>
        | undefined
      expect(dryRunDelta).toBeDefined()
      expect(String(dryRunDelta?.text || '')).toContain('[dry-run] Request payload captured')
      expect(String(dryRunDelta?.text || '')).toContain(outputDir)

      const files = await fsp.readdir(outputDir)
      expect(files.length).toBe(1)
      const saved = JSON.parse(await fsp.readFile(path.join(outputDir, files[0]!), 'utf8'))
      expect(saved.kind).toBe('formax_request_preview_v1')
      expect(saved.system[0].text).toBe('system-seed')
      expect(saved.messages[0].role).toBe('user')
      expect(saved.messages[0].content[0].text).toBe('preview this request')
      expect(saved.tools.map((tool: any) => tool.name)).toEqual(['Read'])
    } finally {
      await fsp.rm(outputDir, { recursive: true, force: true })
    }
  })

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

  it('supports deferred tool chain: pwd -> ToolSearch(select:Bash) -> Bash', async () => {
    const sessionKey = 'engine-deferred-pwd-chain'
    const store = getDeferredToolExposureStore()
    store.resetSession(sessionKey)
    store.registerCatalog({
      sessionKey,
      tools: [{ name: 'Bash', description: 'Execute shell command', input_schema: { type: 'object' } }],
    })

    const toolSearch = createToolSearchToolHandler()
    const toolsSeenByCall: string[][] = []
    let streamCount = 0

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        toolsSeenByCall.push((args.tools || []).map((tool) => tool.name))
        streamCount += 1

        if (streamCount === 1) {
          const toolCall = {
            id: 'tool-search-1',
            name: 'ToolSearch',
            input: { query: 'select:Bash' },
          }
          const toolResult = await args.executeTool(toolCall)
          return {
            assistantBlocks: [
              { type: 'tool_use', id: toolCall.id, name: toolCall.name, input: toolCall.input },
            ],
            stopReason: 'tool_use',
            toolResults: [toolResult],
          }
        }

        if (streamCount === 2) {
          const toolCall = {
            id: 'bash-1',
            name: 'Bash',
            input: { command: 'pwd' },
          }
          const toolResult = await args.executeTool(toolCall)
          return {
            assistantBlocks: [
              { type: 'tool_use', id: toolCall.id, name: toolCall.name, input: toolCall.input },
            ],
            stopReason: 'tool_use',
            toolResults: [toolResult],
          }
        }

        return {
          assistantBlocks: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const executedToolNames: string[] = []
    const executor: ToolExecutor = async (call, ctx) => {
      executedToolNames.push(call.name)
      if (call.name === 'ToolSearch') {
        return await toolSearch.execute(call, {
          ...ctx,
          cwd: '/repo',
          agentDepth: 0,
          toolExposureSessionKey: sessionKey,
        })
      }
      if (call.name === 'Bash') {
        return { tool_use_id: call.id, content: '/repo\n' }
      }
      return { tool_use_id: call.id, content: `Error: unsupported tool ${call.name}`, is_error: true }
    }

    const engine = createChatEngine({ client, executor })
    const history = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'pwd' }] },
      system: [],
      tools: store.resolveToolsForModel(sessionKey),
      resolveToolsForCall: () => store.resolveToolsForModel(sessionKey),
      onEvent: (_event) => undefined,
      cwd: '/repo',
      exec: {
        toolExposureSessionKey: sessionKey,
      },
    })

    expect(executedToolNames).toEqual(['ToolSearch', 'Bash'])
    expect(toolsSeenByCall).toEqual([
      ['ToolSearch'],
      ['ToolSearch', 'Bash'],
      ['ToolSearch', 'Bash'],
    ])
    expect(store.resolveToolsForModel(sessionKey).find((tool) => tool.name === 'Bash')?.defer_loading).toBe(true)

    const toolResultCarrier = history.find(
      (message) =>
        message.role === 'user' &&
        message.content.some((block: any) => block?.type === 'tool_result' && block?.tool_use_id === 'tool-search-1'),
    )
    const toolResultBlock = (toolResultCarrier?.content || []).find(
      (block: any) => block?.type === 'tool_result' && block?.tool_use_id === 'tool-search-1',
    ) as any
    expect(Array.isArray(toolResultBlock?.content)).toBe(true)
    expect(
      (toolResultBlock?.content as any[]).some(
        (block) => block?.type === 'tool_reference' && (block?.tool_name === 'Bash' || block?.name === 'Bash'),
      ),
    ).toBe(true)
  })

  it('soft-fallback executes direct deferred tool call without explicit ToolSearch call', async () => {
    const sessionKey = 'engine-deferred-soft-fallback'
    const store = getDeferredToolExposureStore()
    store.resetSession(sessionKey)
    store.registerCatalog({
      sessionKey,
      tools: [{ name: 'Bash', description: 'Execute shell command', input_schema: { type: 'object' } }],
    })

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        const toolResult = await args.executeTool({
          id: 'bash-direct-1',
          name: 'Bash',
          input: { command: 'pwd' },
        } as any)
        return {
          assistantBlocks: [{ type: 'tool_use', id: 'bash-direct-1', name: 'Bash', input: { command: 'pwd' } }],
          stopReason: 'tool_use',
          toolResults: [toolResult],
        }
      },
    }

    let calls = 0
    const terminalClient: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        calls++
        if (calls === 1) return client.streamOnce(args)
        return {
          assistantBlocks: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const executor = createToolExecutor([
      {
        canHandle: (name) => name === 'Bash',
        execute: async (call) => ({ tool_use_id: call.id, content: '/repo\n' }),
      },
    ])

    const engine = createChatEngine({
      client: terminalClient,
      executor,
      runtimeFlags: {
        sessionSaveEnabled: true,
        isVitest: true,
        hooksDebugEnabled: false,
        userShellPath: null,
        deferredToolExposureEnabled: true,
        deferredToolSoftFallbackEnabled: true,
        toolSearchEngine: 'bm25',
        showInternalToolsInTui: false,
        requestDryRunEnabled: false,
        requestDryRunOutputDir: null,
      },
    })

    const history = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'pwd' }] },
      system: [],
      tools: store.resolveToolsForModel(sessionKey),
      resolveToolsForCall: () => store.resolveToolsForModel(sessionKey),
      onEvent: () => undefined,
      cwd: '/repo',
      exec: {
        toolExposureSessionKey: sessionKey,
      },
    })

    const toolResultCarrier = history.find(
      (message) =>
        message.role === 'user' &&
        message.content.some((block: any) => block?.type === 'tool_result' && block?.tool_use_id === 'bash-direct-1'),
    )
    const toolResult = (toolResultCarrier?.content || []).find(
      (block: any) => block?.type === 'tool_result' && block?.tool_use_id === 'bash-direct-1',
    ) as any
    expect(toolResult?.is_error).not.toBe(true)
    expect(String(toolResult?.content || '')).toContain('/repo')
    expect(store.resolveToolsForModel(sessionKey).map((tool) => tool.name)).toEqual(['ToolSearch', 'Bash'])
  })

  it('appends ToolResult.extraTextBlocks as text blocks after tool_result', async () => {
    let callCount = 0
    let secondCallMessages: PromptMessage[] | null = null

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        callCount++
        if (callCount === 1) {
          return {
            assistantBlocks: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'frontend-design' } }],
            stopReason: 'tool_use',
            toolResults: [
              {
                tool_use_id: 't1',
                content: 'Launching skill: frontend-design',
                extraTextBlocks: ['Base directory for this skill: /tmp/skill\n\n(skill body)'],
              },
            ],
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
    expect(blocks[idx]?.content).toBe('Launching skill: frontend-design')
    expect(blocks[idx + 1]?.type).toBe('text')
    expect(String(blocks[idx + 1]?.text || '')).toContain('Base directory for this skill: /tmp/skill')
    expect(String(blocks[idx + 1]?.text || '')).toContain('(skill body)')
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
      runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
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
      return {
        tool_use_id: call.id,
        content: 'ok',
        is_error: true,
        extraTextBlocks: ['tool-extra'],
      }
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
      exec: { trace: { sessionHint: 'trace-on' } as any },
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
    expect(blocks[idx]?.is_error).toBe(true)
    expect(blocks.some((b) => b?.type === 'text' && String(b.text || '').includes('tool-extra'))).toBe(true)
    const hookBlock = blocks.find((b) => b?.type === 'text' && String(b.text || '').includes('PostToolUse:Bash hook additional context:'))
    expect(String(hookBlock?.text || '')).toContain('<system-reminder>')
    expect(String(hookBlock?.text || '')).toContain('CTX_FROM_HOOK')

    const outJson = JSON.stringify(out)
    expect(outJson).not.toContain('PostToolUse:Bash hook additional context:')
    expect(outJson).not.toContain('CTX_FROM_HOOK')

    const hookRuns = auditEvents.filter((e) => e.kind === 'hook.run') as any[]
    expect(hookRuns).toHaveLength(1)
    expect(hookRuns[0].hook.eventName).toBe('PostToolUse')
    expect(hookRuns[0].hook.command).toBe('echo hook')
    expect(hookRuns[0].hook.status).toBe('ok')
    expect(hookRuns[0].hook.parsedJson).toBe(true)
    expect(hookRuns[0].trace?.sessionHint).toBe('trace-on')
    expect(hookRuns[0].hook.stdoutPreview).toBeUndefined()
  })

  it('injects PostToolUse blocking errors as a system-reminder text block after tool_result', async () => {
    let callCount = 0
    let secondCallMessages: PromptMessage[] | null = null

    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
      runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runSessionStart: async () => ({
        runs: [
          {
            command: 'echo session-start',
            exitCode: 0,
            signal: null,
            stdout: '',
            stderr: '',
            durationMs: 1,
            timedOut: false,
            parsedJson: null,
          },
        ],
        additionalContext: [],
        blocked: false,
      }),
      runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
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
      runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
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

  it('injects SessionStart additionalContext once per session (and does not persist it)', async () => {
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
      runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
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

    engine.beginNewSession?.()
    const out3 = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go-3' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    expect(seenMessages).toHaveLength(3)

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

    const thirdLast = seenMessages[2]![seenMessages[2]!.length - 1]!
    expect(thirdLast.role).toBe('user')
    const thirdBlocks = thirdLast.content as any[]
    expect(thirdBlocks[0]?.type).toBe('text')
    expect(thirdBlocks[1]?.type).toBe('text')
    expect(String(thirdBlocks[1]?.text || '')).toContain('SessionStart hook additional context:')
    expect(String(thirdBlocks[1]?.text || '')).toContain('CTX_SESSION')

    expect(JSON.stringify(out1)).not.toContain('SessionStart hook additional context:')
    expect(JSON.stringify(out2)).not.toContain('SessionStart hook additional context:')
    expect(JSON.stringify(out3)).not.toContain('SessionStart hook additional context:')
  })

  it('injects Stop additionalContext on the next turn (and does not persist it)', async () => {
    const seenMessages: PromptMessage[][] = []

    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
      runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runSessionStart: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runStop: async () => ({
        runs: [
          {
            command: 'echo stop',
            exitCode: 0,
            signal: null,
            stdout: '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"CTX_STOP"}}',
            stderr: '',
            durationMs: 1,
            timedOut: false,
            parsedJson: { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'CTX_STOP' } },
          },
        ],
        additionalContext: ['CTX_STOP'],
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
      history: out1,
      user: { role: 'user', content: [{ type: 'text', text: 'go-2' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    expect(seenMessages).toHaveLength(2)

    const firstLast = seenMessages[0]![seenMessages[0]!.length - 1]!
    expect(firstLast.role).toBe('user')
    expect(JSON.stringify(firstLast.content)).not.toContain('Stop hook additional context:')

    const secondLast = seenMessages[1]![seenMessages[1]!.length - 1]!
    expect(secondLast.role).toBe('user')
    const secondBlocks = secondLast.content as any[]
    expect(secondBlocks[0]?.type).toBe('text')
    expect(secondBlocks[1]?.type).toBe('text')
    expect(String(secondBlocks[1]?.text || '')).toContain('<system-reminder>')
    expect(String(secondBlocks[1]?.text || '')).toContain('Stop hook additional context:')
    expect(String(secondBlocks[1]?.text || '')).toContain('CTX_STOP')

    const outJson = JSON.stringify(out2)
    expect(outJson).not.toContain('Stop hook additional context:')
    expect(outJson).not.toContain('CTX_STOP')
  })

  it('supports long tool-only loops until the model returns end_turn', async () => {
    let callCount = 0
    const maxToolCalls = 250

    const client: LlmStreamClient = {
      async streamOnce(_args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        callCount++
        if (callCount <= maxToolCalls) {
          return {
            assistantBlocks: [{ type: 'tool_use', id: `t${callCount}`, name: 'Read', input: { file_path: '/tmp/a' } }],
            stopReason: 'tool_use',
            toolResults: [{ tool_use_id: `t${callCount}`, content: 'ok' }],
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

    const engine = createChatEngine({ client, executor })
    const out = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    expect(callCount).toBe(maxToolCalls + 1)
    expect(out[out.length - 1]?.role).toBe('assistant')
  })

  it('throws when stream returns tool_use without tool_results and emits error event', async () => {
    const events: StreamEvent[] = []
    const client: LlmStreamClient = {
      async streamOnce(): Promise<StreamTurnResult> {
        return {
          assistantBlocks: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/tmp/a' } }],
          stopReason: 'tool_use',
          toolResults: [],
        }
      },
    }
    const executor: ToolExecutor = async () => ({ tool_use_id: 't1', content: 'unused' })
    const engine = createChatEngine({ client, executor })

    await expect(
      engine.runTurn({
        history: [],
        user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
        system: [],
        tools: [],
        onEvent: (ev) => events.push(ev),
        cwd: '/tmp',
      }),
    ).rejects.toThrow(/Tool loop produced no tool_results/)

    const errorEvent = events.find((event) => event.type === 'error') as any
    expect(errorEvent?.error).toBeInstanceOf(Error)
    expect(String(errorEvent?.error?.message || '')).toContain('Tool loop produced no tool_results')
  })

  it('wraps non-Error throwables from stream client into Error for onEvent', async () => {
    const events: StreamEvent[] = []
    const client: LlmStreamClient = {
      async streamOnce(): Promise<StreamTurnResult> {
        throw 'stream failed'
      },
    }
    const executor: ToolExecutor = async () => ({ tool_use_id: 't1', content: 'unused' })
    const engine = createChatEngine({ client, executor })

    await expect(
      engine.runTurn({
        history: [],
        user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
        system: [],
        tools: [],
        onEvent: (ev) => events.push(ev),
        cwd: '/tmp',
      }),
    ).rejects.toThrow('stream failed')

    const errorEvent = events.find((event) => event.type === 'error') as any
    expect(errorEvent?.error).toBeInstanceOf(Error)
    expect(errorEvent?.error?.message).toBe('stream failed')
  })

  it('does not run UserPromptSubmit for non-user input and does not inject extras onto non-user last message', async () => {
    let firstCallMessages: PromptMessage[] | null = null
    let userPromptCalls = 0

    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
      runUserPromptSubmit: async () => {
        userPromptCalls += 1
        return { runs: [], additionalContext: ['CTX_USER_PROMPT'], blocked: false }
      },
      runSessionStart: async () => ({ runs: [], additionalContext: ['CTX_SESSION'], blocked: false }),
      runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runPostToolUse: async () => ({ runs: [], additionalContext: [], blockingErrors: [] }),
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
    const executor: ToolExecutor = async () => ({ tool_use_id: 'unused', content: 'unused' })

    const engine = createChatEngine({ client, executor, hooks })
    await engine.runTurn({
      history: [],
      user: { role: 'assistant', content: [{ type: 'text', text: 'not-a-user-prompt' }] } as any,
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    expect(userPromptCalls).toBe(0)
    expect(firstCallMessages).not.toBeNull()
    const last = firstCallMessages![firstCallMessages!.length - 1] as any
    expect(last.role).toBe('assistant')
    expect(JSON.stringify(last.content)).not.toContain('CTX_SESSION')
  })

  it('injects post-tool text only for matching tool_result ids and ignores empty blocking stderr', async () => {
    let callCount = 0
    let secondCallMessages: PromptMessage[] | null = null

    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
      runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runSessionStart: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runPostToolUse: async (args: any) => ({
        runs: [],
        additionalContext: args.toolUseId === 't1' ? ['CTX_T1'] : [],
        blockingErrors: [{ command: 'echo ignored', stderr: '', stdout: '', exitCode: 1, signal: null, durationMs: 1, timedOut: false, parsedJson: null }],
      }),
    }
    const executor: ToolExecutor = async (call) => ({ tool_use_id: call.id, content: `ok-${call.id}` })
    const events: StreamEvent[] = []

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        callCount += 1
        if (callCount === 1) {
          const toolResult1 = await args.executeTool({ id: 't1', name: 'Bash', input: undefined } as any)
          return {
            assistantBlocks: [
              { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo 1' } },
              { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/tmp/x' } },
            ],
            stopReason: 'tool_use',
            toolResults: [toolResult1, { tool_use_id: 't2', content: 'ok-t2' }],
          }
        }
        secondCallMessages = args.messages
        return { assistantBlocks: [{ type: 'text', text: 'done' }], stopReason: 'end_turn', toolResults: [] }
      },
    }

    const engine = createChatEngine({ client, executor, hooks })
    await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [],
      onEvent: (ev) => events.push(ev),
      cwd: '/tmp',
    })

    expect(secondCallMessages).not.toBeNull()
    const msg = secondCallMessages!.find(
      (m) => m.role === 'user' && Array.isArray(m.content) && (m.content as any[]).some((b) => b?.type === 'tool_result'),
    ) as any
    const blocks = msg.content as any[]
    const t1Index = blocks.findIndex((b: any) => b?.type === 'tool_result' && b?.tool_use_id === 't1')
    const t2Index = blocks.findIndex((b: any) => b?.type === 'tool_result' && b?.tool_use_id === 't2')
    expect(String(blocks[t1Index + 1]?.text || '')).toContain('CTX_T1')
    expect(String(blocks[t2Index + 1]?.text || '')).not.toContain('CTX_T1')
    expect(events.some((ev) => ev.type === 'tool_update')).toBe(true)
  })

  it('does not inject pre-call extras onto tool_result-only user messages', async () => {
    let firstCallMessages: PromptMessage[] | null = null
    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
      runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runSessionStart: async () => ({ runs: [], additionalContext: ['CTX_SESSION'], blocked: false }),
      runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runPostToolUse: async () => ({ runs: [], additionalContext: [], blockingErrors: [] }),
    }
    const executor: ToolExecutor = async () => ({ tool_use_id: 'unused', content: 'unused' })
    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        firstCallMessages = args.messages
        return { assistantBlocks: [{ type: 'text', text: 'done' }], stopReason: 'end_turn', toolResults: [] }
      },
    }

    const engine = createChatEngine({ client, executor, hooks })
    await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'res' }] } as any,
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    const last = firstCallMessages![firstCallMessages!.length - 1] as any
    expect(last.role).toBe('user')
    expect(last.content).toHaveLength(1)
    expect(last.content[0]?.type).toBe('tool_result')
  })

  it('treats non-object assistant blocks as non-tool-use blocks', async () => {
    const client: LlmStreamClient = {
      async streamOnce(): Promise<StreamTurnResult> {
        return {
          assistantBlocks: [null as any],
          stopReason: 'tool_use',
          toolResults: [{ tool_use_id: 'ignored', content: 'ignored' }],
        }
      },
    }
    const executor: ToolExecutor = async () => ({ tool_use_id: 'unused', content: 'unused' })
    const engine = createChatEngine({ client, executor })
    const out = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })
    expect(out[out.length - 1]?.role).toBe('assistant')
  })

  it('executes tools without hooks configured', async () => {
    let callCount = 0
    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        callCount += 1
        if (callCount === 1) {
          const toolResult = await args.executeTool({ id: 't1', name: 'Bash', input: { command: 'pwd' } } as any)
          return {
            assistantBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd' } }],
            stopReason: 'tool_use',
            toolResults: [toolResult],
          }
        }
        return { assistantBlocks: [{ type: 'text', text: 'done' }], stopReason: 'end_turn', toolResults: [] }
      },
    }
    const executor: ToolExecutor = async (call) => ({ tool_use_id: call.id, content: 'ok-no-hooks' })
    const engine = createChatEngine({ client, executor })

    const out = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })
    expect(out.some((m) => m.role === 'user' && JSON.stringify(m.content).includes('ok-no-hooks'))).toBe(true)
  })

  it('does not enqueue post-tool text when hook returns no additional context or blocking errors', async () => {
    let secondCallMessages: PromptMessage[] | null = null
    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
      runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runSessionStart: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runPostToolUse: async () => ({ runs: [], additionalContext: [], blockingErrors: [] }),
    }
    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        if (!secondCallMessages) {
          const toolResult = await args.executeTool({ id: 't1', name: 'Bash', input: { command: 'pwd' } } as any)
          secondCallMessages = [] as any
          return {
            assistantBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd' } }],
            stopReason: 'tool_use',
            toolResults: [toolResult],
          }
        }
        secondCallMessages = args.messages
        return { assistantBlocks: [{ type: 'text', text: 'done' }], stopReason: 'end_turn', toolResults: [] }
      },
    }
    const executor: ToolExecutor = async (call) => ({ tool_use_id: call.id, content: 'ok' })
    const engine = createChatEngine({ client, executor, hooks })

    await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    expect(JSON.stringify(secondCallMessages)).not.toContain('PostToolUse:')
  })

  it('handles malformed historical tool_result blocks without tool_use_id', async () => {
    let secondCallMessages: PromptMessage[] | null = null
    const hooks: HooksRuntime = {
      runPreToolUse: async () => ({ runs: [], blocked: false }),
      runPermissionRequest: async () => ({ runs: [], blocked: false }),
      runUserPromptSubmit: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runSessionStart: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runStop: async () => ({ runs: [], additionalContext: [], blocked: false }),
      runPostToolUse: async () => ({ runs: [], additionalContext: ['CTX'], blockingErrors: [] }),
    }
    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        if (!secondCallMessages) {
          const toolResult = await args.executeTool({ id: 't1', name: 'Bash', input: { command: 'pwd' } } as any)
          secondCallMessages = [] as any
          return {
            assistantBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd' } }],
            stopReason: 'tool_use',
            toolResults: [toolResult],
          }
        }
        secondCallMessages = args.messages
        return { assistantBlocks: [{ type: 'text', text: 'done' }], stopReason: 'end_turn', toolResults: [] }
      },
    }
    const executor: ToolExecutor = async (call) => ({ tool_use_id: call.id, content: 'ok' })
    const engine = createChatEngine({ client, executor, hooks })

    await engine.runTurn({
      history: [
        {
          role: 'user',
          content: [{ type: 'tool_result', content: 'legacy-missing-id' } as any],
        } as any,
      ],
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    expect(JSON.stringify(secondCallMessages)).toContain('legacy-missing-id')
  })

  it('passes per-iteration exposed tools as allowTools to executor', async () => {
    let callCount = 0
    const seenAllowLists: Array<string[] | undefined> = []

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        callCount += 1
        if (callCount === 1) {
          const result = await args.executeTool({ id: 't1', name: 'Bash', input: { command: 'pwd' } } as any)
          return {
            assistantBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd' } }],
            stopReason: 'tool_use',
            toolResults: [result],
          }
        }
        return {
          assistantBlocks: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const executor: ToolExecutor = async (call, ctx) => {
      seenAllowLists.push(ctx.allowTools ? [...ctx.allowTools] : undefined)
      const allowed = ctx.allowTools?.includes(call.name) === true
      return {
        tool_use_id: call.id,
        content: allowed ? 'ok' : `Error: Tool not allowed: ${call.name}`,
        ...(allowed ? {} : { is_error: true }),
      }
    }

    const engine = createChatEngine({ client, executor })
    const out = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [
        { name: 'ToolSearch', description: 'search', input_schema: {} },
        { name: 'Bash', description: 'bash', input_schema: {} },
      ],
      resolveToolsForCall: () => [{ name: 'ToolSearch', description: 'search', input_schema: {} }],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
    })

    expect(seenAllowLists[0]).toEqual(['ToolSearch'])
    expect(JSON.stringify(out)).toContain('Tool not allowed: Bash')
  })

  it('preserves explicit empty allowTools as deny-all', async () => {
    let callCount = 0
    const seenAllowLists: Array<string[] | undefined> = []

    const client: LlmStreamClient = {
      async streamOnce(args: LlmStreamOnceArgs): Promise<StreamTurnResult> {
        callCount += 1
        if (callCount === 1) {
          const result = await args.executeTool({ id: 't1', name: 'Bash', input: { command: 'pwd' } } as any)
          return {
            assistantBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd' } }],
            stopReason: 'tool_use',
            toolResults: [result],
          }
        }
        return {
          assistantBlocks: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          toolResults: [],
        }
      },
    }

    const executor: ToolExecutor = async (call, ctx) => {
      seenAllowLists.push(ctx.allowTools ? [...ctx.allowTools] : undefined)
      const allowed = ctx.allowTools?.includes(call.name) === true
      return {
        tool_use_id: call.id,
        content: allowed ? 'ok' : `Error: Tool not allowed: ${call.name}`,
        ...(allowed ? {} : { is_error: true }),
      }
    }

    const engine = createChatEngine({ client, executor })
    const out = await engine.runTurn({
      history: [],
      user: { role: 'user', content: [{ type: 'text', text: 'go' }] },
      system: [],
      tools: [{ name: 'Bash', description: 'bash', input_schema: {} }],
      onEvent: (_ev: StreamEvent) => undefined,
      cwd: '/tmp',
      exec: {
        allowTools: [],
      },
    })

    expect(seenAllowLists[0]).toEqual([])
    expect(JSON.stringify(out)).toContain('Tool not allowed: Bash')
  })

})
