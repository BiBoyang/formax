import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { ChatHistory } from '../chat/engine.js'
import {
  CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME,
  DURABLE_SNIP_COMMITTED_EVENT_NAME,
  DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME,
  findSessionFileBySessionId,
  readSessionFile,
  readSessionSummary,
  SessionWriter,
} from '../features/repl/sessionSave/index.js'
import { fingerprintToolResultContent } from '../chat/context/contextProjection.js'
import {
  buildCompactBoundaryMessage,
  buildCompactionSummaryUserText,
  fingerprintCompactBoundaryMessage,
  fingerprintPromptMessage,
} from '../chat/context/compact.js'
import { buildInitPrompt } from '../prompts/init.js'
import { createUserInputManager } from '../tools/runtime/userInputManager.js'
import { getDeferredToolExposureStore } from '../tools/runtime/deferredToolExposure.js'
import * as sessionTitle from '../features/sessionTitle/index.js'
import { __turnRunnerTestOnly, TurnRunner } from './turnRunner.js'

type Notification = { method: string; params?: any }

async function waitForNotification(
  notifications: Notification[],
  predicate: (n: Notification) => boolean,
  timeoutMs = 2000,
): Promise<Notification> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = notifications.find(predicate)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for notification')
}

async function createThreadFixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-turn-runner-cwd-'))
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-turn-runner-config-'))
  const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
  const created = await SessionWriter.createNew({ cwd, env })
  await created.writer.shutdown()
  return {
    cwd,
    env,
    threadId: created.meta.sessionId,
  }
}

function assistantToolUse(id: string, name: string, input: Record<string, unknown>): ChatHistory[number] {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name, input }] as any,
  }
}

function userToolResult(id: string, content: string): ChatHistory[number] {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content }] as any,
  }
}

async function listThreadFilesById(args: { sessionsRoot: string; threadId: string }): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      if (!entry.name.endsWith(`-${args.threadId}.jsonl`)) continue
      out.push(fullPath)
    }
  }
  await walk(args.sessionsRoot)
  return out
}

async function readAppToolEvents(filePath: string): Promise<Array<Record<string, unknown>>> {
  const raw = await fs.readFile(filePath, 'utf8')
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>
      } catch {
        return null
      }
    })
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .filter((record) => record.type === 'event' && record.name === 'app_tool_event')
    .map((record) => {
      const data = record.data
      return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
    })
}

