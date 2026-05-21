import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as sessionSave from '../features/repl/sessionSave/index.js'
import { findSessionFileBySessionId, SessionWriter } from '../features/repl/sessionSave/index.js'
import { DURABLE_SNIP_COMMITTED_EVENT_NAME } from '../features/repl/sessionSave/durableSnipStoreEvents.js'
import { writeSessionMemoryFile } from '../features/repl/sessionSave/sessionMemorySidecar.js'
import {
  buildAutoCompactKeepStrategy,
  buildCompactBoundaryMessage,
  fingerprintCompactBoundaryMessage,
  fingerprintPromptMessage,
} from '../chat/context/compact.js'
import { __threadStoreTestOnly, ThreadStore } from './threadStore.js'

async function createStore() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-'))
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-config-'))
  const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
  return {
    cwd,
    env,
    store: new ThreadStore({ cwd, env }),
  }
}

async function ensureThreadSessionFile(args: {
  cwd: string
  env: NodeJS.ProcessEnv
  threadId: string
  archived?: boolean
}): Promise<string> {
  const existing = await findSessionFileBySessionId({
    cwd: args.cwd,
    env: args.env,
    sessionId: args.threadId,
    ...(args.archived ? { archived: true } : {}),
  })
  if (existing) return existing

  const { writer, filePath } = await SessionWriter.createNew({
    cwd: args.cwd,
    env: args.env,
    sessionId: args.threadId,
  })
  await writer.shutdown()
  return filePath
}

describe('ThreadStore', () => {
  it('covers threadStore helper edge branches', async () => {
    expect(
      __threadStoreTestOnly.toThreadSummaryFromProvisional(
        {
          id: 'p1',
          cwd: '/tmp/p1',
          createdAt: '2026-02-08T00:00:00.000Z',
          updatedAt: '2026-02-08T00:00:00.000Z',
          label: null,
        },
        true,
        { archivedAt: '2026-02-09T00:00:00.000Z' },
      ).archivedAt,
    ).toBe('2026-02-09T00:00:00.000Z')
    expect(
      __threadStoreTestOnly.toThreadSummaryFromProvisional(
        {
          id: 'p2',
          cwd: '/tmp/p2',
          createdAt: '2026-02-08T00:00:00.000Z',
          updatedAt: '2026-02-08T00:00:00.000Z',
          label: null,
        },
        true,
      ).archivedAt,
    ).toBeNull()
    expect(__threadStoreTestOnly.flattenMessageText('not-array')).toBe('')
    expect(__threadStoreTestOnly.parseCursorOffset()).toBe(0)
    expect(__threadStoreTestOnly.parseCursorOffset('12')).toBe(12)
    expect(() => __threadStoreTestOnly.parseCursorOffset('9007199254740993')).toThrow(
      'non-negative integer offset',
    )

    expect(
      __threadStoreTestOnly.flattenMessageText([
        null,
        1,
        { type: 'tool_use', text: 'skip' },
        { type: 'text', text: 1 },
        { type: 'text', text: '  ' },
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ]),
    ).toBe('hello\n\nworld')

    const when = new Date('2026-02-08T00:00:00.000Z')
    expect(__threadStoreTestOnly.parseOccurredAtMs(when)).toBe(when.getTime())
    expect(__threadStoreTestOnly.parseOccurredAtMs('2026-02-08T00:00:00.000Z')).toBeGreaterThan(0)
    expect(__threadStoreTestOnly.parseOccurredAtMs('not-a-date')).toBe(0)

    expect(
      __threadStoreTestOnly.extractThreadMessages([
        null as any,
        { role: 'system', content: [{ type: 'text', text: 'skip' }] } as any,
        { role: 'user', content: [{ type: 'text', text: '' }] } as any,
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } as any,
      ] as any),
    ).toEqual([{ id: '0', kind: 'message', role: 'assistant', text: 'ok' }])
  })

  it('covers tool extraction and formatting helpers', () => {
    expect(__threadStoreTestOnly.formatToolParamsText({})).toBeUndefined()
    expect(__threadStoreTestOnly.formatToolParamsText({ a: 'x'.repeat(300) })).toContain('...')
    expect(__threadStoreTestOnly.parseToolUseInput(null)).toBeUndefined()
    expect(__threadStoreTestOnly.parseToolUseInput([])).toBeUndefined()
    expect(__threadStoreTestOnly.parseToolUseInput({ command: 'pwd' })).toEqual({ command: 'pwd' })
    expect(__threadStoreTestOnly.isNonEmptyRecord({})).toBe(false)
    expect(__threadStoreTestOnly.isNonEmptyRecord({ ok: true })).toBe(true)
    expect(__threadStoreTestOnly.choosePreferredInput(undefined, {}, { picked: 1 })).toEqual({ picked: 1 })
    expect(__threadStoreTestOnly.parseToolUseId('  ')).toBeUndefined()
    expect(__threadStoreTestOnly.parseToolUseId(1)).toBeUndefined()
    expect(__threadStoreTestOnly.parseToolUseId(' id-1 ')).toBe('id-1')
    expect(__threadStoreTestOnly.parseToolUseName(0)).toBeUndefined()
    expect(__threadStoreTestOnly.parseToolUseName('   ')).toBeUndefined()
    expect(__threadStoreTestOnly.parseToolUseName(' Edit ')).toBe('Edit')
    expect(
      __threadStoreTestOnly.resolveEditPatchStartLineNumber({
        cwd: process.cwd(),
        toolName: 'Edit',
      } as any),
    ).toBeUndefined()

    const details = __threadStoreTestOnly.collectToolDetailLines({
      content: ' summary ',
      toolInfo: {
        middleLines: ['  m1 ', '', 1, 'm1', 'm2'],
        result: '\nline-a\n \nline-b\n',
      },
    })
    expect(details).toEqual(['summary', 'm1', 'm2', 'line-a', 'line-b'])
    expect(__threadStoreTestOnly.collectToolDetailLines({ content: '   ' })).toEqual([])
    const capped = __threadStoreTestOnly.collectToolDetailLines({
      toolInfo: { result: Array.from({ length: 150 }, (_, i) => `line-${i}`).join('\n') },
    })
    expect(capped).toHaveLength(120)
    expect(__threadStoreTestOnly.mergeToolDetailLines(['a'], [' ', 'a', 'b'])).toEqual(['a', 'b'])
    expect(__threadStoreTestOnly.mergeToolDetailLines(undefined, ['   '])).toBeUndefined()
  })

  it('covers tool-use map extraction and ui timeline normalization helpers', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-thread-store-helpers-'))
    expect(
      __threadStoreTestOnly.extractToolUseInputById([
        { content: 'skip' } as any,
        {
          content: [
            null,
            { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'a.ts' } },
            { type: 'tool_use', id: ' ', name: 'skip' },
          ],
        } as any,
      ] as any).get('t1'),
    ).toEqual({ toolName: 'Edit', input: { file_path: 'a.ts' } })
    expect(
      __threadStoreTestOnly.extractToolUseInputById([
        {
          content: [{ type: 'tool_use', id: 't2', name: '   ' }],
        } as any,
      ] as any).get('t2'),
    ).toEqual({})

    expect(
      __threadStoreTestOnly.resolveEditPatchStartLineNumber({
        cwd,
        toolName: 'Bash',
        input: { command: 'pwd' },
      }),
    ).toBeUndefined()

    const timeline = __threadStoreTestOnly.extractThreadTimelineFromUi([
      null as any,
      { id: 'skip-role', role: 'system', content: 'x' },
      { id: 'skip-thinking', role: 'assistant', content: 'x', ui: { kind: 'thinking_block' } },
      { id: 'skip-non-string', role: 'assistant', content: [{ type: 'text', text: 'x' }] },
      { id: 'skip-empty', role: 'assistant', content: '   ' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: '2026-02-08T00:00:00.000Z' },
      {
        id: 'tool-1',
        role: 'tool',
        content: 'done',
        toolInfo: { name: 'Read', toolUseId: 'call-1', status: 'error' },
      },
      {
        id: 2,
        role: 'tool',
        content: '',
        toolInfo: { name: 'Read', status: 'error' },
      } as any,
      {
        id: 3,
        role: 'tool',
        content: '',
        toolInfo: { name: 'Read', status: 'running' },
      } as any,
      {
        id: 4,
        role: 'tool',
        content: '',
        toolInfo: { name: 'Read', status: 'completed' },
      } as any,
    ] as any)
    expect(timeline.map((entry) => entry.item)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'message', id: 'u1', role: 'user', text: 'hello' }),
        expect.objectContaining({ kind: 'tool', id: 'tool-1', toolUseId: 'call-1', status: 'error' }),
      ]),
    )
  })

  it('renames persisted threads and handles missing-thread rename failures', async () => {
    const { cwd, env, store } = await createStore()
    const started = await store.startThread({})
    await ensureThreadSessionFile({ cwd, env, threadId: started.id })

    const renamed = await store.renameThread({ threadId: started.id, label: 'Persisted Rename' })
    expect(renamed.thread.label).toBe('Persisted Rename')
    await expect(store.renameThread({ threadId: 'missing-thread', label: 'x' })).rejects.toThrow(
      'Thread not found: missing-thread',
    )
  })

  it('returns existing file path in ensureThreadFile when thread file already exists', async () => {
    const { cwd, env, store } = await createStore()
    const started = await store.startThread({})
    const existing = await ensureThreadSessionFile({ cwd, env, threadId: started.id })

    const ensured = await store.ensureThreadFile({ threadId: started.id, cwd })
    expect(ensured).toBe(existing)

    const ensuredDefaultCwd = await store.ensureThreadFile({ threadId: started.id })
    expect(ensuredDefaultCwd).toBe(existing)
  })

  it('uses id tiebreak sort when thread updatedAt timestamps are equal', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-sort-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-config-sort-')) }
    const now = new Date('2026-02-08T00:00:00.000Z')
    const archiveStore = {
      locateThreadFile: vi.fn().mockResolvedValue(null),
      listThreads: vi.fn().mockResolvedValue([
        {
          meta: { sessionId: 'a-thread', cwd, startedAt: now.toISOString() },
          updatedAt: now,
          messageCount: 0,
          lastUserPrompt: null,
          label: null,
        },
        {
          meta: { sessionId: 'z-thread', cwd, startedAt: now.toISOString() },
          updatedAt: now,
          messageCount: 0,
          lastUserPrompt: null,
          label: null,
        },
      ]),
      archiveThread: vi.fn().mockResolvedValue(undefined),
      unarchiveThread: vi.fn().mockResolvedValue(undefined),
    }
    const store = new ThreadStore({ cwd, env, archiveStore: archiveStore as any })
    const out = await store.listThreads({ limit: 20 })
    expect(out.data.map((thread) => thread.id)).toEqual(['z-thread', 'a-thread'])
  })

  it('sorts threads by updatedAt descending when timestamps differ', async () => {
    const { store } = await createStore()
    const t1 = await store.startThread({})
    const t2 = await store.startThread({})
    const provisional = (store as any).provisionalThreads as Map<string, any>
    provisional.set(t1.id, { ...provisional.get(t1.id), updatedAt: '2026-02-08T00:00:00.000Z' })
    provisional.set(t2.id, { ...provisional.get(t2.id), updatedAt: '2026-02-08T00:00:10.000Z' })

    const out = await store.listThreads({ limit: 20 })
    expect(out.data.findIndex((thread) => thread.id === t2.id)).toBeLessThan(
      out.data.findIndex((thread) => thread.id === t1.id),
    )
  })

  it('covers default constructor paths without explicit cwd/env', async () => {
    const store = new ThreadStore()
    const started = await store.startThread({})
    expect(started.id).toBeTruthy()
    const inAltCwd = await store.startThread({ cwd: path.join(process.cwd(), 'subdir') })
    expect(inAltCwd.cwd).toContain('subdir')
  })

  it('covers ensure/list/archive fallback branches with mocked archive store', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-mock-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-config-mock-')) }
    const archiveStore = {
      locateThreadFile: vi.fn().mockResolvedValue(null),
      listThreads: vi.fn().mockResolvedValue([]),
      archiveThread: vi.fn().mockResolvedValue(undefined),
      unarchiveThread: vi.fn().mockResolvedValue(undefined),
    }
    const store = new ThreadStore({ cwd, env, archiveStore: archiveStore as any })

    const provisional = await store.startThread({})
    const emptyPage = await store.listThreadMessages({ threadId: provisional.id, limit: 20, cursor: '3' })
    expect(emptyPage).toEqual({
      data: [],
      nextCursor: null,
      latestCompactBoundary: null,
      durableSnip: null,
      latestRequestCollapse: null,
    })

    const fakeSummary = {
      id: provisional.id,
      cwd,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      lastUserPrompt: null,
      label: null,
      archivedAt: new Date().toISOString(),
    }
    const readSummarySpy = vi.spyOn(store as any, 'readThreadSummary').mockResolvedValue(fakeSummary)
    const archived = await store.archiveThread('unknown-thread-id')
    expect(archived.thread.id).toBe(fakeSummary.id)
    expect(archiveStore.archiveThread).toHaveBeenCalled()
    readSummarySpy.mockRestore()

    await expect((store as any).readThreadSummary('still-missing', false)).rejects.toThrow(
      'Thread not found: still-missing',
    )
    await expect(store.readThread('missing-thread')).rejects.toThrow('Thread not found: missing-thread')
    await expect(store.listThreadMessages({ threadId: 'missing-thread', limit: 10 })).rejects.toThrow(
      'Thread not found: missing-thread',
    )
  })

  it('supports provisional start/resume/read and persisted sessionSave', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    expect(thread.id).toBeTypeOf('string')
    expect(thread.cwd).toBe(cwd)

    const beforePersistPath = await findSessionFileBySessionId({ cwd, env, sessionId: thread.id })
    expect(beforePersistPath).toBeNull()

    const resumedBeforePersist = await store.resumeThread(thread.id)
    expect(resumedBeforePersist.thread.id).toBe(thread.id)
    expect(resumedBeforePersist.staleInputs).toEqual([])
    expect(resumedBeforePersist.latestCompactBoundary).toBeNull()
    expect(resumedBeforePersist.pendingSessionMemoryRestore).toBeNull()
    expect(resumedBeforePersist.nextTurnInjectedBlocks).toBeUndefined()

    const readBeforePersist = await store.readThread(thread.id)
    expect(readBeforePersist.thread.id).toBe(thread.id)
    expect(readBeforePersist.transcriptPreview).toEqual([])
    expect(readBeforePersist.latestRequestCollapse).toBeNull()

    const messagesBeforePersist = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    expect(messagesBeforePersist.data).toEqual([])
    expect(messagesBeforePersist.nextCursor).toBeNull()

    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendStableMsg({
      id: 'u1',
      role: 'user',
      content: 'hello thread',
      timestamp: new Date('2026-02-08T00:00:00.000Z'),
    })
    await writer.shutdown()

    const resumed = await store.resumeThread(thread.id)
    expect(resumed.thread.id).toBe(thread.id)
    expect(resumed.staleInputs).toEqual([])
    expect(resumed.latestCompactBoundary).toBeNull()
    expect(resumed.pendingSessionMemoryRestore).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        mode: 'normal',
      }),
    )
    expect(resumed.nextTurnInjectedBlocks).toHaveLength(1)

    const readOut = await store.readThread(thread.id)
    expect(readOut.thread.id).toBe(thread.id)
    expect(readOut.transcriptPreview).toEqual(
      expect.arrayContaining([{ role: 'user', text: 'hello thread' }]),
    )
    expect(readOut.latestCompactBoundary).toBeNull()
    expect(readOut.latestRequestCollapse).toBeNull()

    const messagesOut = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    expect(messagesOut.data).toEqual(
      expect.arrayContaining([{ id: expect.any(String), kind: 'message', role: 'user', text: 'hello thread' }]),
    )
    expect(messagesOut.nextCursor).toBeNull()
    expect(messagesOut.latestCompactBoundary).toBeNull()
    expect(messagesOut.latestRequestCollapse).toBeNull()
  })

  it('exposes latest compact boundary summary in thread/read and thread/messages', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'before compact' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        meta: {
          compactBoundary: {
            schemaVersion: 1,
            trigger: 'auto',
            triggerReason: { kind: 'auto_threshold' },
            preTokens: 2048,
            summaryKind: 'session_memory',
          },
        },
      },
      { role: 'assistant', content: [{ type: 'text', text: 'compact summary' }] },
    ] as any)
    await writer.shutdown()

    const readOut = await store.readThread(thread.id)
    expect(readOut.latestCompactBoundary).toEqual({
      schemaVersion: 1,
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 2048,
      summaryKind: 'session_memory',
    })

    const messagesOut = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    expect(messagesOut.latestCompactBoundary).toEqual({
      schemaVersion: 1,
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 2048,
      summaryKind: 'session_memory',
    })
  })

  it('exposes latest compact boundary summary in thread/resume', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'before compact' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        meta: {
          compactBoundary: {
            schemaVersion: 1,
            trigger: 'reactive',
            triggerReason: { kind: 'reactive_error', detail: 'maximum context length exceeded' },
            preTokens: 4096,
            summaryKind: 'model_summary',
          },
        },
      },
      { role: 'assistant', content: [{ type: 'text', text: 'compact summary' }] },
    ] as any)
    await writer.shutdown()

    const resumed = await store.resumeThread(thread.id)
    expect(resumed.latestCompactBoundary).toEqual({
      schemaVersion: 1,
      trigger: 'reactive',
      triggerReason: { kind: 'reactive_error', detail: 'maximum context length exceeded' },
      preTokens: 4096,
      summaryKind: 'model_summary',
    })
  })

  it('exposes latest request-time collapse summary in thread/resume', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendEvent('request_collapse_applied', {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      recapFingerprint: 'fedcba9876543210',
    })
    await writer.shutdown()

    const resumed = await store.resumeThread(thread.id)
    expect(resumed.latestRequestCollapse).toEqual({
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      recapFingerprint: 'fedcba9876543210',
    })
  })

  it('exposes latest request-time collapse summary in thread/read', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendEvent('request_collapse_applied', {
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 120,
      recapFingerprint: 'abcdef0123456789',
    })
    await writer.appendEvent('request_collapse_applied', {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      recapFingerprint: 'fedcba9876543210',
    })
    await writer.shutdown()

    const readOut = await store.readThread(thread.id)
    expect(readOut.latestRequestCollapse).toEqual({
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      recapFingerprint: 'fedcba9876543210',
    })
  })

  it('exposes latest request-time collapse summary in thread/messages', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'hello thread' }] },
    ] as any)
    await writer.appendEvent('request_collapse_applied', {
      phase: 'initial',
      collapsedHeadMessageCount: 4,
      estimatedTokensSaved: 140,
      recapFingerprint: '0123456789abcdef',
    })
    await writer.shutdown()

    const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    expect(out.latestRequestCollapse).toEqual({
      phase: 'initial',
      collapsedHeadMessageCount: 4,
      estimatedTokensSaved: 140,
      recapFingerprint: '0123456789abcdef',
    })
  })

  it('keeps compact boundary and request collapse facts aligned across read/messages/resume', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendStableMsg({
      id: 'u-cross-surface',
      role: 'user',
      content: 'cross-surface prompt',
      timestamp: new Date('2026-02-08T00:00:00.000Z'),
    })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'before compact' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        meta: {
          compactBoundary: {
            schemaVersion: 1,
            trigger: 'auto',
            triggerReason: { kind: 'auto_threshold' },
            preTokens: 4096,
            summaryKind: 'session_memory',
          },
        },
      },
      { role: 'user', content: [{ type: 'text', text: 'compacted summary' }] },
      { role: 'user', content: [{ type: 'text', text: 'post compact prompt' }] },
    ] as any)
    await writer.appendEvent('request_collapse_applied', {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 256,
      recapFingerprint: 'collapse-fingerprint-1',
    })
    await writer.shutdown()

    const expectedBoundary = {
      schemaVersion: 1,
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 4096,
      summaryKind: 'session_memory',
    }
    const expectedCollapse = {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 256,
      recapFingerprint: 'collapse-fingerprint-1',
    }

    const readOut = await store.readThread(thread.id)
    const messagesOut = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    const resumed = await store.resumeThread(thread.id)

    expect(readOut.latestCompactBoundary).toEqual(expectedBoundary)
    expect(messagesOut.latestCompactBoundary).toEqual(expectedBoundary)
    expect(resumed.latestCompactBoundary).toEqual(expectedBoundary)
    expect(readOut.latestRequestCollapse).toEqual(expectedCollapse)
    expect(messagesOut.latestRequestCollapse).toEqual(expectedCollapse)
    expect(resumed.latestRequestCollapse).toEqual(expectedCollapse)
    expect(messagesOut.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'message', role: 'user', text: 'cross-surface prompt' }),
      ]),
    )
  })

  it('hides request collapse facts that predate the latest compact boundary', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'before collapse' }] },
    ] as any)
    await writer.appendEvent('request_collapse_applied', {
      phase: 'initial',
      collapsedHeadMessageCount: 5,
      estimatedTokensSaved: 320,
      recapFingerprint: 'pre-compact-collapse',
    })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'before compact' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        meta: {
          compactBoundary: {
            schemaVersion: 1,
            trigger: 'auto',
            triggerReason: { kind: 'auto_threshold' },
            preTokens: 4096,
            summaryKind: 'session_memory',
          },
        },
      },
      { role: 'user', content: [{ type: 'text', text: 'compacted summary' }] },
    ] as any)
    await writer.shutdown()

    const readOut = await store.readThread(thread.id)
    const messagesOut = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    const resumed = await store.resumeThread(thread.id)

    expect(readOut.latestCompactBoundary).toEqual(
      expect.objectContaining({ trigger: 'auto', preTokens: 4096 }),
    )
    expect(readOut.latestRequestCollapse).toBeNull()
    expect(messagesOut.latestRequestCollapse).toBeNull()
    expect(resumed.latestRequestCollapse).toBeNull()
  })

  it('keeps request collapse facts that occur after the current compact boundary', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    const history = [
      { role: 'user', content: [{ type: 'text', text: 'before compact' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        meta: {
          compactBoundary: {
            schemaVersion: 1,
            trigger: 'auto',
            triggerReason: { kind: 'auto_threshold' },
            preTokens: 4096,
            summaryKind: 'session_memory',
          },
        },
      },
      { role: 'user', content: [{ type: 'text', text: 'compacted summary' }] },
    ] as any
    await writer.appendHistorySnapshot(history)
    await writer.appendEvent('request_collapse_applied', {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 128,
      recapFingerprint: 'post-compact-collapse',
    })
    await writer.appendHistorySnapshot([
      ...history,
      { role: 'assistant', content: [{ type: 'text', text: 'post-collapse answer' }] },
    ] as any)
    await writer.shutdown()

    const expectedCollapse = {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 128,
      recapFingerprint: 'post-compact-collapse',
    }

    const readOut = await store.readThread(thread.id)
    const messagesOut = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    const resumed = await store.resumeThread(thread.id)

    expect(readOut.latestRequestCollapse).toEqual(expectedCollapse)
    expect(messagesOut.latestRequestCollapse).toEqual(expectedCollapse)
    expect(resumed.latestRequestCollapse).toEqual(expectedCollapse)
  })

  it('inspects persisted request-time collapse events for a thread', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendEvent('request_collapse_applied', {
      phase: 'initial',
      collapsedHeadMessageCount: 4,
      estimatedTokensSaved: 140,
      recapFingerprint: '0123456789abcdef',
    })
    await writer.appendEvent('request_collapse_applied', {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      recapFingerprint: 'fedcba9876543210',
    })
    await writer.shutdown()

    const inspection = await store.inspectThreadRequestCollapse(thread.id)
    expect(inspection).toEqual({
      totalCount: 2,
      initialCount: 1,
      reactiveRetryCount: 1,
      totalEstimatedTokensSaved: 204,
      latest: {
        phase: 'reactive_retry',
        collapsedHeadMessageCount: 2,
        estimatedTokensSaved: 64,
        recapFingerprint: 'fedcba9876543210',
      },
    })
  })

  it('returns empty request-time collapse inspection for provisional threads without a file', async () => {
    const { store } = await createStore()
    const thread = await store.startThread({})
    const inspection = await store.inspectThreadRequestCollapse(thread.id)
    expect(inspection).toEqual({
      totalCount: 0,
      initialCount: 0,
      reactiveRetryCount: 0,
      totalEstimatedTokensSaved: 0,
      latest: null,
    })
  })

  it('best-effort refreshes rolling session memory on persisted thread resume', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendHistorySnapshot([
      { role: 'assistant', content: [{ type: 'text', text: 'hello thread' }] },
    ] as any)
    await writer.shutdown()

    const persistSpy = vi.fn(async () => undefined)
    const storeWithPersist = new ThreadStore({
      cwd,
      env,
      persistSessionMemoryForRestore: persistSpy,
    })

    const resumed = await storeWithPersist.resumeThread(thread.id)

    expect(resumed.thread.id).toBe(thread.id)
    expect(resumed.nextTurnInjectedBlocks).toBeUndefined()
    await vi.waitFor(() => {
      expect(persistSpy).toHaveBeenCalledWith({
        sessionFilePath: filePath,
        cwd,
        mode: 'normal',
        planPath: null,
        history: [{ role: 'assistant', content: [{ type: 'text', text: 'hello thread' }] }],
      })
    })

  })

  it('reuses sidecar mode and planPath when persisted thread resume falls back to default context', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendHistorySnapshot([
      { role: 'assistant', content: [{ type: 'text', text: 'hello thread' }] },
    ] as any)
    await writer.shutdown()
    await writeSessionMemoryFile({
      sessionFilePath: filePath,
      draft: {
        schemaVersion: 1,
        durableFacts: {
          workspaceRoot: cwd,
          projectMemoryPath: path.join(cwd, '.formax-memory', 'MEMORY.md'),
        },
        activeTask: {
          mode: 'plan',
          recentFiles: ['/repo/src/session.ts'],
          recentUserPrompts: ['Need restore reminder utility'],
          recentSkills: ['formax-dev-loop-workflow'],
          recentSubagentTypes: ['Explore'],
          recentDeferredToolNames: [],
          recentTaskHints: [],
          planPath: path.join(cwd, '.formax', 'resume-plan.md'),
          planExcerpt: null,
          todoSummary: null,
        },
        currentStrategy: {
          lastCompactTrigger: null,
          summaryKind: null,
          keepStrategy: null,
          rehydrationPlan: null,
        },
      },
    })

    const persistSpy = vi.fn(async () => undefined)
    const storeWithPersist = new ThreadStore({
      cwd,
      env,
      persistSessionMemoryForRestore: persistSpy,
    })

    const resumed = await storeWithPersist.resumeThread(thread.id)

    expect(resumed.thread.id).toBe(thread.id)
    expect(resumed.pendingSessionMemoryRestore).toEqual({
      schemaVersion: 1,
      mode: 'plan',
      recentFiles: ['/repo/src/session.ts'],
      recentUserPrompts: ['Need restore reminder utility'],
      recentSkills: ['formax-dev-loop-workflow'],
      recentSubagentTypes: ['Explore'],
      recentDeferredToolNames: [],
      recentTaskHints: [],
      planPath: path.join(cwd, '.formax', 'resume-plan.md'),
      planExcerpt: null,
      todoSummary: null,
    })
    expect(resumed.nextTurnInjectedBlocks).toHaveLength(1)
    expect(String((resumed.nextTurnInjectedBlocks?.[0] as any)?.text ?? '')).toContain(
      'Restored session memory for the next turn only:',
    )
    expect(String((resumed.nextTurnInjectedBlocks?.[0] as any)?.text ?? '')).toContain(
      path.join(cwd, '.formax', 'resume-plan.md'),
    )
    await vi.waitFor(() => {
      expect(persistSpy).toHaveBeenCalledWith({
        sessionFilePath: filePath,
        cwd,
        mode: 'plan',
        planPath: path.join(cwd, '.formax', 'resume-plan.md'),
        history: [{ role: 'assistant', content: [{ type: 'text', text: 'hello thread' }] }],
      })
    })
  })

  it('refreshes session memory before deriving thread/resume restore blocks', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'fresh user prompt from replay' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'fresh assistant answer from replay' }] },
    ] as any)
    await writer.shutdown()
    await writeSessionMemoryFile({
      sessionFilePath: filePath,
      draft: {
        schemaVersion: 1,
        durableFacts: {
          workspaceRoot: cwd,
          projectMemoryPath: path.join(cwd, '.formax-memory', 'MEMORY.md'),
        },
        activeTask: {
          mode: 'normal',
          recentFiles: [],
          recentUserPrompts: ['stale prompt from sidecar'],
          recentSkills: [],
          recentSubagentTypes: [],
          recentDeferredToolNames: [],
          recentTaskHints: [],
          planPath: null,
          planExcerpt: null,
          todoSummary: null,
        },
        currentStrategy: {
          lastCompactTrigger: null,
          summaryKind: null,
          keepStrategy: null,
          rehydrationPlan: null,
        },
      },
    })

    const persistSpy = vi.fn(async (args: any) => {
      await writeSessionMemoryFile({
        sessionFilePath: args.sessionFilePath,
        draft: {
          schemaVersion: 1,
          durableFacts: {
            workspaceRoot: cwd,
            projectMemoryPath: path.join(cwd, '.formax-memory', 'MEMORY.md'),
          },
          activeTask: {
            mode: args.mode,
            recentFiles: [],
            recentUserPrompts: ['fresh user prompt from replay'],
            recentSkills: [],
            recentSubagentTypes: [],
            recentDeferredToolNames: [],
            recentTaskHints: [],
            planPath: args.planPath,
            planExcerpt: null,
            todoSummary: null,
          },
          currentStrategy: {
            lastCompactTrigger: null,
            summaryKind: null,
            keepStrategy: null,
            rehydrationPlan: null,
          },
        },
      })
    })
    const storeWithPersist = new ThreadStore({
      cwd,
      env,
      persistSessionMemoryForRestore: persistSpy,
    })

    const resumed = await storeWithPersist.resumeThread(thread.id)

    expect(persistSpy).toHaveBeenCalledWith({
      sessionFilePath: filePath,
      cwd,
      mode: 'normal',
      planPath: null,
      history: [
        { role: 'user', content: [{ type: 'text', text: 'fresh user prompt from replay' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'fresh assistant answer from replay' }] },
      ],
    })
    expect(resumed.pendingSessionMemoryRestore?.recentUserPrompts).toEqual(['fresh user prompt from replay'])
    expect(String((resumed.nextTurnInjectedBlocks?.[0] as any)?.text ?? '')).toContain('fresh user prompt from replay')
    expect(String((resumed.nextTurnInjectedBlocks?.[0] as any)?.text ?? '')).not.toContain(
      'stale prompt from sidecar',
    )
  })

  it('returns restore blocks on first thread/resume when the sidecar is missing', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'first resume prompt from jsonl' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'first resume answer from jsonl' }] },
    ] as any)
    await writer.shutdown()

    const resumed = await store.resumeThread(thread.id)

    expect(resumed.pendingSessionMemoryRestore?.recentUserPrompts).toEqual(['first resume prompt from jsonl'])
    expect(String((resumed.nextTurnInjectedBlocks?.[0] as any)?.text ?? '')).toContain(
      'first resume prompt from jsonl',
    )
  })

  it('replays durable snip events into thread projection facts', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const boundary = buildCompactBoundaryMessage({
      trigger: 'auto',
      preTokens: 4096,
      summaryKind: 'model_summary',
      keepStrategy: buildAutoCompactKeepStrategy(2),
    })
    const writer = await SessionWriter.openExisting({ filePath })
    const olderAssistant = { role: 'assistant', content: [{ type: 'text', text: 'older assistant detail' }] }
    await writer.appendHistorySnapshot([
      boundary,
      { role: 'user', content: [{ type: 'text', text: 'compact summary' }] },
      olderAssistant,
      { role: 'assistant', content: [{ type: 'text', text: 'recent assistant detail' }] },
    ] as any)
    await writer.appendEvent(DURABLE_SNIP_COMMITTED_EVENT_NAME, {
      schemaVersion: 1,
      source: 'request_snip',
      compactBoundaryFingerprint: fingerprintCompactBoundaryMessage(boundary),
      removals: [
        {
          kind: 'model_facing_index_range',
          startIndex: 1,
          endIndexExclusive: 2,
          reason: 'remove older assistant detail',
          removedMessageFingerprints: [fingerprintPromptMessage(olderAssistant as any)],
        },
      ],
    })
    await writer.shutdown()

    const read = await store.readThread(thread.id)
    const messages = await store.listThreadMessages({ threadId: thread.id, limit: 20 })

    expect(read.durableSnip).toEqual({
      stage: 'snip',
      status: 'active',
      applied: true,
      reason: 'applied durable snip removals',
      removedMessageCount: 1,
      droppedOrphanToolBlockCount: 0,
      removalRangeCount: 1,
    })
    expect(messages.durableSnip).toEqual(read.durableSnip)
  })

  it('supports pagination in thread/list', async () => {
    const { store } = await createStore()
    await store.startThread({})
    await store.startThread({})
    await store.startThread({})

    const page1 = await store.listThreads({ limit: 2 })
    expect(page1.data).toHaveLength(2)
    expect(page1.nextCursor).toBeTruthy()

    const page2 = await store.listThreads({ limit: 2, cursor: page1.nextCursor ?? undefined })
    expect(page2.data.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects invalid cursor', async () => {
    const { store } = await createStore()
    await expect(store.listThreads({ limit: 10, cursor: 'bad-cursor' })).rejects.toThrow(
      'Invalid params.cursor',
    )
  })

  it('persists hidden thread group markers across store instances', async () => {
    const { cwd, env, store } = await createStore()
    const hiddenCwd = path.join(cwd, 'project-alpha')

    const firstHide = await store.hideThreadGroup(hiddenCwd)
    await store.hideThreadGroup(hiddenCwd)

    expect(firstHide.hiddenGroupCwds).toContain(path.resolve(hiddenCwd))
    const listed = await store.listThreads({ limit: 20 })
    expect(listed.hiddenGroupCwds).toContain(path.resolve(hiddenCwd))

    const reopenedStore = new ThreadStore({ cwd, env })
    const reopenedListed = await reopenedStore.listThreads({ limit: 20 })
    expect(reopenedListed.hiddenGroupCwds).toContain(path.resolve(hiddenCwd))
    expect(reopenedListed.hiddenGroupCwds?.filter((entry) => entry === path.resolve(hiddenCwd))).toHaveLength(1)
  })

  it('persists session_rename through thread/rename', async () => {
    const { store } = await createStore()
    const started = await store.startThread({})

    const renamed = await store.renameThread({ threadId: started.id, label: 'Renamed Thread' })
    expect(renamed.thread.id).toBe(started.id)
    expect(renamed.thread.label).toBe('Renamed Thread')

    const listed = await store.listThreads({ limit: 20 })
    const row = listed.data.find((thread) => thread.id === started.id)
    expect(row?.label).toBe('Renamed Thread')
  })

  it('preserves provisional createdAt/label when materializing thread file', async () => {
    const { store } = await createStore()
    const started = await store.startThread({})
    await store.renameThread({ threadId: started.id, label: 'Renamed Before First Turn' })

    const filePath = await store.ensureThreadFile({ threadId: started.id, cwd: started.cwd })
    expect(filePath).toBeTruthy()

    const listed = await store.listThreads({ limit: 20 })
    const row = listed.data.find((thread) => thread.id === started.id)
    expect(row?.label).toBe('Renamed Before First Turn')
    expect(row?.createdAt).toBe(started.createdAt)
  })

  it('supports pagination in thread/messages', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})

    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'u1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
      { role: 'user', content: [{ type: 'text', text: 'u2' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
    ] as any)
    await writer.shutdown()

    const page1 = await store.listThreadMessages({ threadId: thread.id, limit: 2 })
    expect(page1.data).toHaveLength(2)
    expect(page1.data[0]).toMatchObject({ kind: 'message', role: 'user', text: 'u2' })
    expect(page1.nextCursor).toBe('2')

    const page2 = await store.listThreadMessages({ threadId: thread.id, limit: 2, cursor: page1.nextCursor ?? undefined })
    expect(page2.data).toHaveLength(2)
    expect(page2.data[0]).toMatchObject({ kind: 'message', role: 'user', text: 'u1' })
    expect(page2.nextCursor).toBeNull()
  })

  it('avoids overlapping pages in thread/messages when total is not multiple of limit', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})

    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'u1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
      { role: 'user', content: [{ type: 'text', text: 'u2' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
      { role: 'user', content: [{ type: 'text', text: 'u3' }] },
    ] as any)
    await writer.shutdown()

    const page1 = await store.listThreadMessages({ threadId: thread.id, limit: 2 })
    expect(page1.data.map((msg) => msg.id)).toEqual(['3', '4'])
    expect(page1.nextCursor).toBe('3')

    const page2 = await store.listThreadMessages({ threadId: thread.id, limit: 2, cursor: page1.nextCursor ?? undefined })
    expect(page2.data.map((msg) => msg.id)).toEqual(['1', '2'])
    expect(page2.nextCursor).toBe('1')

    const page3 = await store.listThreadMessages({ threadId: thread.id, limit: 2, cursor: page2.nextCursor ?? undefined })
    expect(page3.data.map((msg) => msg.id)).toEqual(['0'])
    expect(page3.nextCursor).toBeNull()
  })

  it('hydrates legacy ui_msg-only tool rows in thread/messages when event rows are absent', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})

    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendStableMsg({
      id: 'u1',
      role: 'user',
      content: 'run type-check',
      timestamp: new Date('2026-02-08T00:00:00.000Z'),
    })
    await writer.appendStableMsg({
      id: 'tool-1',
      role: 'tool',
      content: 'Ran command for 3s',
      timestamp: new Date('2026-02-08T00:00:01.000Z'),
      toolInfo: {
        name: 'Bash',
        toolUseId: 'call-1',
        input: { command: 'npm run type-check' },
        status: 'completed',
        result: '> tsc --noEmit',
        middleLines: ['update', 'end'],
      },
    } as any)
    await writer.shutdown()

    const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    expect(out.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'u1',
          kind: 'message',
          role: 'user',
          text: 'run type-check',
        }),
      ]),
    )
    expect(out.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool',
          toolUseId: 'call-1',
          toolName: 'Bash',
          status: 'completed',
          summary: 'Ran command for 3s',
        }),
      ]),
    )
  })

  it('omits assistant thinking_block rows from thread/messages', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})

    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendStableMsg({
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: new Date('2026-02-08T00:00:00.000Z'),
    })
    await writer.appendStableMsg({
      id: 'thinking-1',
      role: 'assistant',
      content: 'internal thinking that should stay hidden',
      timestamp: new Date('2026-02-08T00:00:01.000Z'),
      ui: { kind: 'thinking_block' },
    } as any)
    await writer.appendStableMsg({
      id: 'a1',
      role: 'assistant',
      content: 'visible assistant message',
      timestamp: new Date('2026-02-08T00:00:02.000Z'),
    })
    await writer.shutdown()

    const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    const messageRows = out.data.filter((entry) => entry.kind === 'message')
    expect(messageRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'u1', role: 'user', text: 'hello' }),
        expect.objectContaining({ id: 'a1', role: 'assistant', text: 'visible assistant message' }),
      ]),
    )
    expect(messageRows.some((entry) => entry.id === 'thinking-1')).toBe(false)
    expect(
      messageRows.some(
        (entry) =>
          entry.role === 'assistant' &&
          typeof entry.text === 'string' &&
          entry.text.includes('internal thinking that should stay hidden'),
      ),
    ).toBe(false)
  })

  it('orders UI messages with persisted record timestamps so tools stay interleaved', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})

    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    const staleTimestamp = new Date('2026-02-08T00:00:00.000Z')

    await writer.appendStableMsg({
      id: 'a-before',
      role: 'assistant',
      content: 'before tool',
      timestamp: staleTimestamp,
    })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'tool-evt-ordered-1',
      toolName: 'Read',
      phase: 'start',
      status: 'running',
      summary: 'Read running',
    })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'tool-evt-ordered-1',
      toolName: 'Read',
      phase: 'end',
      status: 'completed',
      summary: 'Read 1 lines',
    })
    await writer.appendStableMsg({
      id: 'a-after',
      role: 'assistant',
      content: 'after tool',
      timestamp: staleTimestamp,
    })
    await writer.shutdown()

    const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    const beforeIndex = out.data.findIndex((entry) => entry.kind === 'message' && entry.id === 'a-before')
    const toolIndex = out.data.findIndex(
      (entry) => entry.kind === 'tool' && entry.toolUseId === 'tool-evt-ordered-1',
    )
    const afterIndex = out.data.findIndex((entry) => entry.kind === 'message' && entry.id === 'a-after')

    expect(beforeIndex).toBeGreaterThan(-1)
    expect(toolIndex).toBeGreaterThan(-1)
    expect(afterIndex).toBeGreaterThan(-1)
    expect(beforeIndex).toBeLessThan(toolIndex)
    expect(toolIndex).toBeLessThan(afterIndex)
  })

  it('hydrates tool rows from app_tool_event records when ui_msg has no tool role', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})

    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendStableMsg({
      id: 'u1',
      role: 'user',
      content: 'run command',
      timestamp: new Date('2026-02-08T00:00:00.000Z'),
    })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'tool-evt-1',
      toolName: 'Bash',
      phase: 'start',
      status: 'running',
      summary: 'Bash running',
    })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'tool-evt-1',
      toolName: 'Bash',
      phase: 'update',
      input: { command: 'npm run type-check' },
      paramsText: 'command="npm run type-check"',
      line: 'running...',
    })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'tool-evt-1',
      toolName: 'Bash',
      phase: 'end',
      status: 'completed',
      summary: 'Ran command for 3s',
      patchStartLineNumber: 22,
      lines: ['> tsc --noEmit'],
    })
    await writer.appendStableMsg({
      id: 'a1',
      role: 'assistant',
      content: 'done',
      timestamp: new Date('2026-02-08T00:00:02.000Z'),
    })
    await writer.shutdown()

    const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    expect(out.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'u1', kind: 'message', role: 'user', text: 'run command' }),
        expect.objectContaining({ id: 'a1', kind: 'message', role: 'assistant', text: 'done' }),
        expect.objectContaining({
          kind: 'tool',
          toolUseId: 'tool-evt-1',
          toolName: 'Bash',
          status: 'completed',
          summary: 'Ran command for 3s',
        }),
      ]),
    )
    const tool = out.data.find((entry) => (entry as any).toolUseId === 'tool-evt-1') as any
    expect(tool.input).toEqual({ command: 'npm run type-check' })
    expect(tool.patchStartLineNumber).toBe(22)
    expect(tool.paramsText).toBe('command="npm run type-check"')
    expect(tool.detailLines).toEqual(expect.arrayContaining(['running...', '> tsc --noEmit']))
  })

  it('adds persisted tool rows without UI entries and keeps stable sequence order', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendStableMsg({
      id: 'u1',
      role: 'user',
      content: 'run read',
      timestamp: new Date('2026-02-08T00:00:00.000Z'),
    })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'run read' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-extra-1', name: 'Read', input: { file_path: 'x.ts' } }],
      },
    ] as any)
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolName: 'Read',
      phase: 'start',
      status: 'running',
      summary: 'Read running',
    })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolName: 'Read',
      phase: 'end',
      status: 'completed',
      summary: 'Read done',
      lines: ['done'],
    })
    await writer.shutdown()

    const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    const tool = out.data.find((entry) => entry.kind === 'tool') as any
    expect(tool).toBeTruthy()
    expect(tool.toolName).toBe('Read')
    expect(tool.summary).toBe('Read done')
  })

  it('adds persisted tool row with toolUseId/input/params/patch and no detail lines', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendStableMsg({
      id: 'u1',
      role: 'user',
      content: 'run edit',
      timestamp: new Date('2026-02-08T00:00:00.000Z'),
    })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'tool-missing-ui-1',
      toolName: 'Edit',
      phase: 'update',
      input: { file_path: 'x.ts' },
      patchStartLineNumber: 10,
      paramsText: 'file_path=\"x.ts\"',
    })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'tool-missing-ui-1',
      toolName: 'Edit',
      phase: 'end',
      status: 'completed',
      summary: 'Edited x.ts',
    })
    await writer.shutdown()

    const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    const tool = out.data.find((entry) => (entry as any).toolUseId === 'tool-missing-ui-1') as any
    expect(tool.input).toEqual({ file_path: 'x.ts' })
    expect(tool.patchStartLineNumber).toBe(10)
    expect(tool.paramsText).toContain('file_path')
    expect(tool.detailLines).toEqual(expect.arrayContaining(['Edited x.ts']))
  })

  it('hydrates persisted tool rows into no-existing timeline path via replay mock', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'persisted-only-1',
      toolName: 'Edit',
      phase: 'update',
      input: { file_path: 'mock.ts' },
      patchStartLineNumber: 12,
      paramsText: 'file_path=\"mock.ts\"',
    })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'persisted-only-1',
      toolName: 'Edit',
      phase: 'end',
      status: 'completed',
      summary: 'done',
    })
    await writer.shutdown()

    const replaySpy = vi.spyOn(sessionSave, 'readSessionFile').mockResolvedValue({
      meta: { cwd, sessionId: thread.id },
      history: [],
      messages: [
        { id: 'm0', role: 'user', content: 'hello', timestamp: 'invalid-date' },
        { id: 'm1', role: 'assistant', content: 'world', timestamp: 'invalid-date' },
      ],
    } as any)
    try {
      const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
      const tool = out.data.find((entry) => (entry as any).toolUseId === 'persisted-only-1') as any
      expect(tool).toBeTruthy()
      expect(tool.input).toEqual({ file_path: 'mock.ts' })
      expect(tool.patchStartLineNumber).toBe(12)
      expect(tool.paramsText).toContain('file_path')
      expect(tool.detailLines).toBeUndefined()
    } finally {
      replaySpy.mockRestore()
    }
  })

  it('covers duplicate toolUseId map false branch and empty merged detailLines branch', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'dup-merged-none-1',
      toolName: 'Read',
      phase: 'end',
      status: 'completed',
      summary: 'done',
    })
    await writer.shutdown()

    const replaySpy = vi.spyOn(sessionSave, 'readSessionFile').mockResolvedValue({
      meta: { cwd, sessionId: thread.id },
      history: [],
      messages: [
        {
          id: 'tool-dup-a',
          role: 'tool',
          content: '',
          timestamp: '2026-02-08T00:00:00.000Z',
          toolInfo: { name: 'Read', toolUseId: 'dup-merged-none-1', status: 'running' },
        },
        {
          id: 'tool-dup-b',
          role: 'tool',
          content: '',
          timestamp: '2026-02-08T00:00:01.000Z',
          toolInfo: { name: 'Read', toolUseId: 'dup-merged-none-1', status: 'completed' },
        },
      ],
    } as any)
    try {
      const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
      const toolRows = out.data.filter((entry) => entry.kind === 'tool' && (entry as any).toolUseId === 'dup-merged-none-1')
      expect(toolRows.length).toBeGreaterThan(0)
      for (const row of toolRows as any[]) {
        expect(row.detailLines).toBeUndefined()
      }
    } finally {
      replaySpy.mockRestore()
    }
  })

  it('uses sequence fallback when timeline entries have non-positive occurredAtMs', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    const badDate = new Date('invalid-date')
    await writer.appendStableMsg({ id: 'm1', role: 'user', content: 'first', timestamp: badDate as any })
    await writer.appendStableMsg({ id: 'm2', role: 'assistant', content: 'second', timestamp: badDate as any })
    await writer.shutdown()

    const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    const ids = out.data.filter((entry) => entry.kind === 'message').map((entry) => entry.id)
    expect(ids).toEqual(expect.arrayContaining(['m1', 'm2']))
  })

  it('handles duplicate toolUseId entries from UI timeline without remapping twice', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendStableMsg({
      id: 'tool-a',
      role: 'tool',
      content: 'first',
      timestamp: new Date('2026-02-08T00:00:00.000Z'),
      toolInfo: { name: 'Read', toolUseId: 'dup-1', status: 'running' },
    } as any)
    await writer.appendStableMsg({
      id: 'tool-b',
      role: 'tool',
      content: 'second',
      timestamp: new Date('2026-02-08T00:00:01.000Z'),
      toolInfo: { name: 'Read', toolUseId: 'dup-1', status: 'completed' },
    } as any)
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'dup-1',
      toolName: 'Read',
      phase: 'end',
      status: 'completed',
      summary: 'done',
    })
    await writer.shutdown()

    const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    expect(out.data.some((entry) => entry.kind === 'tool' && (entry as any).toolUseId === 'dup-1')).toBe(true)
  })

  it('enriches existing ui tool rows with persisted app_tool_event input', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})

    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendStableMsg({
      id: 'tool-edit-1',
      role: 'tool',
      content: 'Edited demo.txt',
      timestamp: new Date('2026-02-08T00:00:01.000Z'),
      toolInfo: {
        name: 'Edit',
        toolUseId: 'edit-1',
        status: 'completed',
      },
    } as any)
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'edit-1',
      toolName: 'Edit',
      phase: 'update',
      input: {
        file_path: 'demo.txt',
        old_string: 'before',
        new_string: 'after',
      },
      line: 'patched',
    })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'edit-1',
      toolName: 'Edit',
      phase: 'end',
      status: 'completed',
      summary: 'Edited demo.txt',
    })
    await writer.shutdown()

    const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    const tool = out.data.find((entry) => (entry as any).toolUseId === 'edit-1') as any
    expect(tool).toBeTruthy()
    expect(tool.input).toEqual({
      file_path: 'demo.txt',
      old_string: 'before',
      new_string: 'after',
    })
    expect(tool.detailLines).toEqual(expect.arrayContaining(['Edited demo.txt', 'patched']))
  })

  it('hydrates Edit input and patch line from history tool_use when persisted tool input is missing', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})

    const demoFilePath = path.join(cwd, 'demo.txt')
    await fs.writeFile(demoFilePath, ['first line', 'patched line', 'last line'].join('\n'), 'utf8')

    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendStableMsg({
      id: 'u1',
      role: 'user',
      content: 'edit demo.txt',
      timestamp: new Date('2026-02-08T00:00:00.000Z'),
    })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'edit demo.txt' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'edit-hist-1',
            name: 'Edit',
            input: {
              file_path: 'demo.txt',
              old_string: 'old line',
              new_string: 'patched line',
            },
          },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'edit-hist-1', content: 'Edited demo.txt' }] },
    ] as any)
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'edit-hist-1',
      toolName: 'Edit',
      phase: 'start',
      status: 'running',
      summary: 'Edit running',
    })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'edit-hist-1',
      toolName: 'Edit',
      phase: 'update',
      paramsText: 'file_path="demo.txt", old_string="old line", new_string="patched line"',
    })
    await writer.appendEvent('app_tool_event', {
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'edit-hist-1',
      toolName: 'Edit',
      phase: 'end',
      status: 'completed',
      summary: 'Edited demo.txt',
    })
    await writer.shutdown()

    const out = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    const tool = out.data.find((entry) => (entry as any).toolUseId === 'edit-hist-1') as any
    expect(tool).toBeTruthy()
    expect(tool.input).toEqual({
      file_path: 'demo.txt',
      old_string: 'old line',
      new_string: 'patched line',
    })
    expect(tool.patchStartLineNumber).toBe(2)
  })

  it('uses overridden homedir consistently across start and resume', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-home-'))
    const homedir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-home-'))
    const env = { ...process.env }
    delete (env as any).FORMAX_CONFIG_DIR

    const store = new ThreadStore({ cwd, homedir, env, platform: process.platform })
    const started = await store.startThread({})
    const resumed = await store.resumeThread(started.id)
    expect(resumed.thread.id).toBe(started.id)
  })

  it('returns staleInputs on resume when unresolved app input events exist', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    const filePath = await ensureThreadSessionFile({ cwd, env, threadId: thread.id })
    const writer = await SessionWriter.openExisting({ filePath })
    await writer.appendEvent('app_input_requested', {
      inputId: 'turn-1:ask-1:ask_user_question',
      threadId: thread.id,
      turnId: 'turn-1',
      toolUseId: 'ask-1',
      kind: 'ask_user_question',
      createdAt: '2026-02-08T00:00:00.000Z',
      expiresAt: '2026-02-08T00:05:00.000Z',
    })
    await writer.shutdown()

    const resumed = await store.resumeThread(thread.id)
    expect(resumed.staleInputs).toHaveLength(1)
    expect(resumed.staleInputs[0]?.inputId).toBe('turn-1:ask-1:ask_user_question')
    expect(resumed.staleInputs[0]?.status).toBe('expired')
    expect(resumed.staleInputs[0]?.reason).toBe('server_restart')
  })

  it('archives provisional threads durably so they can be listed and restored', async () => {
    const { cwd, env, store } = await createStore()
    const started = await store.startThread({})

    const activeBeforeArchive = await findSessionFileBySessionId({ cwd, env, sessionId: started.id })
    expect(activeBeforeArchive).toBeNull()

    const archivedOut = await store.archiveThread(started.id)
    expect(archivedOut.thread.id).toBe(started.id)
    expect(archivedOut.thread.archivedAt).toBeTypeOf('string')

    const archivedPath = await findSessionFileBySessionId({
      cwd,
      env,
      sessionId: started.id,
      archived: true,
    })
    expect(archivedPath).toBeTruthy()

    const archivedList = await store.listThreads({ limit: 20, archived: true })
    expect(archivedList.data.some((thread) => thread.id === started.id)).toBe(true)

    const unarchivedOut = await store.unarchiveThread(started.id)
    expect(unarchivedOut.thread.id).toBe(started.id)
    expect(unarchivedOut.thread.archivedAt).toBeNull()

    const activeAgain = await findSessionFileBySessionId({ cwd, env, sessionId: started.id })
    expect(activeAgain).toBeTruthy()
  })

  it('does not re-materialize archived threads as active sessions', async () => {
    const { cwd, env, store } = await createStore()
    const started = await store.startThread({})
    await ensureThreadSessionFile({ cwd, env, threadId: started.id })
    await store.archiveThread(started.id)

    await expect(store.ensureThreadFile({ threadId: started.id, cwd })).rejects.toThrow(
      `Thread not found: ${started.id}`,
    )

    const activePath = await findSessionFileBySessionId({ cwd, env, sessionId: started.id })
    expect(activePath).toBeNull()
    const archivedPath = await findSessionFileBySessionId({
      cwd,
      env,
      sessionId: started.id,
      archived: true,
    })
    expect(archivedPath).toBeTruthy()
  })

  it('moves threads between active and archived storage', async () => {
    const { cwd, env, store } = await createStore()
    const started = await store.startThread({})

    await ensureThreadSessionFile({ cwd, env, threadId: started.id })
    const activePath = await findSessionFileBySessionId({ cwd, env, sessionId: started.id })
    expect(activePath).toBeTruthy()

    const archivedOut = await store.archiveThread(started.id)
    expect(archivedOut.thread.id).toBe(started.id)
    expect(archivedOut.thread.archivedAt).toBeTypeOf('string')

    const activeAfterArchive = await findSessionFileBySessionId({ cwd, env, sessionId: started.id })
    expect(activeAfterArchive).toBeNull()
    const archivedPath = await findSessionFileBySessionId({
      cwd,
      env,
      sessionId: started.id,
      archived: true,
    })
    expect(archivedPath).toBeTruthy()

    const archivedList = await store.listThreads({ limit: 20, archived: true })
    expect(archivedList.data.some((thread) => thread.id === started.id)).toBe(true)
    await expect(store.resumeThread(started.id)).rejects.toThrow('Thread not found')

    const unarchivedOut = await store.unarchiveThread(started.id)
    expect(unarchivedOut.thread.id).toBe(started.id)
    expect(unarchivedOut.thread.archivedAt).toBeNull()

    const activeAgain = await findSessionFileBySessionId({ cwd, env, sessionId: started.id })
    expect(activeAgain).toBeTruthy()
    const archivedAfterUnarchive = await findSessionFileBySessionId({
      cwd,
      env,
      sessionId: started.id,
      archived: true,
    })
    expect(archivedAfterUnarchive).toBeNull()
  })

  it('returns thread-not-found when unarchiving unknown thread id', async () => {
    const { store } = await createStore()
    await expect(store.unarchiveThread('missing-thread')).rejects.toThrow('Thread not found: missing-thread')
  })
})