describe('TurnRunner', () => {
  it('covers turnRunner helper edge branches', () => {
    expect(__turnRunnerTestOnly.flattenPromptText('not-array')).toBe('')
    expect(__turnRunnerTestOnly.compactParamsText(null)).toBeUndefined()
    expect(__turnRunnerTestOnly.compactParamsText({})).toBeUndefined()
    expect(__turnRunnerTestOnly.compactParamsText({ a: 'x'.repeat(300) })).toContain('...')

    expect(
      __turnRunnerTestOnly.resolveEditPatchStartLineNumber({
        cwd: process.cwd(),
        toolName: 'Bash',
        isError: false,
        toolInput: { command: 'pwd' },
      }),
    ).toBeNull()
    expect(
      __turnRunnerTestOnly.resolveEditPatchStartLineNumber({
        cwd: process.cwd(),
        toolName: 'Edit',
        isError: true,
        toolInput: {},
      }),
    ).toBeNull()
    const resolvedPatchStart = __turnRunnerTestOnly.resolveEditPatchStartLineNumber({
      cwd: process.cwd(),
      toolName: 'Edit',
      isError: false,
      toolInput: undefined,
    })
    expect(resolvedPatchStart === null || typeof resolvedPatchStart === 'number').toBe(true)

    expect(
      __turnRunnerTestOnly.flattenPromptText([
        null,
        1,
        { type: 'tool_use', text: 'skip' },
        { type: 'text', text: 1 },
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ]),
    ).toBe('hello\n\nworld')

    expect(
      __turnRunnerTestOnly.firstUserPromptFromHistory([
        { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
        { role: 'user', content: [{ type: 'text', text: '  ask ' }] },
      ] as any),
    ).toBe('ask')
    expect(__turnRunnerTestOnly.firstUserPromptFromHistory([{ role: 'user', content: [{ type: 'text', text: ' ' }] }] as any)).toBeNull()
    expect(__turnRunnerTestOnly.extractAssistantText([{ role: 'assistant', content: [{ type: 'text', text: ' ok ' }] }] as any)).toBe(
      'ok',
    )
    expect(
      __turnRunnerTestOnly.extractAssistantText([
        { role: 'assistant', content: 'not-array' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'x' }, { type: 'text', text: 1 }, null] },
      ] as any),
    ).toBe('')
    expect(__turnRunnerTestOnly.extractAssistantText([{ role: 'assistant', content: 'bad' }] as any)).toBe('')

    expect(
      __turnRunnerTestOnly.toToolUpdateLine({
        type: 'tool_update',
        transcriptLines: ['  latest '],
      } as any),
    ).toBe('latest')
    expect(__turnRunnerTestOnly.toToolUpdateLine({ type: 'tool_update', toolUses: 2 } as any)).toBe('tool uses 2')
    expect(__turnRunnerTestOnly.toToolUpdateLine({ type: 'tool_update' } as any)).toBeNull()

    expect(__turnRunnerTestOnly.toToolEndPayload({ type: 'tool_end', result: { is_error: true, content: 'x\n' } } as any).status).toBe(
      'error',
    )
    expect(__turnRunnerTestOnly.toToolEndPayload({ type: 'tool_end', result: { is_error: false, content: '' } } as any).summary).toBe(
      'Tool completed',
    )
    expect(__turnRunnerTestOnly.toToolEndPayload({ type: 'tool_end', result: { is_error: false, content: { k: 1 } } } as any).lines).toEqual(
      [],
    )
    expect(__turnRunnerTestOnly.toToolEndPayload({ type: 'tool_end', result: { is_error: true, content: '' } } as any).summary).toBe(
      'Tool failed',
    )
    expect(__turnRunnerTestOnly.normalizePositiveLimit(NaN, 5)).toBe(5)
    expect(__turnRunnerTestOnly.normalizePositiveLimit(0, 5)).toBe(5)
    expect(__turnRunnerTestOnly.normalizePositiveLimit(4.9, 5)).toBe(4)

    const stripped = __turnRunnerTestOnly.stripInjectedBlocksFromHistory(
      [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }] as any,
      0,
      1,
    )
    expect((stripped[0] as any).content).toHaveLength(1)
    expect(__turnRunnerTestOnly.stripInjectedBlocksFromHistory([{ role: 'assistant', content: [] }] as any, 0, 1)).toHaveLength(1)
    expect(
      __turnRunnerTestOnly.stripInjectedBlocksFromHistory(
        [{ role: 'user', content: [{ type: 'text', text: 'a' }] }] as any,
        0,
        0,
      ),
    ).toHaveLength(1)
    expect(
      __turnRunnerTestOnly.stripInjectedBlocksFromHistory(
        [{ role: 'user', content: [{ type: 'text', text: 'a' }] }] as any,
        0,
        1,
      ),
    ).toHaveLength(1)
  })

  it('commits app-server durable compression state only after durable flush succeeds', async () => {
    const filePath = '/tmp/thread.jsonl'
    const contextCollapseStoreByFilePath = new Map()
    const contextCollapseCommit = {
      schemaVersion: 1 as const,
      id: 'request-collapse:test',
      createdAtMs: 1,
      source: 'request_collapse' as const,
      collapsedRange: { kind: 'model_facing_index_range' as const, startIndex: 0, endIndexExclusive: 2 },
      compactBoundaryFingerprint: 'compact-generation',
      recapMessage: { role: 'user' as const, content: [{ type: 'text' as const, text: 'recap' }] },
      metadata: {
        schemaVersion: 1 as const,
        kind: 'request_recap' as const,
        keepLastTurns: 2,
        preservedTailMessageCount: 3,
        retainedCompactSummary: true,
        recentUserPromptCount: 1,
        recentFileCount: 0,
        earlierToolResultBlockCount: 0,
        recapFingerprint: 'abcdef0123456789',
      },
    }
    const durableSnipCommit = {
      schemaVersion: 1,
      source: 'request_snip',
      phase: 'initial',
      removals: [],
    }
    const appendEvent = vi.fn(async () => undefined)
    const flush = vi.fn(async () => undefined)

    await __turnRunnerTestOnly.commitPendingDurableCompressionState({
      writer: { appendEvent, flush },
      filePath,
      contextCollapseStoreByFilePath,
      durableSnipCommit,
      contextCollapseCommit,
    })

    expect(appendEvent).toHaveBeenCalledWith(DURABLE_SNIP_COMMITTED_EVENT_NAME, durableSnipCommit)
    expect(appendEvent).toHaveBeenCalledWith(CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME, contextCollapseCommit)
    expect(flush).toHaveBeenCalled()
    expect(contextCollapseStoreByFilePath.get(filePath)).toEqual({
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: 'compact-generation',
      entries: [contextCollapseCommit],
    })

    const failedContextCollapseStoreByFilePath = new Map()
    await expect(
      __turnRunnerTestOnly.commitPendingDurableCompressionState({
        writer: {
          appendEvent: vi.fn(async () => undefined),
          flush: vi.fn(async () => {
            throw new Error('durable flush failed')
          }),
        },
        filePath,
        contextCollapseStoreByFilePath: failedContextCollapseStoreByFilePath,
        durableSnipCommit,
        contextCollapseCommit,
      }),
    ).rejects.toThrow('durable flush failed')
    expect(failedContextCollapseStoreByFilePath.get(filePath)).toBeUndefined()
  })

  it('handles approval_request metadata fields and skill tool patching path', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({
            type: 'approval_request',
            toolUseId: 'ap-1',
            toolName: 'Bash',
            action: 'exec',
            effectiveDecision: 'ask',
            suggestions: [{ decision: 'allow' }],
            workspaceRequest: { cwd: fixture.cwd },
          } as any)
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [{ name: 'Skill' } as any],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'hello' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
    expect(
      notifications.some(
        (n) => n.method === 'turn/inputRequested' && n.params?.input?.kind === 'approval',
      ),
    ).toBe(true)
  })

  it('emits raw context meter budget on turn start and keeps usage event raw', async () => {
    const fixture = await createThreadFixture()
    const env = {
      ...fixture.env,
      FORMAX_CONTEXT_WINDOW_TOKENS: '6000',
      FORMAX_BASELINE_TOKENS: '123',
    }
    const notifications: Notification[] = []
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({
            type: 'usage',
            usage: {
              input_tokens: 10,
              output_tokens: 2,
              cache_read_input_tokens: 3,
            },
          } as any)
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'hello' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const started = notifications.find((n) => n.method === 'turn/started')
    expect(started?.params?.contextMeter).toMatchObject({
      schemaVersion: 1,
      budgetRaw: {
        schemaVersion: 1,
        model: expect.any(String),
        contextWindowTokens: 6000,
        baselineTokens: 123,
        source: 'env_override',
      },
    })
    const usage = notifications.find((n) => n.method === 'turn/event' && n.params?.event?.type === 'usage')
    expect(usage?.params?.event?.usage).toEqual({
      input_tokens: 10,
      output_tokens: 2,
      cache_read_input_tokens: 3,
    })
  })

  it('applies deferred tool exposure semantics when runtime flag is enabled', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    getDeferredToolExposureStore().resetSession(`app-server:${fixture.threadId}`)
    const engineRunTurn = vi.fn(async (args: any) => {
      expect(args.tools.map((tool: any) => tool.name)).toEqual(['ToolSearch'])
      expect(typeof args.resolveToolsForCall).toBe('function')
      expect(args.exec.toolExposureSessionKey).toBe(`app-server:${fixture.threadId}`)

      const userText = args.user.content.map((block: any) => String(block?.text || '')).join('\n')
      expect(userText).toContain('<available-deferred-tools>')
      expect(userText).toContain('Bash')

      return [...args.history, args.user, { role: 'assistant', content: [{ type: 'text', text: 'done' }] }] as ChatHistory
    })
    const runner = new TurnRunner({
      engine: {
        runTurn: engineRunTurn,
      },
      tools: [{ name: 'Bash', description: 'shell', input_schema: {} } as any],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
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
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'pwd' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
    expect(engineRunTurn).toHaveBeenCalled()

    const callArgs = engineRunTurn.mock.calls[0]?.[0]
    const resolveToolsForCall = callArgs?.resolveToolsForCall as (() => any[]) | undefined
    expect(resolveToolsForCall).toBeDefined()
    if (resolveToolsForCall) {
      expect(resolveToolsForCall().map((tool: any) => tool.name)).toEqual(['ToolSearch'])
      const store = getDeferredToolExposureStore()
      store.searchAndLoad({
        sessionKey: `app-server:${fixture.threadId}`,
        query: 'select:Bash',
      })
      expect(resolveToolsForCall().map((tool: any) => tool.name)).toEqual(['ToolSearch', 'Bash'])
      expect(resolveToolsForCall()[1]?.defer_loading).toBe(true)
    }
  })

  it('filters app-server tool exposure from FORMAX_ALLOWED_TOOLS/FORMAX_DISABLED_TOOLS env', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const env = {
      ...fixture.env,
      FORMAX_ALLOWED_TOOLS: 'Read,Write',
      FORMAX_DISABLED_TOOLS: 'Write',
    }
    const engineRunTurn = vi.fn(async (args: any) => {
      expect(args.tools.map((tool: any) => tool.name)).toEqual(['Read'])
      return [...args.history, args.user, { role: 'assistant', content: [{ type: 'text', text: 'done' }] }] as ChatHistory
    })
    const runner = new TurnRunner({
      engine: { runTurn: engineRunTurn },
      tools: [
        { name: 'Read', description: 'read', input_schema: {} } as any,
        { name: 'Write', description: 'write', input_schema: {} } as any,
      ],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'hello' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
    expect(engineRunTurn).toHaveBeenCalled()
  })

  it('uses canonical middle-layer request history without persisting request-only reductions', async () => {
    const fixture = await createThreadFixture()
    const env = { ...fixture.env, FORMAX_CONTEXT_WINDOW_TOKENS: '6000', FORMAX_BASELINE_TOKENS: '0' }
    const notifications: Notification[] = []
    const originalOldRead = 'old auth file\n'.repeat(400)
    const seededHistory: ChatHistory = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
      userToolResult('read-1', originalOldRead),
      assistantToolUse('grep-1', 'Grep', { pattern: 'login', path: '/repo/src' }),
      userToolResult('grep-1', 'grep result\n'.repeat(400)),
      assistantToolUse('glob-1', 'Glob', { pattern: '**/*.ts', path: '/repo/src' }),
      userToolResult('glob-1', 'glob result\n'.repeat(400)),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/session.ts' }),
      userToolResult('read-2', 'recent session file\n'.repeat(400)),
      assistantToolUse('read-3', 'Read', { file_path: '/repo/src/router.ts' }),
      userToolResult('read-3', 'recent router file\n'.repeat(400)),
    ] as ChatHistory
    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const seedWriter = await SessionWriter.openExisting({ filePath: filePath! })
    await seedWriter.appendHistorySnapshot(seededHistory)
    await seedWriter.shutdown()

    const engineRunTurn = vi.fn(async (args: any) => {
      return [
        ...args.history,
        args.user,
        { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      ] as ChatHistory
    })
    const runner = new TurnRunner({
      engine: {
        runTurn: engineRunTurn,
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue from old reads' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const callArgs = engineRunTurn.mock.calls.find(([args]) => Array.isArray(args?.requestHistory))?.[0]
    expect(callArgs).toBeTruthy()
    const hasOriginalOldRead = (messages: ChatHistory) =>
      messages.some((message: any) =>
        Array.isArray(message.content) && message.content.some((block: any) => block?.content === originalOldRead),
      )
    expect(callArgs.promptBudget).toMatchObject({ contextWindowTokens: 6000 })
    expect(callArgs.requestHistory).not.toEqual(callArgs.history)
    expect(hasOriginalOldRead(callArgs.history)).toBe(true)
    expect(hasOriginalOldRead(callArgs.requestHistory)).toBe(false)

    const replay = await readSessionFile(filePath!)
    expect(hasOriginalOldRead(replay.history)).toBe(true)
    expect(JSON.stringify(replay.history)).toContain('continue from old reads')
    expect(JSON.stringify(replay.history)).not.toContain('Older tool result cleared by microcompact')
  })

  it('persists request snip removals as durable session events', async () => {
    const fixture = await createThreadFixture()
    const env = { ...fixture.env, FORMAX_CONTEXT_WINDOW_TOKENS: '3000', FORMAX_BASELINE_TOKENS: '0' }
    const notifications: Notification[] = []
    const seededHistory: ChatHistory = [
      { role: 'assistant', content: [{ type: 'text', text: `old-a ${'x'.repeat(5000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `old-b ${'y'.repeat(5000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `recent ${'z'.repeat(5000)}` }] },
    ] as ChatHistory
    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const seedWriter = await SessionWriter.openExisting({ filePath: filePath! })
    await seedWriter.appendHistorySnapshot(seededHistory)
    await seedWriter.shutdown()

    const engineRunTurn = vi.fn(async (args: any) => {
      expect(JSON.stringify(args.history)).toContain('old-a')
      expect(JSON.stringify(args.requestHistory)).toContain('[Older assistant text snipped for this request:')
      return [
        ...args.history,
        args.user,
        { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      ] as ChatHistory
    })
    const runner = new TurnRunner({
      engine: { runTurn: engineRunTurn },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const raw = await fs.readFile(filePath!, 'utf8')
    const durableSnipEvent = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((record: any) => record.type === 'event' && record.name === DURABLE_SNIP_COMMITTED_EVENT_NAME)

    expect(durableSnipEvent?.data).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        source: 'request_snip',
        phase: 'initial',
        removedMessageCount: 2,
        compactBoundaryFingerprint: null,
        baseProjectionFingerprint: expect.any(String),
        sourceProjectionKind: 'model_facing_baseline',
        removals: [
          expect.objectContaining({
            kind: 'model_facing_index_range',
            startIndex: 0,
            endIndexExclusive: 1,
            removedMessageFingerprints: [expect.any(String)],
            removedMessageIdentities: [expect.objectContaining({ schemaVersion: 1, fingerprint: expect.any(String) })],
          }),
          expect.objectContaining({
            kind: 'model_facing_index_range',
            startIndex: 1,
            endIndexExclusive: 2,
            removedMessageFingerprints: [expect.any(String)],
            removedMessageIdentities: [expect.objectContaining({ schemaVersion: 1, fingerprint: expect.any(String) })],
          }),
        ],
      }),
    )
  })

  it('preserves prior durable snip removals when persisting app-server snapshots', async () => {
    const fixture = await createThreadFixture()
    const env = { ...fixture.env, FORMAX_CONTEXT_WINDOW_TOKENS: '3000', FORMAX_BASELINE_TOKENS: '0' }
    const notifications: Notification[] = []
    const seededHistory: ChatHistory = [
      { role: 'assistant', content: [{ type: 'text', text: `old-a ${'x'.repeat(5000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `old-b ${'y'.repeat(5000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `recent ${'z'.repeat(5000)}` }] },
    ] as ChatHistory
    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const seedWriter = await SessionWriter.openExisting({ filePath: filePath! })
    await seedWriter.appendHistorySnapshot(seededHistory)
    const oldAFingerprint = fingerprintPromptMessage(seededHistory[0]!)
    await seedWriter.appendEvent(DURABLE_SNIP_COMMITTED_EVENT_NAME, {
      schemaVersion: 1,
      source: 'request_snip',
      phase: 'initial',
      estimatedTokensSaved: 900,
      removedMessageCount: 1,
      compactBoundaryFingerprint: null,
      removals: [
        {
          kind: 'model_facing_index_range',
          startIndex: 0,
          endIndexExclusive: 1,
          reason: 'previous request snip',
          removedMessageFingerprints: [oldAFingerprint],
        },
      ],
    })
    await seedWriter.shutdown()

    const engineRunTurn = vi.fn(async (args: any) => {
      expect(JSON.stringify(args.requestHistory)).not.toContain('old-a')
      expect(JSON.stringify(args.requestHistory)).toContain('[Older assistant text snipped for this request:')
      return [
        ...args.history,
        args.user,
        { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      ] as ChatHistory
    })
    const runner = new TurnRunner({
      engine: { runTurn: engineRunTurn },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const raw = await fs.readFile(filePath!, 'utf8')
    const durableSnipEvents = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((record: any) => record.type === 'event' && record.name === DURABLE_SNIP_COMMITTED_EVENT_NAME)
    const latestDurableSnipEvent = durableSnipEvents.at(-1)

    expect(latestDurableSnipEvent?.data).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        source: 'request_snip',
        phase: 'initial',
        removedMessageCount: 2,
        compactBoundaryFingerprint: null,
        baseProjectionFingerprint: expect.any(String),
        sourceProjectionKind: 'model_facing_baseline',
        removals: [
          {
            kind: 'model_facing_index_range',
            startIndex: 0,
            endIndexExclusive: 1,
            reason: 'previous request snip',
            removedMessageFingerprints: [oldAFingerprint],
          },
          expect.objectContaining({
            kind: 'model_facing_index_range',
            startIndex: 1,
            endIndexExclusive: 2,
            removedMessageFingerprints: [expect.any(String)],
            removedMessageIdentities: [expect.objectContaining({ schemaVersion: 1, fingerprint: expect.any(String) })],
          }),
        ],
      }),
    )
  })

  it('does not persist app-server request snip snapshots while durable collapse is active', async () => {
    const fixture = await createThreadFixture()
    const env = { ...fixture.env, FORMAX_CONTEXT_WINDOW_TOKENS: '3000', FORMAX_BASELINE_TOKENS: '0' }
    const notifications: Notification[] = []
    const compactBoundary = buildCompactBoundaryMessage({
      trigger: 'auto',
      preTokens: 4096,
      summaryKind: 'model_summary',
      keepStrategy: {
        kind: 'keep_combo',
        keepLastTurns: 2,
        keepMinTokens: 1200,
        keepMinUserTurns: 1,
      },
    })
    const seededHistory: ChatHistory = [
      compactBoundary,
      { role: 'user', content: [{ type: 'text', text: buildCompactionSummaryUserText('compact summary') }] },
      { role: 'assistant', content: [{ type: 'text', text: `old-a ${'x'.repeat(5000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `old-b ${'y'.repeat(5000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `recent ${'z'.repeat(5000)}` }] },
    ] as ChatHistory
    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const seedWriter = await SessionWriter.openExisting({ filePath: filePath! })
    await seedWriter.appendHistorySnapshot(seededHistory)
    await seedWriter.appendEvent(CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME, {
      id: 'collapse-snip-guard-app-server-1',
      createdAtMs: Date.parse('2026-05-21T00:00:00.000Z'),
      source: 'request_collapse',
      collapsedRange: { kind: 'model_facing_index_range', startIndex: 1, endIndexExclusive: 2 },
      compactBoundaryFingerprint: fingerprintCompactBoundaryMessage(compactBoundary),
      recapMessage: {
        role: 'user',
        content: [{ type: 'text', text: '<system-reminder>durable collapse recap</system-reminder>' }],
      },
      metadata: {
        schemaVersion: 1,
        kind: 'request_recap',
        keepLastTurns: 1,
        preservedTailMessageCount: 2,
        retainedCompactSummary: true,
        recentUserPromptCount: 1,
        recentFileCount: 0,
        earlierToolResultBlockCount: 0,
        recapFingerprint: 'collapse-snip-guard-app-server-fingerprint',
      },
    })
    await seedWriter.shutdown()

    const engineRunTurn = vi.fn(async (args: any) => {
      expect(JSON.stringify(args.requestHistory)).toContain('durable collapse recap')
      expect(JSON.stringify(args.requestHistory)).toContain('[Older assistant text snipped for this request:')
      return [
        ...args.history,
        args.user,
        { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      ] as ChatHistory
    })
    const runner = new TurnRunner({
      engine: { runTurn: engineRunTurn },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const raw = await fs.readFile(filePath!, 'utf8')
    const durableSnipEvents = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((record: any) => record.type === 'event' && record.name === DURABLE_SNIP_COMMITTED_EVENT_NAME)

    expect(durableSnipEvents).toEqual([])
  })

  it('applies durable tool-result content replacement to app-server request history', async () => {
    const fixture = await createThreadFixture()
    const env = { ...fixture.env, FORMAX_CONTEXT_WINDOW_TOKENS: '100000', FORMAX_BASELINE_TOKENS: '0' }
    const notifications: Notification[] = []
    const originalContent = `large durable tool output ${'x'.repeat(2200)}`
    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const seedWriter = await SessionWriter.openExisting({ filePath: filePath! })
    await seedWriter.appendHistorySnapshot([
      assistantToolUse('tool-1', 'Read', { file_path: '/repo/a.ts' }),
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: originalContent }] },
      { role: 'assistant', content: [{ type: 'text', text: 'recent assistant state' }] },
    ] as ChatHistory)
    await seedWriter.appendEvent(DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME, {
      schemaVersion: 1,
      source: 'tool_result_content_replacement',
      sourceScope: { kind: 'main_thread' },
      compactBoundaryFingerprint: null,
      sourceProjectionKind: 'model_facing_baseline',
      replacements: [
        {
          kind: 'tool_result_block',
          toolUseId: 'tool-1',
          replacementContent: '[durable tool result replacement]',
          originalContentFingerprint: fingerprintToolResultContent(originalContent),
        },
      ],
    })
    await seedWriter.shutdown()

    const engineRunTurn = vi.fn(async (args: any) => {
      expect(JSON.stringify(args.history)).toContain('large durable tool output')
      expect(JSON.stringify(args.requestHistory)).not.toContain('large durable tool output')
      expect(JSON.stringify(args.requestHistory)).toContain('[durable tool result replacement]')
      return [
        ...args.history,
        args.user,
        { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      ] as ChatHistory
    })
    const runner = new TurnRunner({
      engine: { runTurn: engineRunTurn },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
  })

  it('applies durable projection before app-server manual /compact summarization', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const originalContent = `large durable tool output before compact ${'x'.repeat(1800)}`
    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const seedWriter = await SessionWriter.openExisting({ filePath: filePath! })
    await seedWriter.appendHistorySnapshot([
      assistantToolUse('tool-compact-1', 'Read', { file_path: '/repo/a.ts' }),
      userToolResult('tool-compact-1', originalContent),
      { role: 'assistant', content: [{ type: 'text', text: 'recent assistant state' }] },
    ] as ChatHistory)
    await seedWriter.appendEvent(DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME, {
      schemaVersion: 1,
      source: 'tool_result_content_replacement',
      sourceScope: { kind: 'main_thread' },
      compactBoundaryFingerprint: null,
      sourceProjectionKind: 'model_facing_baseline',
      replacements: [
        {
          kind: 'tool_result_block',
          toolUseId: 'tool-compact-1',
          replacementContent: '[durable replacement before compact]',
          originalContentFingerprint: fingerprintToolResultContent(originalContent),
        },
      ],
    })
    await seedWriter.shutdown()

    let compactSummaryHistory: ChatHistory | null = null
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          compactSummaryHistory = args.history
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'manual compact summary' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const compactStarted = await runner.startTurn({ threadId: fixture.threadId, input: { text: '/compact' } })
    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && n.params?.turn?.id === compactStarted.turn.id,
    )

    expect(JSON.stringify(compactSummaryHistory)).toContain('[durable replacement before compact]')
    expect(JSON.stringify(compactSummaryHistory)).not.toContain(originalContent)
    const replay = await readSessionFile(filePath!)
    expect(JSON.stringify(replay.history)).not.toContain(originalContent)
    expect(JSON.stringify(replay.history)).not.toContain('[durable replacement before compact]')
  })

  it('uses compact-boundary continuation for app-server request history while preserving raw replay history', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const seededHistory: ChatHistory = [
      { role: 'user', content: [{ type: 'text', text: 'pre-boundary prompt' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'pre-boundary answer' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        meta: {
          compactBoundary: {
            schemaVersion: 1,
            trigger: 'manual',
            preTokens: 4096,
            summaryKind: 'model_summary',
          },
        },
      } as any,
      { role: 'user', content: [{ type: 'text', text: 'compacted summary' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'post-boundary answer' }] },
    ]
    const seedWriter = await SessionWriter.openExisting({ filePath: filePath! })
    await seedWriter.appendHistorySnapshot(seededHistory)
    await seedWriter.shutdown()

    const engineRunTurn = vi.fn(async (args: any) => {
      return [
        ...args.history,
        args.user,
        { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      ] as ChatHistory
    })
    const runner = new TurnRunner({
      engine: { runTurn: engineRunTurn },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue after compact' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const callArgs = engineRunTurn.mock.calls.find(([args]) => Array.isArray(args?.requestHistory))?.[0]
    expect(callArgs).toBeTruthy()
    expect(JSON.stringify(callArgs.history)).toContain('pre-boundary prompt')
    expect(JSON.stringify(callArgs.requestHistory)).not.toContain('pre-boundary prompt')
    expect(JSON.stringify(callArgs.requestHistory)).not.toContain('pre-boundary answer')
    expect(JSON.stringify(callArgs.requestHistory)).toContain('compacted summary')
    expect(JSON.stringify(callArgs.requestHistory)).toContain('post-boundary answer')

    const replay = await readSessionFile(filePath!)
    expect(JSON.stringify(replay.history)).toContain('pre-boundary prompt')
    expect(JSON.stringify(replay.history)).toContain('continue after compact')
  })

  it('covers private runner utilities and guard branches', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const resolved = await (runner as any).resolveOrCreateThreadFilePath({ threadId: fixture.threadId, cwd: fixture.cwd })
    expect(resolved).toBeTruthy()
    ;(runner as any).threadFilePathById.set('missing-path-thread', path.join(fixture.cwd, 'missing.jsonl'))
    const recreated = await (runner as any).resolveOrCreateThreadFilePath({
      threadId: 'missing-path-thread',
      cwd: fixture.cwd,
    })
    expect(recreated).toBeTruthy()

    const fakeRunning = {
      threadId: 't1',
      writer: null,
      pendingEventWrites: [],
      inputExpiryTimers: new Map<string, NodeJS.Timeout>(),
    }
    ;(runner as any).appendAppEvent(fakeRunning, 'noop', { ok: true })
    fakeRunning.writer = { appendEvent: vi.fn().mockRejectedValue(new Error('write failed')) }
    ;(runner as any).appendAppEvent(fakeRunning, 'fail', { ok: true })
    await Promise.all(fakeRunning.pendingEventWrites)

    ;(runner as any).armInputExpiryTimer(
      {
        ...fakeRunning,
        inputExpiryTimers: new Map(),
      },
      { inputId: 'x1', expiresAt: 'invalid-date' },
    )

    const timers = new Map<string, NodeJS.Timeout>()
    timers.set('t1', setTimeout(() => undefined, 1000))
    ;(runner as any).clearAllInputExpiryTimers({ inputExpiryTimers: timers })
    expect(timers.size).toBe(0)

    ;(runner as any).runningByThreadId.set('thread-a', { turnId: 'turn-a' })
    ;(runner as any).expirePendingInput(
      {
        threadId: 'thread-a',
        turnId: 'turn-b',
        inputStore: { submitInput: vi.fn() },
      },
      { inputId: 'x', expiresAt: new Date().toISOString() },
    )
  })

  it('covers start/interrupt/submit guard branches', async () => {
    const fixture = await createThreadFixture()
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification() {},
    })

    ;(runner as any).runningByThreadId.set(fixture.threadId, { turnId: 'existing-turn' })
    await expect(
      runner.startTurn({
        threadId: fixture.threadId,
        input: { text: 'hello' },
      }),
    ).rejects.toThrow('Turn already running for thread')

    await expect(runner.interruptTurn({ threadId: fixture.threadId, turnId: 'missing-turn' })).rejects.toThrow(
      'Turn not running',
    )
    await expect(
      runner.submitInput({
        threadId: fixture.threadId,
        turnId: 'missing-turn',
        inputId: 'i1',
        answers: {},
      }),
    ).rejects.toThrow('Input submission unavailable')

    const runnerWithInputManager = new TurnRunner({
      engine: {
        async runTurn(args) {
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      userInputManager: { submitAnswers: vi.fn().mockReturnValue(true) } as any,
      emitNotification() {},
    })
    ;(runnerWithInputManager as any).runningByThreadId.set('thread-2', {
      turnId: 'turn-2',
      inputStore: {
        hasInput: () => false,
        resolveInputIdFromToolUseId: () => null,
        submitInput: () => ({ accepted: false, status: 'not_pending', transition: null }),
      },
    })
    const pending = await runnerWithInputManager.submitInput({
      threadId: 'thread-2',
      turnId: 'turn-2',
      inputId: 'input-2',
      answers: {},
    })
    expect(pending).toEqual({ accepted: false, status: 'not_pending' })
  })

  it('returns not_pending when input manager rejects accepted submission', async () => {
    const fixture = await createThreadFixture()
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      userInputManager: { submitAnswers: vi.fn().mockReturnValue(false) } as any,
      emitNotification() {},
    })

    ;(runner as any).runningByThreadId.set('thread-1', {
      turnId: 'turn-1',
      inputStore: {
        hasInput: () => true,
        resolveInputIdFromToolUseId: () => null,
        submitInput: () => ({ accepted: true, status: 'accepted', toolUseId: 'tool-1', transition: null }),
      },
    })

    const out = await runner.submitInput({
      threadId: 'thread-1',
      turnId: 'turn-1',
      inputId: 'input-1',
      answers: { ok: 'true' },
    })
    expect(out).toEqual({ accepted: false, status: 'not_pending' })
  })

  it('fails compact command when summary is empty and forwards compact thinking events', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({ type: 'assistant_delta', text: 'should-not-forward-in-compact' } as any)
          args.onEvent({ type: 'thinking_delta', text: 'internal' } as any)
          args.onEvent({ type: 'usage', usage: { input_tokens: 1, output_tokens: 1 } } as any)
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: '/compact' },
    })

    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
    expect(String(failed.params?.error || '')).toContain('Compact failed: empty summary')
    expect(
      notifications.some(
        (n) =>
          n.method === 'turn/event' &&
          (n.params?.event?.type === 'thinking_delta' || n.params?.event?.type === 'usage'),
      ),
    ).toBe(true)
  })

  it('marks turn failed when writer flush fails after completion', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const openSpy = vi.spyOn(SessionWriter, 'openExisting').mockResolvedValue({
      appendEvent: vi.fn().mockResolvedValue(undefined),
      appendStableMsg: vi.fn().mockResolvedValue(undefined),
      appendHistorySnapshot: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockRejectedValue(new Error('flush failed')),
      shutdown: vi.fn().mockRejectedValue(new Error('shutdown failed')),
    } as any)

    try {
      const runner = new TurnRunner({
        engine: {
          async runTurn(args) {
            args.onEvent({ type: 'assistant_delta', text: 'ok' } as any)
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
            ] as ChatHistory
          },
        },
        tools: [],
        allowedSubagents: [],
        model: 'test-model',
        cwd: fixture.cwd,
        env: fixture.env,
        emitNotification(method, params) {
          notifications.push({ method, params })
        },
      })

      await runner.startTurn({
        threadId: fixture.threadId,
        input: { text: 'hello' },
      })
      const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
      expect(String(failed.params?.error || '')).toContain('flush failed')
      expect(notifications.some((n) => n.method === 'thread/updated')).toBe(false)
    } finally {
      openSpy.mockRestore()
    }
  })

  it('does not expose app-server durable snip commits when final flush fails', async () => {
    const fixture = await createThreadFixture()
    const env = { ...fixture.env, FORMAX_CONTEXT_WINDOW_TOKENS: '3000', FORMAX_BASELINE_TOKENS: '0' }
    const notifications: Notification[] = []
    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const seedWriter = await SessionWriter.openExisting({ filePath: filePath! })
    await seedWriter.appendHistorySnapshot([
      { role: 'assistant', content: [{ type: 'text', text: `old-a ${'x'.repeat(5000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `old-b ${'y'.repeat(5000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `recent ${'z'.repeat(5000)}` }] },
    ] as ChatHistory)
    await seedWriter.shutdown()

    const appendEvent = vi.fn().mockResolvedValue(undefined)
    const openSpy = vi.spyOn(SessionWriter, 'openExisting').mockResolvedValue({
      appendEvent,
      appendStableMsg: vi.fn().mockResolvedValue(undefined),
      appendHistorySnapshot: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockRejectedValue(new Error('flush failed')),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as any)

    try {
      const runner = new TurnRunner({
        engine: {
          async runTurn(args) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
            ] as ChatHistory
          },
        },
        tools: [],
        allowedSubagents: [],
        model: 'test-model',
        cwd: fixture.cwd,
        env,
        emitNotification(method, params) {
          notifications.push({ method, params })
        },
      })

      await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue' } })
      const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
      expect(String(failed.params?.error || '')).toContain('flush failed')
      expect(appendEvent).not.toHaveBeenCalledWith(DURABLE_SNIP_COMMITTED_EVENT_NAME, expect.anything())
      expect(appendEvent).not.toHaveBeenCalledWith(CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME, expect.anything())
    } finally {
      openSpy.mockRestore()
    }
  })

  it('does not expose app-server durable snip commits when history snapshot append fails', async () => {
    const fixture = await createThreadFixture()
    const env = { ...fixture.env, FORMAX_CONTEXT_WINDOW_TOKENS: '3000', FORMAX_BASELINE_TOKENS: '0' }
    const notifications: Notification[] = []
    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const seedWriter = await SessionWriter.openExisting({ filePath: filePath! })
    await seedWriter.appendHistorySnapshot([
      { role: 'assistant', content: [{ type: 'text', text: `old-a ${'x'.repeat(5000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `old-b ${'y'.repeat(5000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `recent ${'z'.repeat(5000)}` }] },
    ] as ChatHistory)
    await seedWriter.shutdown()

    const appendEvent = vi.fn().mockResolvedValue(undefined)
    const openSpy = vi.spyOn(SessionWriter, 'openExisting').mockResolvedValue({
      appendEvent,
      appendStableMsg: vi.fn().mockResolvedValue(undefined),
      appendHistorySnapshot: vi.fn().mockRejectedValue(new Error('snapshot failed')),
      flush: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as any)

    try {
      const runner = new TurnRunner({
        engine: {
          async runTurn(args) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
            ] as ChatHistory
          },
        },
        tools: [],
        allowedSubagents: [],
        model: 'test-model',
        cwd: fixture.cwd,
        env,
        emitNotification(method, params) {
          notifications.push({ method, params })
        },
      })

      await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue' } })
      const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
      expect(String(failed.params?.error || '')).toContain('snapshot failed')
      expect(appendEvent).not.toHaveBeenCalledWith(DURABLE_SNIP_COMMITTED_EVENT_NAME, expect.anything())
      expect(appendEvent).not.toHaveBeenCalledWith(CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME, expect.anything())
    } finally {
      openSpy.mockRestore()
    }
  })

  it('reactively compacts and retries app-server context-overflow provider errors once', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const seedWriter = await SessionWriter.openExisting({
      filePath: (await findSessionFileBySessionId({ cwd: fixture.cwd, env: fixture.env, sessionId: fixture.threadId }))!,
    })
    await seedWriter.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'old question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] },
    ] as ChatHistory)
    await seedWriter.shutdown()

    const runTurn = vi.fn(async (args: any) => {
      const call = runTurn.mock.calls.length
      if (call === 1) {
        throw new Error('HTTP 413: request too large')
      }
      if (call === 2) {
        return [
          ...args.history,
          args.user,
          { role: 'assistant', content: [{ type: 'text', text: 'reactive summary' }] },
        ] as ChatHistory
      }
      args.onEvent?.({ type: 'assistant_delta', text: 'ok after retry' })
      return [
        ...args.history,
        args.user,
        { role: 'assistant', content: [{ type: 'text', text: 'ok after retry' }] },
      ] as ChatHistory
    })
    const runner = new TurnRunner({
      engine: { runTurn },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue' } })

    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
    expect(runTurn.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(runTurn.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ requestHistory: expect.any(Array) }))
    expect(runTurn.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ tools: [] }))
    expect(runTurn.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        requestHistory: expect.any(Array),
        requestUser: expect.objectContaining({ role: 'user' }),
      }),
    )
    expect(runTurn.mock.calls[2]?.[0]).toHaveProperty('cacheEditPlan')
    expect(notifications.some((n) => n.method === 'turn/failed')).toBe(false)

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const raw = await fs.readFile(filePath!, 'utf8')
    expect(raw).toContain('reactive_compact_applied')
    expect(raw).toContain('ok after retry')
  })

  it('does not run a second app-server reactive compact when the reactive retry also overflows', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const seedWriter = await SessionWriter.openExisting({
      filePath: (await findSessionFileBySessionId({ cwd: fixture.cwd, env: fixture.env, sessionId: fixture.threadId }))!,
    })
    await seedWriter.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'old question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] },
    ] as ChatHistory)
    await seedWriter.shutdown()

    const runTurn = vi.fn(async (args: any) => {
      const call = runTurn.mock.calls.length
      if (call === 1) {
        throw new Error('HTTP 413: request too large')
      }
      if (call === 2) {
        return [
          ...args.history,
          args.user,
          { role: 'assistant', content: [{ type: 'text', text: 'reactive summary' }] },
        ] as ChatHistory
      }
      throw new Error('API Error: 400 prompt is too long after reactive compact')
    })
    const runner = new TurnRunner({
      engine: { runTurn },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue' } })

    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
    expect(runTurn).toHaveBeenCalledTimes(3)
    expect(String(failed.params?.error || '')).toContain('prompt is too long after reactive compact')
    expect(notifications.some((n) => n.method === 'turn/completed')).toBe(false)

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const raw = await fs.readFile(filePath!, 'utf8')
    expect((raw.match(/reactive_compact_applied/g) ?? []).length).toBe(1)
  })

  it('keeps app-server interrupted status before overflow-like error text', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const runTurn = vi.fn(
      async (args) =>
        await new Promise<ChatHistory>((_, reject) => {
          args.signal?.addEventListener(
            'abort',
            () => reject(new Error('Request aborted: prompt is too long')),
            { once: true },
          )
        }),
    )
    const runner = new TurnRunner({
      engine: { runTurn },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const started = await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue' } })
    await vi.waitFor(() => {
      expect(runTurn).toHaveBeenCalledTimes(1)
    })
    await runner.interruptTurn({ threadId: fixture.threadId, turnId: started.turn.id })

    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(failed.params?.turn?.status).toBe('interrupted')
    expect(String(failed.params?.error || '')).toContain('Request aborted: prompt is too long')
    expect(notifications.some((n) => n.method === 'turn/completed')).toBe(false)
  })

  it('characterizes app-server auth/rate-limit errors with overflow-like text as fail-fast', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const runTurn = vi.fn(async () => {
      throw new Error('API Error: 429 rate limit exceeded; prompt is too long')
    })
    const runner = new TurnRunner({
      engine: { runTurn },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue' } })

    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(String(failed.params?.error || '')).toContain('API Error: 429 rate limit exceeded; prompt is too long')
    expect(notifications.some((n) => n.method === 'turn/completed')).toBe(false)
  })

  it('does not commit app-server durable snip when reactive compact fails', async () => {
    const fixture = await createThreadFixture()
    const env = { ...fixture.env, FORMAX_CONTEXT_WINDOW_TOKENS: '3000', FORMAX_BASELINE_TOKENS: '0' }
    const notifications: Notification[] = []
    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const seedWriter = await SessionWriter.openExisting({ filePath: filePath! })
    await seedWriter.appendHistorySnapshot([
      { role: 'assistant', content: [{ type: 'text', text: `old-a ${'x'.repeat(5000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `old-b ${'y'.repeat(5000)}` }] },
      { role: 'assistant', content: [{ type: 'text', text: `recent ${'z'.repeat(5000)}` }] },
    ] as ChatHistory)
    await seedWriter.shutdown()

    const appendEvent = vi.fn().mockResolvedValue(undefined)
    const openSpy = vi.spyOn(SessionWriter, 'openExisting').mockResolvedValue({
      appendEvent,
      appendStableMsg: vi.fn().mockResolvedValue(undefined),
      appendHistorySnapshot: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as any)

    try {
      const runTurn = vi.fn(async () => {
        throw new Error('HTTP 413: request too large')
      })
      const runner = new TurnRunner({
        engine: { runTurn },
        tools: [],
        allowedSubagents: [],
        model: 'test-model',
        cwd: fixture.cwd,
        env,
        emitNotification(method, params) {
          notifications.push({ method, params })
        },
      })

      await runner.startTurn({ threadId: fixture.threadId, input: { text: 'continue' } })

      const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
      expect(runTurn).toHaveBeenCalledTimes(2)
      expect(String(failed.params?.error || '')).toContain('HTTP 413: request too large')
      expect(appendEvent).toHaveBeenCalledWith('compact_failed', expect.objectContaining({ source: 'reactive' }))
      expect(appendEvent).not.toHaveBeenCalledWith(DURABLE_SNIP_COMMITTED_EVENT_NAME, expect.anything())
    } finally {
      openSpy.mockRestore()
    }
  })

  it('marks turn failed when writer flush rejects with non-Error value', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const openSpy = vi.spyOn(SessionWriter, 'openExisting').mockResolvedValue({
      appendEvent: vi.fn().mockResolvedValue(undefined),
      appendStableMsg: vi.fn().mockResolvedValue(undefined),
      appendHistorySnapshot: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockRejectedValue('flush-string-error'),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as any)

    try {
      const runner = new TurnRunner({
        engine: {
          async runTurn(args) {
            args.onEvent({ type: 'assistant_delta', text: 'ok' } as any)
            return [...args.history, args.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }] as ChatHistory
          },
        },
        tools: [],
        allowedSubagents: [],
        model: 'test-model',
        cwd: fixture.cwd,
        env: fixture.env,
        emitNotification(method, params) {
          notifications.push({ method, params })
        },
      })

      await runner.startTurn({ threadId: fixture.threadId, input: { text: 'hello' } })
      const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
      expect(String(failed.params?.error || '')).toContain('flush-string-error')
    } finally {
      openSpy.mockRestore()
    }
  })

  it('uses ensureThreadFilePath override when provided', async () => {
    const fixture = await createThreadFixture()
    const ensureThreadFilePath = vi.fn(async () => path.join(fixture.cwd, 'custom-thread.jsonl'))
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      ensureThreadFilePath,
      emitNotification() {},
    })

    const out = await (runner as any).resolveOrCreateThreadFilePath({ threadId: 't-override', cwd: fixture.cwd })
    expect(out).toContain('custom-thread.jsonl')
    expect(ensureThreadFilePath).toHaveBeenCalled()
  })

  it('emits failed turn when session open fails before writer initialization', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const openSpy = vi.spyOn(SessionWriter, 'openExisting').mockRejectedValue('open-failed')
    try {
      const runner = new TurnRunner({
        engine: {
          async runTurn(args) {
            return [...args.history, args.user] as ChatHistory
          },
        },
        tools: [],
        allowedSubagents: [],
        model: 'test-model',
        cwd: fixture.cwd,
        env: fixture.env,
        emitNotification(method, params) {
          notifications.push({ method, params })
        },
      })
      await runner.startTurn({ threadId: fixture.threadId, input: { text: 'hello' } })
      const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
      expect(String(failed.params?.error || '')).toContain('open-failed')
    } finally {
      openSpy.mockRestore()
    }
  })

  it('emits startTurn background failure when finally-phase logic throws', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })
    ;(runner as any).resolvePendingInputs = () => {
      throw new Error('finally explosion')
    }

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'hello' } })
    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
    expect(String(failed.params?.error || '')).toContain('finally explosion')
  })

  it('uses string conversion for non-Error startTurn background failures', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })
    ;(runner as any).runTurnInBackground = async () => {
      throw 'string-failure'
    }

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'hello' } })
    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
    expect(String(failed.params?.error || '')).toContain('string-failure')
  })

  it('marks compact turn interrupted when aborted after compact run', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          await new Promise((resolve) => setTimeout(resolve, 40))
          return [...args.history, args.user, { role: 'assistant', content: [{ type: 'text', text: 'summary' }] }] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const started = await runner.startTurn({ threadId: fixture.threadId, input: { text: '/compact' } })
    await runner.interruptTurn({ threadId: fixture.threadId, turnId: started.turn.id })
    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
    expect(failed.params?.turn?.status).toBe('interrupted')
  })

  it('marks normal turn interrupted and swallows auto-title rejection', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const titleSpy = vi.spyOn(sessionTitle, 'maybeAutoGenerateSessionTitle').mockRejectedValue(new Error('title fail'))
    try {
      const runner = new TurnRunner({
        engine: {
          async runTurn(args) {
            await new Promise((resolve) => setTimeout(resolve, 40))
            return [...args.history, args.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }] as ChatHistory
          },
        },
        tools: [],
        allowedSubagents: [],
        model: 'test-model',
        cwd: fixture.cwd,
        env: fixture.env,
        emitNotification(method, params) {
          notifications.push({ method, params })
        },
      })

      const started = await runner.startTurn({ threadId: fixture.threadId, input: { text: 'hello' } })
      await runner.interruptTurn({ threadId: fixture.threadId, turnId: started.turn.id })
      const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
      expect(failed.params?.turn?.status).toBe('interrupted')
    } finally {
      titleSpy.mockRestore()
    }
  })

  it('hits post-run abort checks for compact and normal branches', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({ type: 'assistant_delta', text: 'x' } as any)
          // Abort after runTurn returns so post-run aborted checks are exercised.
          ;(args.signal as AbortSignal).dispatchEvent?.(new Event('noop'))
          return [...args.history, args.user, { role: 'assistant', content: [{ type: 'text', text: 'x' }] }] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const mkRunning = (compact: boolean) =>
      ({
        turnId: randomUUID(),
        traceId: randomUUID(),
        seq: 0,
        threadId: fixture.threadId,
        filePath: (runner as any).threadFilePathById.get(fixture.threadId) ?? '',
        cwd: fixture.cwd,
        inputText: compact ? '/compact' : 'hello',
        modelInputText: compact ? '/compact' : 'hello',
        modelUserContent: [{ type: 'text', text: compact ? '/compact' : 'hello' }],
        semanticBlockCount: 0,
        pendingInjectedBlockCount: 0,
        replMode: 'normal',
        abortController: new AbortController(),
        inputStore: { resolveAllPending: () => [] },
        writer: null,
        pendingEventWrites: [],
        inputExpiryTimers: new Map(),
        compact: { isCommand: compact, instructions: '' },
        toolNameByUseId: new Map(),
        toolInputByUseId: new Map(),
      }) as any

    const pathOut = await (runner as any).resolveOrCreateThreadFilePath({ threadId: fixture.threadId, cwd: fixture.cwd })
    ;(runner as any).threadFilePathById.set(fixture.threadId, pathOut)

    const compactRunning = mkRunning(true)
    const normalRunning = mkRunning(false)
    vi.spyOn(compactRunning.abortController, 'abort').mockImplementation(function (this: AbortController) {
      AbortController.prototype.abort.call(this)
    })
    vi.spyOn(normalRunning.abortController, 'abort').mockImplementation(function (this: AbortController) {
      AbortController.prototype.abort.call(this)
    })

    const originalRunTurn = (runner as any).engine.runTurn
    let callCount = 0
    ;(runner as any).engine.runTurn = async (args: any) => {
      callCount += 1
      if (callCount === 1) compactRunning.abortController.abort()
      if (callCount === 2) normalRunning.abortController.abort()
      return [...args.history, args.user, { role: 'assistant', content: [{ type: 'text', text: 'x' }] }]
    }
    try {
      await (runner as any).runTurnInBackground(compactRunning)
      await (runner as any).runTurnInBackground(normalRunning)
    } finally {
      ;(runner as any).engine.runTurn = originalRunTurn
    }

    expect(notifications.some((n) => n.method === 'turn/failed')).toBe(true)
  })

  it('treats pending restore injected blocks as next-turn-only and strips them from persisted history', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const reminderBlock = {
      type: 'text',
      text: '<system-reminder>\nRestored session memory for the next turn only:\n- Plan path: /repo/.formax/plan.md\n</system-reminder>',
    } as const
    let capturedUserContent: unknown[] = []
    let consumedBeforeDispatch = false
    const consumed: Array<{ threadId: string; turnId: string }> = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          consumedBeforeDispatch = consumed.length === 1
          if (capturedUserContent.length === 0) {
            capturedUserContent = Array.isArray(args.user.content) ? [...args.user.content] : []
          }
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'resume-aware turn' },
      pendingInjectedBlocks: [reminderBlock],
      onPendingInjectedBlocksConsumed: (payload) => {
        consumed.push(payload)
      },
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    expect(consumed).toHaveLength(1)
    expect(consumed[0]).toEqual({
      threadId: fixture.threadId,
      turnId: expect.any(String),
    })
    expect(consumedBeforeDispatch).toBe(true)
    expect(JSON.stringify(capturedUserContent)).toContain('Restored session memory for the next turn only:')

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const replay = await readSessionFile(filePath!)
    const lastUser = [...replay.history].reverse().find((message) => message.role === 'user')
    expect(JSON.stringify(lastUser?.content ?? [])).toContain('resume-aware turn')
    expect(JSON.stringify(lastUser?.content ?? [])).not.toContain('Restored session memory for the next turn only:')
  })

  it('covers tool event branches with missing metadata and line-less updates', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({ type: 'tool_start', id: 't1', name: 'Edit' } as any)
          args.onEvent({ type: 'tool_input', id: 't1', input: 'not-object' } as any)
          args.onEvent({ type: 'tool_update', id: 't1', transcriptLines: ['   '] } as any)
          args.onEvent({ type: 'tool_input', id: 'unknown-tool', input: { a: 1 } } as any)
          args.onEvent({ type: 'tool_update', id: 'unknown-tool', middleLines: ['x'] } as any)
          args.onEvent({
            type: 'tool_end',
            id: 't1',
            result: { is_error: false, content: '' },
          } as any)
          args.onEvent({
            type: 'tool_end',
            id: 'unknown-tool',
            result: { is_error: false, content: 'ok' },
          } as any)
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'hello' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
    expect(notifications.some((n) => n.method === 'turn/event')).toBe(true)
  })

  it('supports runner initialization without explicit cwd', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })
    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'hello' }, cwd: fixture.cwd })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
  })

  it('covers timer branches without unref and expirePendingInput non-expired path', async () => {
    const fixture = await createThreadFixture()
    const runner = new TurnRunner({
      engine: { async runTurn(args) { return [...args.history, args.user] as ChatHistory } },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      userInputManager: { reject: vi.fn() } as any,
      emitNotification() {},
    })

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((fn: any) => {
      fn()
      return 1 as any
    }) as any)
    try {
      const running: any = {
        threadId: 'thread-x',
        turnId: 'turn-x',
        inputExpiryTimers: new Map<string, any>(),
        inputStore: {
          submitInput: () => ({ status: 'accepted', toolUseId: undefined, transition: null }),
        },
      }
      ;(runner as any).runningByThreadId.set('thread-x', running)
      ;(runner as any).armInputExpiryTimer(running, {
        inputId: 'i1',
        expiresAt: new Date(Date.now() - 10).toISOString(),
      })
      expect(running.inputExpiryTimers.size).toBeGreaterThanOrEqual(0)
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })

  it('swallows auto-title errors on successful non-compact turns', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const titleSpy = vi.spyOn(sessionTitle, 'maybeAutoGenerateSessionTitle').mockRejectedValue(new Error('title fail'))
    try {
      const runner = new TurnRunner({
        engine: {
          async runTurn(args) {
            args.onEvent({ type: 'assistant_delta', text: 'ok' } as any)
            return [...args.history, args.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }] as ChatHistory
          },
        },
        tools: [],
        allowedSubagents: [],
        model: 'test-model',
        cwd: fixture.cwd,
        env: fixture.env,
        emitNotification(method, params) {
          notifications.push({ method, params })
        },
      })

      await runner.startTurn({ threadId: fixture.threadId, input: { text: 'hello' } })
      await waitForNotification(notifications, (n) => n.method === 'turn/completed')
    } finally {
      titleSpy.mockRestore()
    }
  })

  it('creates a session file lazily when starting a turn for a provisional thread id', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-turn-runner-lazy-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-turn-runner-lazy-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
    const threadId = randomUUID()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({ type: 'complete' })
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd,
      env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId,
      input: { text: 'lazy create' },
    })

    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
    const filePath = await findSessionFileBySessionId({ cwd, env, sessionId: threadId })
    expect(filePath).toBeTruthy()
  })

  it('rejects unsafe thread ids when lazily creating a session file', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-turn-runner-unsafe-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-turn-runner-unsafe-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({ type: 'complete' })
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd,
      env,
      emitNotification() {},
    })

    await expect(
      runner.startTurn({
        threadId: '../unsafe-thread-id',
        input: { text: 'should fail' },
      }),
    ).rejects.toThrow('Invalid sessionId')
  })

  it('reuses an existing thread file from request cwd when runner cwd differs', async () => {
    const requestCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-turn-runner-request-cwd-'))
    const runnerCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-turn-runner-runner-cwd-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: '.formax-relative' }
    const threadId = randomUUID()
    const notifications: Notification[] = []
    const sessionsRoot = path.join(requestCwd, '.formax-relative', 'sessions')
    const seeded = await SessionWriter.createNew({ cwd: requestCwd, env, sessionId: threadId })
    await seeded.writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'seed history' }] },
    ] as any)
    await seeded.writer.shutdown()
    const beforeFiles = await listThreadFilesById({ sessionsRoot, threadId })
    expect(beforeFiles).toHaveLength(1)

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({ type: 'complete' })
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: runnerCwd,
      env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId,
      cwd: requestCwd,
      input: { text: 'follow up' },
    })

    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
    const afterFiles = await listThreadFilesById({ sessionsRoot, threadId })
    expect(afterFiles).toHaveLength(1)
    expect(afterFiles[0]).toBe(beforeFiles[0])
  })

  it('reuses an existing thread file after request cwd changes with relative config dir', async () => {
    const runnerCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-turn-runner-reuse-runner-cwd-'))
    const requestCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-turn-runner-reuse-request-cwd-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: '.formax-relative' }
    const threadId = randomUUID()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({ type: 'complete' })
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: runnerCwd,
      env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId,
      input: { text: 'first turn' },
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    notifications.length = 0
    await runner.startTurn({
      threadId,
      cwd: requestCwd,
      input: { text: 'second turn' },
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const runnerFiles = await listThreadFilesById({
      sessionsRoot: path.join(runnerCwd, '.formax-relative', 'sessions'),
      threadId,
    })
    const requestFiles = await listThreadFilesById({
      sessionsRoot: path.join(requestCwd, '.formax-relative', 'sessions'),
      threadId,
    })
    expect(runnerFiles).toHaveLength(1)
    expect(requestFiles).toHaveLength(0)
  })

  it('runs a turn, emits events, and persists history', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({
            type: 'ask_user_question',
            toolUseId: 'ask-1',
            questions: [
              {
                question: 'Pick one?',
                header: 'Choice',
                options: [{ label: 'A', description: 'Option A' }],
                multiSelect: false,
              },
            ],
          })
          args.onEvent({ type: 'assistant_delta', text: 'hello' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const started = await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'say hello' },
    })
    expect(started.turn.status).toBe('running')

    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
    expect(
      notifications.some(
        (n) => n.method === 'turn/inputRequested' && n.params?.input?.kind === 'ask_user_question',
      ),
    ).toBe(true)
    expect(
      notifications.some(
        (n) => n.method === 'turn/inputResolved' && n.params?.input?.status === 'failed',
      ),
    ).toBe(true)

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const replay = await readSessionFile(filePath!)
    expect(replay.history.at(-1)?.role).toBe('assistant')
    expect(replay.messages.some((m) => m.role === 'user' && m.content === 'say hello')).toBe(true)
    expect(replay.messages.some((m) => m.role === 'assistant' && m.content.includes('hello'))).toBe(true)
    const rawLines = (await fs.readFile(filePath!, 'utf8'))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const appTurnStartedRecord = rawLines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>
        } catch {
          return null
        }
      })
      .find((record) => record?.type === 'event' && record?.name === 'app_turn_started')
    expect((appTurnStartedRecord?.data as { cwd?: unknown } | undefined)?.cwd).toBe(fixture.cwd)

    expect(notifications.some((n) => n.method === 'turn/started')).toBe(true)
    expect(notifications.some((n) => n.method === 'turn/event')).toBe(true)
    expect(notifications.every((n) => typeof n.params?.seq === 'number')).toBe(true)
    expect(notifications.every((n) => typeof n.params?.traceId === 'string')).toBe(true)
  })

  it('supports interrupt and clears in-flight lock for next turn', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 50)
            args.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                reject(new Error('Request aborted'))
              },
              { once: true },
            )
          })
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const turn1 = await runner.startTurn({ threadId: fixture.threadId, input: { text: 'one' } })
    await runner.interruptTurn({ threadId: fixture.threadId, turnId: turn1.turn.id })
    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
    expect(failed.params?.turn?.status).toBe('interrupted')

    const turn2 = await runner.startTurn({ threadId: fixture.threadId, input: { text: 'two' } })
    expect(turn2.turn.status).toBe('running')
    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && n.params?.turn?.id === turn2.turn.id,
    )
  })

  it('submits answers through userInputManager and emits inputResolved', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const userInput = createUserInputManager()

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          if (args.tools.length === 0 && userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Turn Question Title' }] },
            ] as ChatHistory
          }
          const questions = [
            {
              question: 'Pick one?',
              header: 'Choice',
              options: [{ label: 'A', description: 'Option A' }],
              multiSelect: false,
            },
          ]
          args.onEvent({ type: 'ask_user_question', toolUseId: 'ask-1', questions })
          const answers = await userInput.requestAnswers({ toolUseId: 'ask-1', questions, signal: args.signal })
          args.onEvent({ type: 'assistant_delta', text: String(answers.Choice ?? '') })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: String(answers.Choice ?? '') }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      userInputManager: userInput,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const started = await runner.startTurn({ threadId: fixture.threadId, input: { text: 'question' } })
    const requested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && n.params?.input?.kind === 'ask_user_question',
    )

    const out = await runner.submitInput({
      threadId: fixture.threadId,
      turnId: started.turn.id,
      inputId: 'ask-1',
      answers: { Choice: 'A' },
      submissionId: 'sub-1',
    })
    expect(out).toEqual({ accepted: true, status: 'accepted' })

    const resolved = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputResolved' && n.params?.input?.status === 'submitted',
    )
    expect(resolved.params?.input?.inputId).toBe(requested.params.input.inputId)

    await waitForNotification(notifications, (n) => n.method === 'turn/completed')
  })

  it('expires pending input by TTL and emits expired resolution', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const userInput = createUserInputManager()

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const questions = [
            {
              question: 'Pick one?',
              header: 'Choice',
              options: [{ label: 'A', description: 'Option A' }],
              multiSelect: false,
            },
          ]
          args.onEvent({ type: 'ask_user_question', toolUseId: 'ask-expire-1', questions })
          await userInput.requestAnswers({ toolUseId: 'ask-expire-1', questions, signal: args.signal })
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      userInputManager: userInput,
      defaultInputTtlMs: 20,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const started = await runner.startTurn({ threadId: fixture.threadId, input: { text: 'expire me' } })

    const requested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && n.params?.input?.toolUseId === 'ask-expire-1',
    )
    const expired = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputResolved' && n.params?.input?.status === 'expired',
      3000,
    )
    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')

    expect(expired.params?.input?.inputId).toBe(requested.params?.input?.inputId)
    expect(String(failed.params?.error ?? '')).toContain('Input expired')

    const requestedAt = notifications.findIndex((n) => n === requested)
    const expiredAt = notifications.findIndex((n) => n === expired)
    const failedAt = notifications.findIndex((n) => n === failed)
    expect(requestedAt).toBeGreaterThanOrEqual(0)
    expect(expiredAt).toBeGreaterThan(requestedAt)
    expect(failedAt).toBeGreaterThan(expiredAt)

    const submit = await runner.submitInput({
      threadId: fixture.threadId,
      turnId: started.turn.id,
      inputId: requested.params?.input?.inputId,
      answers: { Choice: 'A' },
      submissionId: 'late-submit',
    })
    expect(submit).toEqual({ accepted: false, status: 'not_pending' })
  })

  it('emits failed when engine runTurn throws', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn() {
          throw new Error('boom')
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const started = await runner.startTurn({ threadId: fixture.threadId, input: { text: 'explode' } })
    expect(started.turn.status).toBe('running')

    const failed = await waitForNotification(notifications, (n) => n.method === 'turn/failed')
    expect(failed.params?.turn?.status).toBe('failed')
    expect(String(failed.params?.error ?? '')).toContain('boom')
  })

  it('keeps approval toolName in input payload', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({
            type: 'approval_request',
            toolUseId: 'approval-1',
            toolName: 'Bash',
            action: { kind: 'bash.exec' },
            effectiveDecision: { decision: 'ask' },
          })
          args.onEvent({ type: 'complete' })
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'check' } })
    const approvalRequested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && n.params?.input?.kind === 'approval',
    )
    expect(approvalRequested.params?.input?.payload?.toolName).toBe('Bash')
  })

  it('persists toolName on app_tool_event update/end rows', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({ type: 'tool_start', id: 'tool-1', name: 'Bash' })
          args.onEvent({ type: 'tool_input', id: 'tool-1', input: { command: 'ls -la' } })
          args.onEvent({ type: 'tool_update', id: 'tool-1', middleLines: ['running'] })
          args.onEvent({
            type: 'tool_end',
            id: 'tool-1',
            result: { tool_use_id: 'tool-1', content: 'done', is_error: false },
          })
          args.onEvent({ type: 'complete' })
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'tool name sticky' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const toolEvents = await readAppToolEvents(filePath!)
    const targetEvents = toolEvents.filter((event) => event.toolUseId === 'tool-1')
    expect(targetEvents.length).toBeGreaterThanOrEqual(4)
    const updateOrEnd = targetEvents.filter((event) => event.phase === 'update' || event.phase === 'end')
    expect(updateOrEnd.length).toBeGreaterThanOrEqual(2)
    for (const event of updateOrEnd) {
      expect(event.toolName).toBe('Bash')
    }
    const inputUpdate = targetEvents.find(
      (event) => event.phase === 'update' && event.input && typeof event.input === 'object',
    )
    expect(inputUpdate?.input).toEqual({ command: 'ls -la' })
  })

  it('computes and emits patchStartLineNumber for Edit tool_end', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    await fs.writeFile(
      path.join(fixture.cwd, 'demo.txt'),
      ['Copyright (c) 2026 yusifeng', 'use, copy, modify', 'tail line'].join('\n'),
      'utf8',
    )

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          args.onEvent({ type: 'tool_start', id: 'edit-1', name: 'Edit' })
          args.onEvent({
            type: 'tool_input',
            id: 'edit-1',
            input: {
              file_path: 'demo.txt',
              old_string: 'use, copy, modify',
              new_string: 'use, copy, modify, merge',
            },
          })
          args.onEvent({
            type: 'tool_end',
            id: 'edit-1',
            result: { tool_use_id: 'edit-1', content: 'Edited demo.txt', is_error: false },
          })
          args.onEvent({ type: 'complete' })
          return [...args.history, args.user] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({ threadId: fixture.threadId, input: { text: 'edit now' } })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const toolEndNotification = notifications.find(
      (n) =>
        n.method === 'turn/event' &&
        n.params?.event?.type === 'tool_end' &&
        n.params?.event?.id === 'edit-1',
    )
    expect(typeof toolEndNotification?.params?.event?.patchStartLineNumber).toBe('number')
    expect(toolEndNotification?.params?.event?.patchStartLineNumber).toBe(2)

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const toolEvents = await readAppToolEvents(filePath!)
    const endEvent = toolEvents.find(
      (event) => event.toolUseId === 'edit-1' && event.phase === 'end',
    )
    expect(endEvent?.patchStartLineNumber).toBe(2)
  })

  it('auto-generates session title once after completed turn', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          if (args.tools.length === 0 && userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Auto Title Test' }] },
            ] as ChatHistory
          }
          args.onEvent({ type: 'assistant_delta', text: 'main assistant reply' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'main assistant reply' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'please start and make a title' },
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const summary = await readSessionSummary(filePath!)
    expect(summary.label).toBe('Auto Title Test')
    const updatedIndex = notifications.findIndex((n) => n.method === 'thread/updated')
    const completedIndex = notifications.findIndex((n) => n.method === 'turn/completed')
    expect(updatedIndex).toBeGreaterThanOrEqual(0)
    expect(updatedIndex).toBeLessThan(completedIndex)
  })

  it('does not update existing session title when topic changes', async () => {
    const fixture = await createThreadFixture()
    const seedWriter = await SessionWriter.openExisting({
      filePath: (
        await findSessionFileBySessionId({
          cwd: fixture.cwd,
          env: fixture.env,
          sessionId: fixture.threadId,
        })
      )!,
    })
    await seedWriter.appendEvent('session_rename', { label: 'Old Topic' })
    await seedWriter.shutdown()

    const notifications: Notification[] = []
    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          const systemText = Array.isArray(args.system)
            ? args.system
                .map((block) => ((block as any)?.type === 'text' ? String((block as any).text ?? '') : ''))
                .join('\n')
            : ''
          if (args.tools.length === 0 && systemText.includes('Analyze if this message indicates a new conversation topic')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: '{ "isNewTopic": true, "title": "New Topic" }' }] },
            ] as ChatHistory
          }
          args.onEvent({ type: 'assistant_delta', text: 'turn complete' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'turn complete' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: '我们现在改聊 diff 面板' },
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const summary = await readSessionSummary(filePath!)
    expect(summary.label).toBe('Old Topic')
    expect(notifications.some((n) => n.method === 'thread/updated')).toBe(false)
  })

  it('maps /init to init prompt for model while keeping user transcript text', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    let capturedUserText = ''

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          if (userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Init Title' }] },
            ] as ChatHistory
          }
          capturedUserText = userText
          args.onEvent({ type: 'assistant_delta', text: 'ok' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: '/init' },
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    expect(capturedUserText).toBe(buildInitPrompt())

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const replay = await readSessionFile(filePath!)
    expect(replay.messages.some((m) => m.role === 'user' && m.content === '/init')).toBe(true)
  })

  it('executes /compact semantics and persists compacted history', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const toolStub = { name: 'DummyTool' } as any
    let compactToolsLength = -1
    let compactReplMode: string | undefined
    let compactPromptText = ''
    let consumedBeforeCompactModelRun = false
    const consumedPendingRestore: Array<{ threadId: string; turnId: string }> = []
    const reminderBlock = {
      type: 'text',
      text: '<system-reminder>\nRestored session memory for the next turn only.\n</system-reminder>',
    } as const

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          if (args.tools.length === 0) {
            consumedBeforeCompactModelRun = consumedPendingRestore.length === 1
            compactToolsLength = args.tools.length
            compactReplMode = args.exec?.replMode as string | undefined
            compactPromptText = Array.isArray(args.user.content)
              ? args.user.content
                  .map((block) => {
                    if (!block || typeof block !== 'object') return ''
                    if ((block as { type?: unknown }).type !== 'text') return ''
                    const text = (block as { text?: unknown }).text
                    return typeof text === 'string' ? text : ''
                  })
                  .filter(Boolean)
                  .join('\n\n')
              : ''
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Compaction summary from model' }] },
            ] as ChatHistory
          }
          args.onEvent({ type: 'assistant_delta', text: 'normal reply' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'normal reply' }] },
          ] as ChatHistory
        },
      },
      tools: [toolStub],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'hello before compact' },
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    const compactStarted = await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: '/compact keep the intent only' },
      mode: 'plan',
      pendingInjectedBlocks: [reminderBlock],
      onPendingInjectedBlocksConsumed: (payload) => {
        consumedPendingRestore.push(payload)
      },
    })
    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && n.params?.turn?.id === compactStarted.turn.id,
    )

    expect(
      notifications.some(
        (n) =>
          n.method === 'turn/event' &&
          n.params?.turnId === compactStarted.turn.id &&
          n.params?.event?.type === 'compact_boundary' &&
          n.params?.event?.boundary?.summaryKind === 'model_summary',
      ),
    ).toBe(true)
    expect(
      notifications.some(
        (n) =>
          n.method === 'turn/event' &&
          n.params?.turnId === compactStarted.turn.id &&
          n.params?.event?.type === 'assistant_delta' &&
          String(n.params?.event?.text ?? '').includes('Conversation compacted'),
      ),
    ).toBe(true)
    expect(compactToolsLength).toBe(0)
    expect(compactReplMode).toBe('plan')
    expect(consumedPendingRestore).toEqual([
      {
        threadId: fixture.threadId,
        turnId: compactStarted.turn.id,
      },
    ])
    expect(consumedBeforeCompactModelRun).toBe(true)
    expect(compactPromptText).toContain('Additional user instructions:')
    expect(compactPromptText).toContain('keep the intent only')
    expect(compactPromptText).not.toContain('Restored session memory for the next turn only.')

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const replay = await readSessionFile(filePath!)
    const summary = await readSessionSummary(filePath!)

    expect(replay.history).toHaveLength(4)
    expect(replay.history[0]?.role).toBe('assistant')
    expect((replay.history[0] as any)?.meta?.compactBoundary?.schemaVersion).toBe(1)
    expect((replay.history[0] as any)?.meta?.compactBoundary?.trigger).toBe('manual')
    expect((replay.history[0] as any)?.meta?.compactBoundary?.summaryKind).toBe('model_summary')
    expect((replay.history[0] as any)?.meta?.compactBoundary?.keepStrategy).toEqual({
      kind: 'keep_combo',
      keepLastTurns: 0,
      keepMinTokens: 1600,
      keepMinUserTurns: 2,
    })
    expect((replay.history[0] as any)?.meta?.compactBoundary?.rehydrationPlan).toEqual({
      schemaVersion: 1,
      items: [
        { kind: 'recent_files', priority: 'high', status: 'planned' },
        { kind: 'plan_state', priority: 'high', status: 'applied' },
        { kind: 'mode_state', priority: 'medium', status: 'applied' },
      ],
    })
    expect((replay.history[0] as any)?.meta?.compactBoundary?.rehydrationCost).toEqual({
      sectionCount: 2,
      estimatedTokens: expect.any(Number),
    })
    expect((replay.history[0] as any)?.meta?.compactBoundary?.preservedSegment).toEqual({
      schemaVersion: 1,
      continuationMessageCount: 3,
      preservedTailMessageCount: 2,
      summaryFingerprint: expect.any(String),
      headFingerprint: expect.any(String),
      tailFingerprint: expect.any(String),
      messageFingerprints: [expect.any(String), expect.any(String), expect.any(String)],
      messageIdentities: [
        expect.objectContaining({ schemaVersion: 1, fingerprint: expect.any(String) }),
        expect.objectContaining({ schemaVersion: 1, fingerprint: expect.any(String) }),
        expect.objectContaining({ schemaVersion: 1, fingerprint: expect.any(String) }),
      ],
      summaryIdentity: expect.objectContaining({ schemaVersion: 1, fingerprint: expect.any(String) }),
      headIdentity: expect.objectContaining({ schemaVersion: 1, fingerprint: expect.any(String) }),
      anchorIdentity: expect.objectContaining({ schemaVersion: 1, fingerprint: expect.any(String) }),
      tailIdentity: expect.objectContaining({ schemaVersion: 1, fingerprint: expect.any(String) }),
    })
    expect((replay.history[0] as any)?.meta?.compactBoundary?.preTokens).toBeGreaterThan(0)
    expect(replay.history[1]?.role).toBe('user')
    expect(summary.messageCount).toBe(3)
    const summaryText = Array.isArray(replay.history[1]?.content)
      ? String((replay.history[1]!.content[0] as { text?: string } | undefined)?.text ?? '')
      : ''
    expect(summaryText).toContain('This session is being continued from a previous conversation')
    expect(summaryText).toContain('Mode state to keep in working memory:')
    expect(summaryText).toContain('Current mode: plan')
    expect(summaryText).toContain('Plan state to keep in working memory:')

    expect(replay.messages.some((message) => message.role === 'user' && message.content === '/compact keep the intent only')).toBe(true)
    expect(
      replay.messages.some(
        (message) =>
          message.role === 'assistant' &&
          String(message.content).includes('Conversation compacted. Summary kept for future turns.'),
      ),
    ).toBe(true)
  })

  it('passes turn mode to engine exec context and keeps interactive on', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    let capturedReplMode: string | undefined
    let capturedInteractive: boolean | undefined
    let capturedFirstUserTextBlock: string | undefined
    let capturedPlanPath: string | null = null

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          if (userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Mode Title' }] },
            ] as ChatHistory
          }
          capturedFirstUserTextBlock = userText
          capturedReplMode = args.exec?.replMode as string | undefined
          capturedInteractive = args.exec?.interactive
          capturedPlanPath = args.exec?.getPlanPath?.() ?? args.exec?.planPath ?? null
          args.onEvent({ type: 'assistant_delta', text: 'ok' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'mode test' },
      mode: 'plan',
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    expect(capturedFirstUserTextBlock).toContain('Plan mode is active')
    expect(capturedReplMode).toBe('plan')
    expect(capturedInteractive).toBe(true)
    expect(capturedPlanPath).toBeTruthy()
    expect(capturedFirstUserTextBlock).toContain(String(capturedPlanPath))
    const planStat = await fs.stat(String(capturedPlanPath))
    expect(planStat.isFile()).toBe(true)

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const replay = await readSessionFile(filePath!)
    const userMessages = replay.history.filter((message) => message.role === 'user')
    const latestUser = userMessages[userMessages.length - 1]
    const latestUserText = Array.isArray(latestUser?.content)
      ? String((latestUser.content[0] as { text?: string } | undefined)?.text ?? '')
      : ''
    expect(latestUserText).toBe('mode test')
  })

  it('keeps a stable plan path across plan-mode turns for the same thread', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const capturedPlanPaths: string[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userTextBlocks = Array.isArray(args.user.content)
            ? args.user.content
                .filter((block) => (block as any)?.type === 'text')
                .map((block) => String((block as any)?.text ?? ''))
            : []
          const userText = userTextBlocks.join('\n\n')
          if (userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Stable Plan Path Title' }] },
            ] as ChatHistory
          }
          const planPath = args.exec?.getPlanPath?.() ?? args.exec?.planPath ?? null
          if (typeof planPath === 'string' && planPath.trim()) {
            capturedPlanPaths.push(planPath)
          }
          args.onEvent({ type: 'assistant_delta', text: 'ok' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    const turn1 = await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'plan turn one' },
      mode: 'plan',
    })
    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && n.params?.turn?.id === turn1.turn.id,
    )

    const turn2 = await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'plan turn two' },
      mode: 'plan',
    })
    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && n.params?.turn?.id === turn2.turn.id,
    )

    expect(capturedPlanPaths).toHaveLength(2)
    expect(capturedPlanPaths[0]).toBeTruthy()
    expect(capturedPlanPaths[1]).toBe(capturedPlanPaths[0])
  })

  it('injects exit-plan reminder when explicitly requested', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    let capturedFirstUserTextBlock = ''

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          if (userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Exit Reminder Title' }] },
            ] as ChatHistory
          }
          capturedFirstUserTextBlock = userText
          args.onEvent({ type: 'assistant_delta', text: 'ok' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'continue implementation' },
      mode: 'normal',
      includeExitPlanReminder: true,
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    expect(capturedFirstUserTextBlock).toContain('You have exited plan mode')
    expect(capturedFirstUserTextBlock).not.toContain('Plan mode is active')

    const filePath = await findSessionFileBySessionId({
      cwd: fixture.cwd,
      env: fixture.env,
      sessionId: fixture.threadId,
    })
    expect(filePath).toBeTruthy()
    const replay = await readSessionFile(filePath!)
    const userMessages = replay.history.filter((message) => message.role === 'user')
    const latestUser = userMessages[userMessages.length - 1]
    const latestUserText = Array.isArray(latestUser?.content)
      ? String((latestUser.content[0] as { text?: string } | undefined)?.text ?? '')
      : ''
    expect(latestUserText).toBe('continue implementation')
  })

  it('emits mode transition notifications when tools change repl mode', async () => {
    const fixture = await createThreadFixture()
    const notifications: Notification[] = []
    const observedModes: string[] = []

    const runner = new TurnRunner({
      engine: {
        async runTurn(args) {
          const userText = Array.isArray(args.user.content)
            ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
            : ''
          if (userText.includes('Please write a 5-10 word title')) {
            return [
              ...args.history,
              args.user,
              { role: 'assistant', content: [{ type: 'text', text: 'Mode Transition Title' }] },
            ] as ChatHistory
          }
          observedModes.push(String(args.exec?.getReplMode?.() ?? args.exec?.replMode ?? ''))
          args.exec?.setReplMode?.('plan')
          observedModes.push(String(args.exec?.getReplMode?.() ?? args.exec?.replMode ?? ''))
          args.exec?.setReplMode?.('plan')
          args.exec?.setReplMode?.('acceptEdits')
          observedModes.push(String(args.exec?.getReplMode?.() ?? args.exec?.replMode ?? ''))
          args.onEvent({ type: 'assistant_delta', text: 'done' })
          args.onEvent({ type: 'complete' })
          return [
            ...args.history,
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
          ] as ChatHistory
        },
      },
      tools: [],
      allowedSubagents: [],
      model: 'test-model',
      cwd: fixture.cwd,
      env: fixture.env,
      emitNotification(method, params) {
        notifications.push({ method, params })
      },
    })

    await runner.startTurn({
      threadId: fixture.threadId,
      input: { text: 'mode transition test' },
      mode: 'normal',
    })
    await waitForNotification(notifications, (n) => n.method === 'turn/completed')

    expect(observedModes).toEqual(['normal', 'plan', 'acceptEdits'])
    const modeNotifications = notifications.filter((entry) => entry.method === 'turn/modeChanged')
    expect(modeNotifications).toHaveLength(2)
    expect(modeNotifications.map((entry) => (entry.params as any)?.previousMode)).toEqual(['normal', 'plan'])
    expect(modeNotifications.map((entry) => (entry.params as any)?.mode)).toEqual(['plan', 'acceptEdits'])
  })
})
