import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ChatHistory } from '../chat/engine.js'
import { buildCompressionProjectionGoldenFixture } from '../chat/context/compressionProjectionFixture.js'
import { buildContextProjection } from '../chat/context/contextProjection.js'
import * as commandRegistryModule from '../features/commands/registry.js'
import { SessionWriter } from '../features/repl/sessionSave/index.js'
import { createUserInputManager } from '../tools/runtime/userInputManager.js'
import { classifyRpcMessage, JSON_RPC_ERRORS } from './jsonrpc.js'
import type { Thread } from './protocol.js'
import { AppServer } from './server.js'
import { ThreadStore, type LatestRequestCollapseSummary, type ThreadDurableSnipSummary } from './threadStore.js'
import { TurnRunner } from './turnRunner.js'

function request(id: string | number | null, method: string, params?: unknown) {
  return classifyRpcMessage({
    jsonrpc: '2.0',
    id,
    method,
    ...(params === undefined ? {} : { params }),
  })
}

function durableSnipSummaryFromGoldenFixture(): ThreadDurableSnipSummary {
  const fixture = buildCompressionProjectionGoldenFixture()
  const projection = buildContextProjection({
    history: fixture.rawTranscript,
    durableState: fixture.durableState,
  })
  const snip = projection.durableState.snip
  return {
    stage: 'snip',
    status: snip.status,
    applied: snip.applied,
    reason: snip.reason,
    removedMessageCount: snip.removedMessageCount,
    droppedOrphanToolBlockCount: snip.droppedOrphanToolBlockCount,
    removalRangeCount: snip.removals.length,
  }
}

async function waitForNotification(
  notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }>,
  predicate: (n: { jsonrpc: '2.0'; method: string; params?: unknown }) => boolean,
  timeoutMs = 2500,
): Promise<{ jsonrpc: '2.0'; method: string; params?: unknown }> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = notifications.find(predicate)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for notification')
}

describe('AppServer', () => {
  it('maps invalid rpc envelopes to INVALID_REQUEST', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    const out = await server.handleMessage(classifyRpcMessage({ jsonrpc: '2.0', method: 1 as any }))
    expect(out).toHaveLength(1)
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST)
  })

  it('returns NOT_INITIALIZED for requests before initialize', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    const out = await server.handleMessage(request(1, 'thread/start'))
    expect(out).toHaveLength(1)
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.NOT_INITIALIZED)
    expect((out[0] as any).error.message).toBe('Not initialized')
  })

  it('handles initialize and then returns method not found for unknown methods', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })

    const init = await server.handleMessage(request(1, 'initialize', { clientInfo: { name: 'web', version: '1.0.0' } }))
    expect(init).toHaveLength(1)
    expect((init[0] as any).result.serverInfo).toEqual({ name: 'formax', version: 'test' })
    expect((init[0] as any).result.protocolVersion).toBe('0.2')
    expect((init[0] as any).result.serverInstanceId).toBeTypeOf('string')
    expect((init[0] as any).result.ui).toEqual({ showContextMeter: true })
    expect((init[0] as any).result.limits).toEqual(
      expect.objectContaining({
        maxRequestBytes: expect.any(Number),
        maxEventBytes: expect.any(Number),
        maxPendingInputsPerThread: expect.any(Number),
        defaultInputTtlMs: expect.any(Number),
        maxInFlightTurnsPerThread: 1,
      }),
    )

    const unknown = await server.handleMessage(request(2, 'unknown/method'))
    expect(unknown).toHaveLength(1)
    expect((unknown[0] as any).error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND)
  })

  it('returns configured initialize ui settings', async () => {
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      initializeUi: { showContextMeter: false },
    })

    const init = await server.handleMessage(request(1, 'initialize'))

    expect((init[0] as any).result.ui).toEqual({ showContextMeter: false })
  })

  it('validates initialize params', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    const out = await server.handleMessage(request(1, 'initialize', { clientInfo: { name: '', version: '1.0.0' } }))
    expect(out).toHaveLength(1)
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
  })

  it('accepts initialized notification after initialize', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    void (await server.handleMessage(request(1, 'initialize')))
    const out = await server.handleMessage(classifyRpcMessage({ jsonrpc: '2.0', method: 'initialized' }))
    expect(out).toEqual([])
    expect(server.getState().initializedNotified).toBe(true)
  })

  it('ignores initialized notification before initialize', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    const out = await server.handleMessage(classifyRpcMessage({ jsonrpc: '2.0', method: 'initialized' }))
    expect(out).toEqual([])
    expect(server.getState().initializedNotified).toBe(false)
  })

  it('routes thread methods to threadStore after initialize', async () => {
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const baseThread: Thread = {
      id: 't-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread(threadId) {
          return {
            thread: { ...baseThread, id: threadId },
            staleInputs: [],
            latestCompactBoundary: {
              schemaVersion: 1,
              trigger: 'reactive',
              triggerReason: { kind: 'reactive_error', detail: 'maximum context length exceeded' },
              preTokens: 1400,
              summaryKind: 'model_summary',
            },
            latestRequestCollapse: {
              phase: 'reactive_retry',
              collapsedHeadMessageCount: 4,
              estimatedTokensSaved: 256,
              recapFingerprint: 'feedface01234567',
            },
          }
        },
        async listThreads() {
          return { data: [{ ...baseThread, messageCount: 1, lastUserPrompt: 'hi', label: null }], nextCursor: null }
        },
        async readThread() {
          return {
            thread: baseThread,
            transcriptPreview: [{ role: 'user', text: 'hi' }],
            latestCompactBoundary: {
              schemaVersion: 1,
              trigger: 'manual',
              preTokens: 900,
              summaryKind: 'model_summary',
            },
            latestRequestCollapse: {
              phase: 'initial',
              collapsedHeadMessageCount: 3,
              estimatedTokensSaved: 120,
              recapFingerprint: 'abcdef0123456789',
            },
          }
        },
        async listThreadMessages() {
          return {
            data: [{ id: '0', kind: 'message', role: 'user', text: 'hi' }],
            nextCursor: null,
            latestCompactBoundary: {
              schemaVersion: 1,
              trigger: 'auto',
              triggerReason: { kind: 'auto_threshold' },
              preTokens: 1100,
              summaryKind: 'session_memory',
            },
            latestRequestCollapse: {
              phase: 'reactive_retry',
              collapsedHeadMessageCount: 2,
              estimatedTokensSaved: 64,
              recapFingerprint: 'fedcba9876543210',
            },
          }
        },
        async renameThread(params) {
          return {
            thread: {
              ...baseThread,
              id: params.threadId,
              messageCount: 1,
              lastUserPrompt: 'hi',
              label: params.label,
            },
          }
        },
        async hideThreadGroup(cwd) {
          return { hiddenGroupCwds: [cwd] }
        },
        async archiveThread(threadId) {
          return {
            thread: {
              ...baseThread,
              id: threadId,
              messageCount: 1,
              lastUserPrompt: 'hi',
              label: null,
              archivedAt: '2026-02-08T00:00:03.000Z',
            },
          }
        },
        async unarchiveThread(threadId) {
          return {
            thread: {
              ...baseThread,
              id: threadId,
              messageCount: 1,
              lastUserPrompt: 'hi',
              label: null,
              archivedAt: null,
            },
          }
        },
      },
      emitNotification(message) {
        notifications.push(message)
      },
    })

    await server.handleMessage(request(1, 'initialize'))

    const startOut = await server.handleMessage(request(2, 'thread/start'))
    expect((startOut[0] as any).result.thread.id).toBe('t-1')

    const resumeOut = await server.handleMessage(request(3, 'thread/resume', { threadId: 't-2' }))
    expect((resumeOut[0] as any).result.thread.id).toBe('t-2')
    expect((resumeOut[0] as any).result.latestCompactBoundary).toEqual({
      schemaVersion: 1,
      trigger: 'reactive',
      triggerReason: { kind: 'reactive_error', detail: 'maximum context length exceeded' },
      preTokens: 1400,
      summaryKind: 'model_summary',
    })
    expect((resumeOut[0] as any).result.latestRequestCollapse).toEqual({
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 4,
      estimatedTokensSaved: 256,
      recapFingerprint: 'feedface01234567',
    })
    expect(Object.prototype.hasOwnProperty.call((resumeOut[0] as any).result, 'durableToolResultContentReplacement')).toBe(false)

    const listOut = await server.handleMessage(request(4, 'thread/list', { limit: 10 }))
    expect((listOut[0] as any).result.data).toHaveLength(1)

    const readOut = await server.handleMessage(request(5, 'thread/read', { threadId: 't-1' }))
    expect((readOut[0] as any).result.transcriptPreview).toEqual([{ role: 'user', text: 'hi' }])
    expect((readOut[0] as any).result.latestCompactBoundary).toEqual({
      schemaVersion: 1,
      trigger: 'manual',
      preTokens: 900,
      summaryKind: 'model_summary',
    })
    expect((readOut[0] as any).result.latestRequestCollapse).toEqual({
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 120,
      recapFingerprint: 'abcdef0123456789',
    })
    expect(Object.prototype.hasOwnProperty.call((readOut[0] as any).result, 'durableToolResultContentReplacement')).toBe(false)

    const replayOut = await server.handleMessage(request(6, 'thread/replay', { threadId: 't-1' }))
    expect((replayOut[0] as any).result.latestCompactBoundary).toEqual({
      schemaVersion: 1,
      trigger: 'manual',
      preTokens: 900,
      summaryKind: 'model_summary',
    })
    expect((replayOut[0] as any).result.latestRequestCollapse).toEqual({
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 120,
      recapFingerprint: 'abcdef0123456789',
    })
    expect(Object.prototype.hasOwnProperty.call((replayOut[0] as any).result, 'durableToolResultContentReplacement')).toBe(false)

    const messagesOut = await server.handleMessage(request(6, 'thread/messages', { threadId: 't-1', limit: 2 }))
    expect((messagesOut[0] as any).result.data).toEqual([{ id: '0', kind: 'message', role: 'user', text: 'hi' }])
    expect((messagesOut[0] as any).result.latestCompactBoundary).toEqual({
      schemaVersion: 1,
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 1100,
      summaryKind: 'session_memory',
    })
    expect((messagesOut[0] as any).result.latestRequestCollapse).toEqual({
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      recapFingerprint: 'fedcba9876543210',
    })
    expect(Object.prototype.hasOwnProperty.call((messagesOut[0] as any).result, 'durableToolResultContentReplacement')).toBe(false)

    const renameOut = await server.handleMessage(
      request(8, 'thread/rename', { threadId: 't-1', label: 'Renamed in web' }),
    )
    expect((renameOut[0] as any).result.thread.id).toBe('t-1')
    expect((renameOut[0] as any).result.thread.label).toBe('Renamed in web')
    expect(notifications).toContainEqual(
      expect.objectContaining({
        jsonrpc: '2.0',
        method: 'thread/updated',
        params: expect.objectContaining({
          threadId: 't-1',
          replaySeq: expect.any(Number),
          thread: expect.objectContaining({ label: 'Renamed in web' }),
        }),
      }),
    )

    const hideOut = await server.handleMessage(request(8, 'thread/group/hide', { cwd: '/tmp/workspace' }))
    expect((hideOut[0] as any).result.hiddenGroupCwds).toEqual(['/tmp/workspace'])

    const archiveOut = await server.handleMessage(request(9, 'thread/archive', { threadId: 't-1', opId: 'op-1' }))
    expect((archiveOut[0] as any).result.thread.id).toBe('t-1')
    expect((archiveOut[0] as any).result.thread.archivedAt).toBe('2026-02-08T00:00:03.000Z')
    expect(notifications).toContainEqual(
      expect.objectContaining({
        jsonrpc: '2.0',
        method: 'thread/archived',
        params: expect.objectContaining({
          threadId: 't-1',
          opId: 'op-1',
          replaySeq: expect.any(Number),
        }),
      }),
    )

    const unarchiveOut = await server.handleMessage(request(10, 'thread/unarchive', { threadId: 't-1' }))
    expect((unarchiveOut[0] as any).result.thread.id).toBe('t-1')
    expect((unarchiveOut[0] as any).result.thread.archivedAt).toBeNull()
  })

  it('reuses cached latest compact boundary across replay page requests', async () => {
    const baseThread: Thread = {
      id: 'thread-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    let readThreadCount = 0
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread() {
          return { thread: baseThread, staleInputs: [], latestCompactBoundary: null, durableSnip: null }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          readThreadCount += 1
          return {
            thread: baseThread,
            transcriptPreview: [],
            latestCompactBoundary: {
              schemaVersion: 1,
              trigger: 'auto',
              preTokens: 1200,
              summaryKind: 'session_memory',
            },
            durableSnip: null,
            latestRequestCollapse: null,
          }
        },
        async listThreadMessages() {
          return { data: [], nextCursor: null, latestCompactBoundary: null, durableSnip: null, latestRequestCollapse: null }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))

    const baseline = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-1' }))
    expect((baseline[0] as any).result.latestCompactBoundary).toEqual({
      schemaVersion: 1,
      trigger: 'auto',
      preTokens: 1200,
      summaryKind: 'session_memory',
    })

    const page = await server.handleMessage(request(3, 'thread/replay', { threadId: 'thread-1', after: 0, limit: 10 }))
    expect((page[0] as any).result.latestCompactBoundary).toEqual({
      schemaVersion: 1,
      trigger: 'auto',
      preTokens: 1200,
      summaryKind: 'session_memory',
    })
    expect(readThreadCount).toBe(1)
  })

  it('does not treat omitted durable snip fact as an authoritative null replay cache', async () => {
    const baseThread: Thread = {
      id: 'thread-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const durableSnip: ThreadDurableSnipSummary = {
      stage: 'snip',
      status: 'active',
      applied: true,
      reason: 'applied durable snip removals',
      removedMessageCount: 1,
      droppedOrphanToolBlockCount: 0,
      removalRangeCount: 1,
    }
    let readThreadCount = 0
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread() {
          return { thread: baseThread, staleInputs: [], latestCompactBoundary: null }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          readThreadCount += 1
          return {
            thread: baseThread,
            transcriptPreview: [],
            latestCompactBoundary: null,
            ...(readThreadCount > 1 ? { durableSnip } : {}),
            latestRequestCollapse: null,
          }
        },
        async listThreadMessages() {
          return { data: [], nextCursor: null, latestCompactBoundary: null, latestRequestCollapse: null }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-1' }))
    const replayAfterDurableSnipAvailable = await server.handleMessage(
      request(3, 'thread/replay', { threadId: 'thread-1' }),
    )

    expect(readThreadCount).toBe(2)
    expect((replayAfterDurableSnipAvailable[0] as any).result.durableSnip).toEqual(durableSnip)
  })

  it('refreshes replay latestRequestCollapse after later turn notifications', async () => {
    const baseThread: Thread = {
      id: 'thread-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    let latestRequestCollapse: LatestRequestCollapseSummary | null = null
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread() {
          return { thread: baseThread, staleInputs: [], latestCompactBoundary: null, latestRequestCollapse }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          return {
            thread: baseThread,
            transcriptPreview: [],
            latestCompactBoundary: null,
            latestRequestCollapse,
          }
        },
        async listThreadMessages() {
          return { data: [], nextCursor: null, latestCompactBoundary: null, latestRequestCollapse }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const staleReplay = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-1' }))
    expect((staleReplay[0] as any).result.latestRequestCollapse).toBeNull()

    latestRequestCollapse = {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 96,
      recapFingerprint: 'fedcba9876543210',
    }
    server.createTurnNotificationEmitter()('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', threadId: 'thread-1', status: 'running' },
    })

    const refreshedReplay = await server.handleMessage(request(3, 'thread/replay', { threadId: 'thread-1' }))
    expect((refreshedReplay[0] as any).result.latestRequestCollapse).toEqual(latestRequestCollapse)
  })

  it('refreshes replay durable snip facts after later turn notifications', async () => {
    const baseThread: Thread = {
      id: 'thread-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    let durableSnip: ThreadDurableSnipSummary | null = null
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread() {
          return { thread: baseThread, staleInputs: [], latestCompactBoundary: null, durableSnip }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          return {
            thread: baseThread,
            transcriptPreview: [],
            latestCompactBoundary: null,
            durableSnip,
            latestRequestCollapse: null,
          }
        },
        async listThreadMessages() {
          return { data: [], nextCursor: null, latestCompactBoundary: null, durableSnip, latestRequestCollapse: null }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const staleReplay = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-1' }))
    expect((staleReplay[0] as any).result.durableSnip).toBeNull()

    durableSnip = {
      stage: 'snip',
      status: 'active',
      applied: true,
      reason: 'applied durable snip removals',
      removedMessageCount: 3,
      droppedOrphanToolBlockCount: 1,
      removalRangeCount: 2,
    }
    server.createTurnNotificationEmitter()('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', threadId: 'thread-1', status: 'running' },
    })

    const refreshedReplay = await server.handleMessage(request(3, 'thread/replay', { threadId: 'thread-1' }))
    expect((refreshedReplay[0] as any).result.durableSnip).toEqual(durableSnip)
  })

  it('keeps compact and collapse summaries consistent across resume, read, messages, and replay', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
    const threadId = 'thread-compact-parity'
    const expectedBoundary = {
      schemaVersion: 1,
      boundaryFingerprint: expect.any(String),
      trigger: 'reactive',
      triggerReason: { kind: 'reactive_error', detail: 'maximum context length exceeded' },
      preTokens: 4096,
      summaryKind: 'model_summary',
    }
    const expectedCollapse = {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 96,
      recapFingerprint: 'fedcba9876543210',
    }

    const { writer } = await SessionWriter.createNew({ cwd, env, sessionId: threadId })
    await writer.appendStableMsg({
      id: 'm1',
      role: 'user',
      content: 'continue after compact',
      timestamp: new Date('2026-02-08T00:00:00.000Z'),
    })
    await writer.appendHistorySnapshot([
      { role: 'user', content: [{ type: 'text', text: 'before compact' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        meta: { compactBoundary: expectedBoundary },
      },
      { role: 'assistant', content: [{ type: 'text', text: 'compact summary' }] },
      { role: 'user', content: [{ type: 'text', text: 'continue after compact' }] },
    ] as any)
    await writer.appendEvent('request_collapse_applied', expectedCollapse)
    await writer.shutdown()

    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: new ThreadStore({ cwd, env }),
    })
    await server.handleMessage(request(1, 'initialize'))

    const resumeOut = await server.handleMessage(request(2, 'thread/resume', { threadId }))
    const readOut = await server.handleMessage(request(3, 'thread/read', { threadId }))
    const messagesOut = await server.handleMessage(request(4, 'thread/messages', { threadId, limit: 10 }))
    const replayOut = await server.handleMessage(request(5, 'thread/replay', { threadId }))

    expect((resumeOut[0] as any).result.latestCompactBoundary).toEqual(expectedBoundary)
    expect((readOut[0] as any).result.latestCompactBoundary).toEqual(expectedBoundary)
    expect((messagesOut[0] as any).result.latestCompactBoundary).toEqual(expectedBoundary)
    expect((replayOut[0] as any).result.latestCompactBoundary).toEqual(expectedBoundary)
    expect((resumeOut[0] as any).result.latestRequestCollapse).toEqual(expectedCollapse)
    expect((readOut[0] as any).result.latestRequestCollapse).toEqual(expectedCollapse)
    expect((messagesOut[0] as any).result.latestRequestCollapse).toEqual(expectedCollapse)
    expect((replayOut[0] as any).result.latestRequestCollapse).toEqual(expectedCollapse)
  })

  it('updates replay latestCompactBoundary from live compact boundary turn events', async () => {
    const baseThread: Thread = {
      id: 'thread-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    let readThreadCount = 0
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread() {
          return { thread: baseThread, staleInputs: [], latestCompactBoundary: null, durableSnip: null }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          readThreadCount += 1
          return {
            thread: baseThread,
            transcriptPreview: [],
            latestCompactBoundary: null,
            durableSnip: null,
            latestRequestCollapse: null,
          }
        },
        async listThreadMessages() {
          return { data: [], nextCursor: null, latestCompactBoundary: null, durableSnip: null, latestRequestCollapse: null }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const boundary = {
      schemaVersion: 1,
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 2048,
      summaryKind: 'session_memory',
    }
    const newerBoundary = {
      schemaVersion: 1,
      trigger: 'manual',
      triggerReason: { kind: 'manual' },
      preTokens: 4096,
      summaryKind: 'transcript',
    }
    const emit = server.createTurnNotificationEmitter()
    emit('turn/event', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      event: {
        type: 'compact_boundary',
        boundary,
      },
    })
    emit('turn/event', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      event: {
        type: 'assistant_delta',
        text: 'Conversation compacted.',
      },
    })
    emit('turn/event', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      event: {
        type: 'compact_boundary',
        boundary: newerBoundary,
      },
    })

    const pendingBaselineReplayOut = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-1' }))
    expect((pendingBaselineReplayOut[0] as any).result.latestCompactBoundary).toBeNull()

    const staleReadOut = await server.handleMessage(request(2, 'thread/read', { threadId: 'thread-1' }))
    expect((staleReadOut[0] as any).result.latestCompactBoundary).toBeNull()

    const baselineReplayOut = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-1' }))
    expect((baselineReplayOut[0] as any).result.latestCompactBoundary).toBeNull()

    const partialReplayOut = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-1', after: 0, limit: 1 }))
    expect((partialReplayOut[0] as any).result.latestCompactBoundary).toBeNull()

    const replayOut = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-1', after: 0 }))
    expect((replayOut[0] as any).result.latestCompactBoundary).toEqual(newerBoundary)
    const nextCursor = (replayOut[0] as any).result.nextCursor
    expect(nextCursor).toBe(3)
    const emptyReplayAfterCursor = await server.handleMessage(
      request(2, 'thread/replay', { threadId: 'thread-1', after: nextCursor }),
    )
    expect((emptyReplayAfterCursor[0] as any).result.data).toEqual([])
    expect((emptyReplayAfterCursor[0] as any).result.latestCompactBoundary).toEqual(newerBoundary)
    expect(readThreadCount).toBe(2)

    emit('turn/failed', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', threadId: 'thread-1', status: 'failed' },
      error: 'compact failed before history persisted',
    })

    const replayAfterFailure = await server.handleMessage(request(3, 'thread/replay', { threadId: 'thread-1' }))
    expect((replayAfterFailure[0] as any).result.latestCompactBoundary).toBeNull()
    const partialFailedPage = await server.handleMessage(
      request(3, 'thread/replay', { threadId: 'thread-1', after: 0, limit: 1 }),
    )
    expect((partialFailedPage[0] as any).result.latestCompactBoundary).toBeNull()
    const replayFailedPage = await server.handleMessage(request(3, 'thread/replay', { threadId: 'thread-1', after: 0 }))
    expect((replayFailedPage[0] as any).result.latestCompactBoundary).toBeNull()
    expect(readThreadCount).toBe(3)
  })

  it('keeps live compact boundary after stale storage reads when the compact turn completes', async () => {
    const baseThread: Thread = {
      id: 'thread-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    let readThreadCount = 0
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread() {
          return { thread: baseThread, staleInputs: [], latestCompactBoundary: null, durableSnip: null }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          readThreadCount += 1
          return {
            thread: baseThread,
            transcriptPreview: [],
            latestCompactBoundary: null,
            durableSnip: null,
            latestRequestCollapse: null,
          }
        },
        async listThreadMessages() {
          return { data: [], nextCursor: null, latestCompactBoundary: null, durableSnip: null, latestRequestCollapse: null }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const boundary = {
      schemaVersion: 1,
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 2048,
      summaryKind: 'session_memory',
    }
    const emit = server.createTurnNotificationEmitter()
    emit('turn/event', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      event: {
        type: 'compact_boundary',
        boundary,
      },
    })

    const staleReadOut = await server.handleMessage(request(2, 'thread/read', { threadId: 'thread-1' }))
    expect((staleReadOut[0] as any).result.latestCompactBoundary).toBeNull()
    emit('turn/completed', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', threadId: 'thread-1', status: 'completed' },
    })

    const replayOut = await server.handleMessage(request(3, 'thread/replay', { threadId: 'thread-1' }))
    expect((replayOut[0] as any).result.latestCompactBoundary).toEqual(boundary)
    expect(readThreadCount).toBe(2)
  })

  it('restores previous compact boundary when a later live compact turn fails', async () => {
    const baseThread: Thread = {
      id: 'thread-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const previousBoundary = {
      schemaVersion: 1,
      trigger: 'manual',
      triggerReason: { kind: 'manual' },
      preTokens: 1024,
      summaryKind: 'model_summary',
    } as const
    let persistedBoundary: typeof previousBoundary | null = previousBoundary
    let readThreadCount = 0
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread() {
          return { thread: baseThread, staleInputs: [], latestCompactBoundary: null, durableSnip: null }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          readThreadCount += 1
          return {
            thread: baseThread,
            transcriptPreview: [],
            latestCompactBoundary: persistedBoundary,
            durableSnip: null,
            latestRequestCollapse: null,
          }
        },
        async listThreadMessages() {
          return { data: [], nextCursor: null, latestCompactBoundary: null, durableSnip: null, latestRequestCollapse: null }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))
    await server.handleMessage(request(2, 'thread/read', { threadId: 'thread-1' }))
    persistedBoundary = null

    const emit = server.createTurnNotificationEmitter()
    emit('turn/event', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      event: {
        type: 'compact_boundary',
        boundary: {
          schemaVersion: 1,
          trigger: 'auto',
          triggerReason: { kind: 'auto_threshold' },
          preTokens: 2048,
          summaryKind: 'session_memory',
        },
      },
    })
    emit('turn/failed', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', threadId: 'thread-1', status: 'failed' },
      error: 'compact failed before history persisted',
    })

    const replayOut = await server.handleMessage(request(3, 'thread/replay', { threadId: 'thread-1' }))
    expect((replayOut[0] as any).result.latestCompactBoundary).toEqual(previousBoundary)
    expect(readThreadCount).toBe(2)
  })

  it('preserves replay compact boundary cache when thread/messages omits the fact', async () => {
    const baseThread: Thread = {
      id: 'thread-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const latestCompactBoundary = {
      schemaVersion: 1,
      trigger: 'manual',
      triggerReason: { kind: 'manual' },
      preTokens: 4096,
      summaryKind: 'model_summary',
    } as const
    let readThreadCount = 0
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread() {
          return { thread: baseThread, staleInputs: [], latestCompactBoundary, durableSnip: null }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          readThreadCount += 1
          return {
            thread: baseThread,
            transcriptPreview: [],
            latestCompactBoundary,
            durableSnip: null,
            latestRequestCollapse: null,
          }
        },
        async listThreadMessages() {
          return { data: [], nextCursor: null } as any
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const readOut = await server.handleMessage(request(2, 'thread/read', { threadId: 'thread-1' }))
    expect((readOut[0] as any).result.latestCompactBoundary).toEqual(latestCompactBoundary)
    await server.handleMessage(request(3, 'thread/messages', { threadId: 'thread-1' }))
    const replayOut = await server.handleMessage(request(4, 'thread/replay', { threadId: 'thread-1' }))

    expect((replayOut[0] as any).result.latestCompactBoundary).toEqual(latestCompactBoundary)
    expect(readThreadCount).toBe(1)
  })

  it('clears replay compact boundary cache when thread/messages returns explicit null', async () => {
    const baseThread: Thread = {
      id: 'thread-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const latestCompactBoundary = {
      schemaVersion: 1,
      trigger: 'manual',
      triggerReason: { kind: 'manual' },
      preTokens: 4096,
      summaryKind: 'model_summary',
    } as const
    let readThreadCount = 0
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread() {
          return { thread: baseThread, staleInputs: [], latestCompactBoundary, durableSnip: null }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          readThreadCount += 1
          return {
            thread: baseThread,
            transcriptPreview: [],
            latestCompactBoundary,
            durableSnip: null,
            latestRequestCollapse: null,
          }
        },
        async listThreadMessages() {
          return { data: [], nextCursor: null, latestCompactBoundary: null, durableSnip: null, latestRequestCollapse: null }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const readOut = await server.handleMessage(request(2, 'thread/read', { threadId: 'thread-1' }))
    expect((readOut[0] as any).result.latestCompactBoundary).toEqual(latestCompactBoundary)
    await server.handleMessage(request(3, 'thread/messages', { threadId: 'thread-1' }))
    const replayOut = await server.handleMessage(request(4, 'thread/replay', { threadId: 'thread-1' }))

    expect((replayOut[0] as any).result.latestCompactBoundary).toBeNull()
    expect(readThreadCount).toBe(1)
  })

  it('surfaces persisted compact and request-collapse facts in thread/replay', async () => {
    const baseThread: Thread = {
      id: 'thread-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const latestCompactBoundary = {
      schemaVersion: 1,
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 2048,
      summaryKind: 'session_memory',
    } as const
    const latestRequestCollapse: LatestRequestCollapseSummary = {
      phase: 'initial',
      collapsedHeadMessageCount: 5,
      estimatedTokensSaved: 512,
      recapFingerprint: 'replay-collapse-fingerprint',
    }
    const durableSnip: ThreadDurableSnipSummary = {
      stage: 'snip',
      status: 'active',
      applied: true,
      reason: 'applied durable snip removals',
      removedMessageCount: 2,
      droppedOrphanToolBlockCount: 1,
      removalRangeCount: 1,
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread() {
          return {
            thread: baseThread,
            staleInputs: [],
            latestCompactBoundary,
            durableSnip,
            latestRequestCollapse,
          }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          return {
            thread: baseThread,
            transcriptPreview: [],
            latestCompactBoundary,
            durableSnip,
            latestRequestCollapse,
          }
        },
        async listThreadMessages() {
          return {
            data: [],
            nextCursor: null,
            latestCompactBoundary,
            durableSnip,
            latestRequestCollapse,
          }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const replayOut = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-1' }))
    expect((replayOut[0] as any).result.latestCompactBoundary).toEqual(latestCompactBoundary)
    expect((replayOut[0] as any).result.durableSnip).toEqual(durableSnip)
    expect((replayOut[0] as any).result.latestRequestCollapse).toEqual(latestRequestCollapse)
  })

  it('hydrates thread/replay compression facts from one readThread projection', async () => {
    const baseThread: Thread = {
      id: 'thread-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const latestCompactBoundary = {
      schemaVersion: 1,
      trigger: 'manual',
      preTokens: 900,
      summaryKind: 'model_summary',
    } as const
    const latestRequestCollapse: LatestRequestCollapseSummary = {
      phase: 'initial',
      collapsedHeadMessageCount: 4,
      estimatedTokensSaved: 128,
      recapFingerprint: 'single-read-collapse',
    }
    const durableSnip: ThreadDurableSnipSummary = {
      stage: 'snip',
      status: 'active',
      applied: true,
      reason: 'applied durable snip removals',
      removedMessageCount: 1,
      droppedOrphanToolBlockCount: 0,
      removalRangeCount: 1,
    }
    let readThreadCount = 0
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread() {
          return {
            thread: baseThread,
            staleInputs: [],
            latestCompactBoundary,
            durableSnip,
            latestRequestCollapse,
          }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          readThreadCount += 1
          return {
            thread: baseThread,
            transcriptPreview: [],
            latestCompactBoundary,
            durableSnip,
            latestRequestCollapse,
          }
        },
        async listThreadMessages() {
          return {
            data: [],
            nextCursor: null,
            latestCompactBoundary,
            durableSnip,
            latestRequestCollapse,
          }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const replayOut = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-1' }))

    expect(readThreadCount).toBe(1)
    expect((replayOut[0] as any).result.latestCompactBoundary).toEqual(latestCompactBoundary)
    expect((replayOut[0] as any).result.durableSnip).toEqual(durableSnip)
    expect((replayOut[0] as any).result.latestRequestCollapse).toEqual(latestRequestCollapse)
  })

  it('keeps compression golden fixture facts identical across read, messages, and replay', async () => {
    const fixture = buildCompressionProjectionGoldenFixture()
    const projection = buildContextProjection({
      history: fixture.rawTranscript,
      durableState: fixture.durableState,
    })
    const baseThread: Thread = {
      id: 'thread-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const latestCompactBoundary = projection.facts.latestCompactBoundary
    const durableSnip = durableSnipSummaryFromGoldenFixture()
    const latestRequestCollapse = fixture.requestCollapseEvent
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread() {
          return {
            thread: baseThread,
            staleInputs: [],
            latestCompactBoundary,
            durableSnip,
            latestRequestCollapse,
            pendingSessionMemoryRestore: fixture.pendingSessionMemoryRestore,
          }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          return {
            thread: baseThread,
            transcriptPreview: [{ role: 'user' as const, text: 'recent user request' }],
            latestCompactBoundary,
            durableSnip,
            latestRequestCollapse,
          }
        },
        async listThreadMessages() {
          return {
            data: [{ id: 'm1', kind: 'message' as const, role: 'assistant' as const, text: 'recent assistant answer' }],
            nextCursor: null,
            latestCompactBoundary,
            durableSnip,
            latestRequestCollapse,
          }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const readOut = await server.handleMessage(request(2, 'thread/read', { threadId: 'thread-1' }))
    const messagesOut = await server.handleMessage(request(3, 'thread/messages', { threadId: 'thread-1' }))
    const replayOut = await server.handleMessage(request(4, 'thread/replay', { threadId: 'thread-1' }))
    const resumeOut = await server.handleMessage(request(5, 'thread/resume', { threadId: 'thread-1' }))

    for (const out of [readOut, messagesOut, replayOut, resumeOut]) {
      expect((out[0] as any).result.latestCompactBoundary).toEqual(latestCompactBoundary)
      expect((out[0] as any).result.durableSnip).toEqual(durableSnip)
      expect((out[0] as any).result.latestRequestCollapse).toEqual(latestRequestCollapse)
    }
    expect((resumeOut[0] as any).result.pendingSessionMemoryRestore).toEqual(fixture.pendingSessionMemoryRestore)
  })

  it('maps thread store errors on start/resume/read to rpc errors', async () => {
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          throw new Error('start failed')
        },
        async resumeThread() {
          throw new Error('resume failed')
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          throw new Error('read failed')
        },
        async listThreadMessages() {
          return { data: [], nextCursor: null }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const startOut = await server.handleMessage(request(2, 'thread/start'))
    expect((startOut[0] as any).error.code).toBe(JSON_RPC_ERRORS.INTERNAL_ERROR)
    expect((startOut[0] as any).error.message).toContain('start failed')

    const resumeOut = await server.handleMessage(request(3, 'thread/resume', { threadId: 't-1' }))
    expect((resumeOut[0] as any).error.code).toBe(JSON_RPC_ERRORS.INTERNAL_ERROR)
    expect((resumeOut[0] as any).error.message).toContain('resume failed')

    const readOut = await server.handleMessage(request(4, 'thread/read', { threadId: 't-1' }))
    expect((readOut[0] as any).error.code).toBe(JSON_RPC_ERRORS.INTERNAL_ERROR)
    expect((readOut[0] as any).error.message).toContain('read failed')
  })

  it('validates thread/group/hide params', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'thread/group/hide', { cwd: '' }))
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((out[0] as any).error.message).toContain('params.cwd')
  })

  it('validates thread/messages params', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'thread/messages', { limit: 10 }))
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((out[0] as any).error.message).toContain('params.threadId')
  })

  it('validates thread/list archived param type', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'thread/list', { limit: 10, archived: 'yes' }))
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((out[0] as any).error.message).toContain('params.archived')
  })

  it('returns METHOD_NOT_FOUND for thread/rename when threadStore does not support rename', async () => {
    const baseThread: Thread = {
      id: 't-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread(threadId) {
          return { thread: { ...baseThread, id: threadId }, staleInputs: [] }
        },
        async listThreads() {
          return { data: [{ ...baseThread, messageCount: 1, lastUserPrompt: 'hi', label: null }], nextCursor: null }
        },
        async readThread() {
          return { thread: baseThread, transcriptPreview: [{ role: 'user', text: 'hi' }] }
        },
        async listThreadMessages() {
          return { data: [{ id: '0', kind: 'message', role: 'user', text: 'hi' }], nextCursor: null }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'thread/rename', { threadId: 't-1', label: 'new name' }))
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND)
    expect((out[0] as any).error.message).toBe('Method not found: thread/rename')
  })

  it('returns METHOD_NOT_FOUND for thread/group/hide when threadStore does not support it', async () => {
    const baseThread: Thread = {
      id: 't-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread(threadId) {
          return { thread: { ...baseThread, id: threadId }, staleInputs: [] }
        },
        async listThreads() {
          return { data: [{ ...baseThread, messageCount: 1, lastUserPrompt: 'hi', label: null }], nextCursor: null }
        },
        async readThread() {
          return { thread: baseThread, transcriptPreview: [{ role: 'user', text: 'hi' }] }
        },
        async listThreadMessages() {
          return { data: [{ id: '0', kind: 'message', role: 'user', text: 'hi' }], nextCursor: null }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'thread/group/hide', { cwd: '/tmp/workspace' }))
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND)
    expect((out[0] as any).error.message).toBe('Method not found: thread/group/hide')
  })

  it('returns METHOD_NOT_FOUND for archive endpoints when threadStore does not support them', async () => {
    const baseThread: Thread = {
      id: 't-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread(threadId) {
          return { thread: { ...baseThread, id: threadId }, staleInputs: [] }
        },
        async listThreads() {
          return { data: [{ ...baseThread, messageCount: 1, lastUserPrompt: 'hi', label: null }], nextCursor: null }
        },
        async readThread() {
          return { thread: baseThread, transcriptPreview: [{ role: 'user', text: 'hi' }] }
        },
        async listThreadMessages() {
          return { data: [{ id: '0', kind: 'message', role: 'user', text: 'hi' }], nextCursor: null }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const archiveOut = await server.handleMessage(request(2, 'thread/archive', { threadId: 't-1' }))
    expect((archiveOut[0] as any).error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND)
    expect((archiveOut[0] as any).error.message).toBe('Method not found: thread/archive')

    const unarchiveOut = await server.handleMessage(request(3, 'thread/unarchive', { threadId: 't-1' }))
    expect((unarchiveOut[0] as any).error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND)
    expect((unarchiveOut[0] as any).error.message).toBe('Method not found: thread/unarchive')
  })

  it('maps archive threadStore errors to rpc errors', async () => {
    const baseThread: Thread = {
      id: 't-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread(threadId) {
          return { thread: { ...baseThread, id: threadId }, staleInputs: [] }
        },
        async listThreads() {
          return { data: [{ ...baseThread, messageCount: 1, lastUserPrompt: 'hi', label: null }], nextCursor: null }
        },
        async readThread() {
          return { thread: baseThread, transcriptPreview: [{ role: 'user', text: 'hi' }] }
        },
        async listThreadMessages() {
          return { data: [{ id: '0', kind: 'message', role: 'user', text: 'hi' }], nextCursor: null }
        },
        async archiveThread() {
          throw new Error('archive failed')
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'thread/archive', { threadId: 't-1' }))
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INTERNAL_ERROR)
    expect((out[0] as any).error.message).toContain('archive failed')
  })

  it('maps turn/interrupt and turn/input/submit runner errors to rpc errors', async () => {
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn() {
          return { turnId: 'turn-1', acceptedAt: new Date().toISOString() }
        },
        async interruptTurn() {
          throw new Error('interrupt failed')
        },
        async submitInput() {
          throw new Error('submit failed')
        },
      } as any,
    })
    await server.handleMessage(request(1, 'initialize'))

    const interruptOut = await server.handleMessage(request(2, 'turn/interrupt', { threadId: 't-1', turnId: 'x' }))
    expect((interruptOut[0] as any).error.code).toBe(JSON_RPC_ERRORS.INTERNAL_ERROR)
    expect((interruptOut[0] as any).error.message).toContain('interrupt failed')

    const submitOut = await server.handleMessage(
      request(3, 'turn/input/submit', {
        threadId: 't-1',
        turnId: 'turn-1',
        inputId: 'ask-1',
        answers: { Choice: 'A' },
      }),
    )
    expect((submitOut[0] as any).error.code).toBe(JSON_RPC_ERRORS.INTERNAL_ERROR)
    expect((submitOut[0] as any).error.message).toContain('submit failed')
  })

  it('consumes pending exit-plan reminder after command/dispatch turn start success', async () => {
    const startTurn = vi.fn(async (_params: unknown) => ({ turnId: 'turn-1', acceptedAt: new Date().toISOString() }))
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        startTurn,
        async interruptTurn() {
          return { accepted: true, interrupted: false }
        },
        async submitInput() {
          return { accepted: true }
        },
      } as any,
      threadStore: {
        async startThread() {
          return {
            id: 't-1',
            cwd: '/tmp/workspace',
            createdAt: '2026-02-08T00:00:00.000Z',
            updatedAt: '2026-02-08T00:00:01.000Z',
          }
        },
        async resumeThread(threadId) {
          return {
            thread: {
              id: threadId,
              cwd: '/tmp/workspace',
              createdAt: '2026-02-08T00:00:00.000Z',
              updatedAt: '2026-02-08T00:00:01.000Z',
            },
            staleInputs: [],
          }
        },
        async listThreads() {
          return { data: [], nextCursor: null }
        },
        async readThread() {
          return {
            thread: {
              id: 't-1',
              cwd: '/tmp/workspace',
              createdAt: '2026-02-08T00:00:00.000Z',
              updatedAt: '2026-02-08T00:00:01.000Z',
            },
            transcriptPreview: [],
          }
        },
        async listThreadMessages() {
          return { data: [], nextCursor: null }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    ;(server as any).pendingExitPlanReminderByThreadId.set('t-1', true)
    await server.handleMessage(request(2, 'command/dispatch', { threadId: 't-1', command: '/compact keep summary' }))

    const call = (startTurn.mock.calls[0]?.[0] ?? {}) as { includeExitPlanReminder?: boolean }
    expect(call.includeExitPlanReminder).toBe(true)
    expect((server as any).pendingExitPlanReminderByThreadId.get('t-1')).toBeUndefined()
  })

  it('clears pending reminder when modeChanged keeps thread in plan mode', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    ;(server as any).pendingExitPlanReminderByThreadId.set('t-1', true)
    ;(server as any).captureReplayAndRuntimeState('turn/modeChanged', {
      threadId: 't-1',
      mode: 'plan',
      ts: new Date().toISOString(),
    })

    expect((server as any).pendingExitPlanReminderByThreadId.get('t-1')).toBeUndefined()
  })

  it('maps missing thread/unarchive target to INVALID_PARAMS', async () => {
    const baseThread: Thread = {
      id: 't-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread(threadId) {
          return { thread: { ...baseThread, id: threadId }, staleInputs: [] }
        },
        async listThreads() {
          return { data: [{ ...baseThread, messageCount: 1, lastUserPrompt: 'hi', label: null }], nextCursor: null }
        },
        async readThread() {
          return { thread: baseThread, transcriptPreview: [{ role: 'user', text: 'hi' }] }
        },
        async listThreadMessages() {
          return { data: [{ id: '0', kind: 'message', role: 'user', text: 'hi' }], nextCursor: null }
        },
        async archiveThread() {
          return { thread: { ...baseThread, messageCount: 1, lastUserPrompt: 'hi', label: null, archivedAt: null } }
        },
        async unarchiveThread() {
          throw new Error('Thread not found: missing-thread')
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'thread/unarchive', { threadId: 'missing-thread' }))
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((out[0] as any).error.message).toContain('Thread not found: missing-thread')
  })

  it('validates thread/rename params', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'thread/rename', { threadId: 't-1', label: '' }))
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((out[0] as any).error.message).toContain('params.label')
  })

  it('routes turn methods to turnRunner after initialize', async () => {
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          return { turn: { id: 'turn-1', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
      emitNotification(message) {
        notifications.push(message)
      },
    })

    await server.handleMessage(request(1, 'initialize'))

    const startOut = await server.handleMessage(
      request(2, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'hello' },
      }),
    )
    expect((startOut[0] as any).result.turn.status).toBe('running')

    const interruptOut = await server.handleMessage(
      request(3, 'turn/interrupt', { threadId: 'thread-1', turnId: 'turn-1' }),
    )
    expect((interruptOut[0] as any).result).toEqual({})

    const submitOut = await server.handleMessage(
      request(4, 'turn/input/submit', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        inputId: 'ask-1',
        answers: { Choice: 'A' },
      }),
    )
    expect((submitOut[0] as any).result).toEqual({ accepted: true, status: 'accepted' })

    const emit = server.createTurnNotificationEmitter()
    emit('turn/event', { threadId: 'thread-1' })
    expect(notifications).toContainEqual(
      expect.objectContaining({
        jsonrpc: '2.0',
        method: 'turn/event',
        params: expect.objectContaining({ threadId: 'thread-1', replaySeq: expect.any(Number) }),
      }),
    )
  })

  it('keeps the resolved turn runner bound to a started thread for interrupt and input follow-ups', async () => {
    const primaryRunner = {
      startTurn: vi.fn(async (params) => ({
        turn: { id: 'turn-1', threadId: params.threadId, status: 'running' as const },
      })),
      interruptTurn: vi.fn(async () => ({})),
      submitInput: vi.fn(async () => ({ accepted: true, status: 'accepted' as const })),
    }
    const fallbackRunner = {
      startTurn: vi.fn(async (params) => ({
        turn: { id: 'turn-fallback', threadId: params.threadId, status: 'running' as const },
      })),
      interruptTurn: vi.fn(async () => ({})),
      submitInput: vi.fn(async () => ({ accepted: true, status: 'accepted' as const })),
    }
    const resolveTurnRunner = vi.fn(async (args?: { cwd?: string; threadId?: string }) =>
      args?.cwd === '/special-cwd' ? primaryRunner : fallbackRunner,
    )
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      resolveTurnRunner,
    })

    await server.handleMessage(request(1, 'initialize'))

    const startOut = await server.handleMessage(
      request(2, 'turn/start', {
        threadId: 'thread-1',
        cwd: '/special-cwd',
        input: { text: 'hello' },
      }),
    )
    expect((startOut[0] as any).result.turn.id).toBe('turn-1')

    const interruptOut = await server.handleMessage(
      request(3, 'turn/interrupt', { threadId: 'thread-1', turnId: 'turn-1' }),
    )
    expect((interruptOut[0] as any).result).toEqual({})

    const submitOut = await server.handleMessage(
      request(4, 'turn/input/submit', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        inputId: 'ask-1',
        answers: { Choice: 'A' },
      }),
    )
    expect((submitOut[0] as any).result).toEqual({ accepted: true, status: 'accepted' })

    expect(resolveTurnRunner).toHaveBeenCalledTimes(1)
    expect(primaryRunner.startTurn).toHaveBeenCalledTimes(1)
    expect(primaryRunner.interruptTurn).toHaveBeenCalledTimes(1)
    expect(primaryRunner.submitInput).toHaveBeenCalledTimes(1)
    expect(fallbackRunner.interruptTurn).not.toHaveBeenCalled()
    expect(fallbackRunner.submitInput).not.toHaveBeenCalled()
  })

  it('adds exit-plan reminder flag when mode transitions from plan to non-plan on turn/start', async () => {
    let received: unknown = null
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          received = params
          return { turn: { id: 'turn-exit-plan', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))

    const emit = server.createTurnNotificationEmitter()
    emit('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-previous', threadId: 'thread-1', status: 'running', mode: 'plan' },
      ts: '2026-02-12T00:00:00.000Z',
    })

    const out = await server.handleMessage(
      request(2, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'implement now' },
        mode: 'normal',
      }),
    )

    expect((out[0] as any).result.turn.id).toBe('turn-exit-plan')
    expect(received).toEqual({
      threadId: 'thread-1',
      input: { text: 'implement now' },
      mode: 'normal',
      includeExitPlanReminder: true,
    })
  })

  it('caches restore injected blocks from thread/resume and consumes them on the next turn only', async () => {
    const received: unknown[] = []
    const reminderBlock = {
      type: 'text',
      text: '<system-reminder>\nRestored session memory for the next turn only:\n- Plan path: /repo/.formax/plan.md\n</system-reminder>',
    }
    const pendingSessionMemoryRestore = {
      schemaVersion: 1,
      mode: 'plan',
      recentFiles: ['/repo/src/session.ts'],
      recentUserPrompts: ['Recover plan context'],
      recentSkills: ['formax-dev-loop-workflow'],
      recentSubagentTypes: ['Explore'],
      recentDeferredToolNames: ['Bash', 'Read'],
      recentTaskHints: ['Explore: audit restore state'],
      recentTaskContinuityHints: [],
      restoreDiagnostics: {
        schemaVersion: 1,
        status: 'pending',
        source: 'session_memory_sidecar',
        confidence: 'high',
      },
      planPath: '/repo/.formax/plan.md',
      planExcerpt: 'Finish restore utility',
      todoSummary: null,
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async resumeThread(threadId) {
          return {
            thread: {
              id: threadId,
              cwd: '/repo',
              createdAt: '2026-02-12T00:00:00.000Z',
              updatedAt: '2026-02-12T00:00:00.000Z',
            },
            staleInputs: [],
            pendingSessionMemoryRestore,
            nextTurnInjectedBlocks: [reminderBlock as any],
          }
        },
        async readThread() {
          return {
            thread: {
              id: 'thread-1',
              cwd: '/repo',
              createdAt: '2026-02-12T00:00:00.000Z',
              updatedAt: '2026-02-12T00:00:00.000Z',
            },
            transcriptPreview: [],
          } as any
        },
      } as any,
      turnRunner: {
        async startTurn(params) {
          received.push(params)
          await params.onPendingInjectedBlocksConsumed?.({
            threadId: params.threadId,
            turnId: `turn-${received.length}`,
          })
          return { turn: { id: `turn-${received.length}`, threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))

    const resumeOut = await server.handleMessage(request(2, 'thread/resume', { threadId: 'thread-1' }))
    expect((resumeOut[0] as any).result).toEqual({
      thread: {
        id: 'thread-1',
        cwd: '/repo',
        createdAt: '2026-02-12T00:00:00.000Z',
        updatedAt: '2026-02-12T00:00:00.000Z',
      },
      staleInputs: [],
      latestCompactBoundary: null,
      durableSnip: null,
      latestRequestCollapse: null,
      pendingSessionMemoryRestore,
    })

    const replayBeforeTurn = await server.handleMessage(request(25, 'thread/replay', { threadId: 'thread-1' }))
    expect((replayBeforeTurn[0] as any).result.pendingSessionMemoryRestore).toEqual(pendingSessionMemoryRestore)

    await server.handleMessage(
      request(3, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'first turn after resume' },
      }),
    )
    await server.handleMessage(
      request(4, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'second turn after resume' },
      }),
    )

    expect(received[0]).toEqual({
      threadId: 'thread-1',
      input: { text: 'first turn after resume' },
      pendingInjectedBlocks: [reminderBlock],
      onPendingInjectedBlocksConsumed: expect.any(Function),
    })
    expect(received[1]).toEqual({
      threadId: 'thread-1',
      input: { text: 'second turn after resume' },
    })

    const replayAfterConsumption = await server.handleMessage(request(45, 'thread/replay', { threadId: 'thread-1' }))
    expect((replayAfterConsumption[0] as any).result.pendingSessionMemoryRestore).toBeNull()
  })

  it('retains pending restore after turn/start accepts until injected blocks are consumed by dispatch', async () => {
    const received: unknown[] = []
    const reminderBlock = {
      type: 'text',
      text: '<system-reminder>\nRestored session memory for the next turn only.\n</system-reminder>',
    }
    const pendingSessionMemoryRestore = {
      schemaVersion: 1,
      mode: 'normal',
      recentFiles: [],
      recentUserPrompts: ['Recover context'],
      recentSkills: [],
      recentSubagentTypes: [],
      recentDeferredToolNames: [],
      recentTaskHints: [],
      planPath: null,
      planExcerpt: null,
      todoSummary: null,
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async resumeThread(threadId) {
          return {
            thread: {
              id: threadId,
              cwd: '/repo',
              createdAt: '2026-02-12T00:00:00.000Z',
              updatedAt: '2026-02-12T00:00:00.000Z',
            },
            staleInputs: [],
            pendingSessionMemoryRestore,
            nextTurnInjectedBlocks: [reminderBlock as any],
          }
        },
        async readThread() {
          return {
            thread: {
              id: 'thread-1',
              cwd: '/repo',
              createdAt: '2026-02-12T00:00:00.000Z',
              updatedAt: '2026-02-12T00:00:00.000Z',
            },
            transcriptPreview: [],
          } as any
        },
      } as any,
      turnRunner: {
        async startTurn(params) {
          received.push(params)
          return { turn: { id: `turn-${received.length}`, threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    await server.handleMessage(request(2, 'thread/resume', { threadId: 'thread-1' }))
    await server.handleMessage(
      request(3, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'accepted but not dispatched' },
      }),
    )

    const replayAfterAccepted = await server.handleMessage(request(4, 'thread/replay', { threadId: 'thread-1' }))
    expect((replayAfterAccepted[0] as any).result.pendingSessionMemoryRestore).toEqual(pendingSessionMemoryRestore)

    await (received[0] as any).onPendingInjectedBlocksConsumed({
      threadId: 'thread-1',
      turnId: 'turn-1',
    })

    const replayAfterDispatch = await server.handleMessage(request(5, 'thread/replay', { threadId: 'thread-1' }))
    expect((replayAfterDispatch[0] as any).result.pendingSessionMemoryRestore).toBeNull()
  })

  it('retains pending restore when turn/start fails before dispatch consumption and retries once', async () => {
    let startAttempts = 0
    const reminderBlock = {
      type: 'text',
      text: '<system-reminder>\nRestored session memory for the next turn only.\n</system-reminder>',
    }
    const pendingSessionMemoryRestore = {
      schemaVersion: 1,
      mode: 'normal',
      recentFiles: [],
      recentUserPrompts: ['Retry restore context'],
      recentSkills: [],
      recentSubagentTypes: [],
      recentDeferredToolNames: [],
      recentTaskHints: [],
      planPath: null,
      planExcerpt: null,
      todoSummary: null,
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async resumeThread(threadId) {
          return {
            thread: {
              id: threadId,
              cwd: '/repo',
              createdAt: '2026-02-12T00:00:00.000Z',
              updatedAt: '2026-02-12T00:00:00.000Z',
            },
            staleInputs: [],
            pendingSessionMemoryRestore,
            nextTurnInjectedBlocks: [reminderBlock as any],
          }
        },
        async readThread() {
          return {
            thread: {
              id: 'thread-1',
              cwd: '/repo',
              createdAt: '2026-02-12T00:00:00.000Z',
              updatedAt: '2026-02-12T00:00:00.000Z',
            },
            transcriptPreview: [],
          } as any
        },
      } as any,
      turnRunner: {
        async startTurn(params) {
          startAttempts += 1
          if (startAttempts === 1) {
            throw new Error('pre-dispatch failure')
          }
          await params.onPendingInjectedBlocksConsumed?.({
            threadId: params.threadId,
            turnId: 'turn-retry',
          })
          return { turn: { id: 'turn-retry', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    await server.handleMessage(request(2, 'thread/resume', { threadId: 'thread-1' }))

    const failed = await server.handleMessage(
      request(3, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'first attempt' },
      }),
    )
    expect((failed[0] as any).error.message).toContain('pre-dispatch failure')
    const replayAfterFailure = await server.handleMessage(request(4, 'thread/replay', { threadId: 'thread-1' }))
    expect((replayAfterFailure[0] as any).result.pendingSessionMemoryRestore).toEqual(pendingSessionMemoryRestore)

    await server.handleMessage(
      request(5, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'retry attempt' },
      }),
    )
    const replayAfterRetryDispatch = await server.handleMessage(request(6, 'thread/replay', { threadId: 'thread-1' }))
    expect((replayAfterRetryDispatch[0] as any).result.pendingSessionMemoryRestore).toBeNull()
  })

  it('clears pending restore when /compact dispatch consumes restore blocks', async () => {
    const reminderBlock = {
      type: 'text',
      text: '<system-reminder>\nRestored session memory for the next turn only.\n</system-reminder>',
    }
    const pendingSessionMemoryRestore = {
      schemaVersion: 1,
      mode: 'normal',
      recentFiles: [],
      recentUserPrompts: ['Compact after restore'],
      recentSkills: [],
      recentSubagentTypes: [],
      recentDeferredToolNames: [],
      recentTaskHints: [],
      planPath: null,
      planExcerpt: null,
      todoSummary: null,
    }
    let received: unknown = null
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async resumeThread(threadId) {
          return {
            thread: {
              id: threadId,
              cwd: '/repo',
              createdAt: '2026-02-12T00:00:00.000Z',
              updatedAt: '2026-02-12T00:00:00.000Z',
            },
            staleInputs: [],
            pendingSessionMemoryRestore,
            nextTurnInjectedBlocks: [reminderBlock as any],
          }
        },
        async readThread() {
          return {
            thread: {
              id: 'thread-1',
              cwd: '/repo',
              createdAt: '2026-02-12T00:00:00.000Z',
              updatedAt: '2026-02-12T00:00:00.000Z',
            },
            transcriptPreview: [],
          } as any
        },
      } as any,
      turnRunner: {
        async startTurn(params) {
          received = params
          await params.onPendingInjectedBlocksConsumed?.({
            threadId: params.threadId,
            turnId: 'turn-compact',
          })
          return { turn: { id: 'turn-compact', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    await server.handleMessage(request(2, 'thread/resume', { threadId: 'thread-1' }))
    const replayBeforeCompact = await server.handleMessage(request(3, 'thread/replay', { threadId: 'thread-1' }))
    expect((replayBeforeCompact[0] as any).result.pendingSessionMemoryRestore).toEqual(pendingSessionMemoryRestore)

    await server.handleMessage(request(4, 'command/dispatch', { threadId: 'thread-1', command: '/compact' }))

    expect(received).toEqual({
      threadId: 'thread-1',
      input: { text: '/compact' },
      pendingInjectedBlocks: [reminderBlock],
      onPendingInjectedBlocksConsumed: expect.any(Function),
    })
    const replayAfterCompact = await server.handleMessage(request(5, 'thread/replay', { threadId: 'thread-1' }))
    expect((replayAfterCompact[0] as any).result.pendingSessionMemoryRestore).toBeNull()
  })

  it('adds exit-plan reminder flag after tool-driven turn/modeChanged transition', async () => {
    const received: unknown[] = []
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          received.push(params)
          return { turn: { id: `turn-${received.length}`, threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const emit = server.createTurnNotificationEmitter()
    emit('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-previous', threadId: 'thread-1', status: 'running', mode: 'plan' },
      ts: '2026-02-12T00:00:00.000Z',
    })
    emit('turn/modeChanged', {
      threadId: 'thread-1',
      turnId: 'turn-previous',
      previousMode: 'plan',
      mode: 'normal',
      ts: '2026-02-12T00:00:01.000Z',
    })

    await server.handleMessage(
      request(2, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'first turn after exit plan mode' },
        mode: 'normal',
      }),
    )
    await server.handleMessage(
      request(3, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'second turn after exit plan mode' },
        mode: 'normal',
      }),
    )

    expect(received).toEqual([
      {
        threadId: 'thread-1',
        input: { text: 'first turn after exit plan mode' },
        mode: 'normal',
        includeExitPlanReminder: true,
      },
      {
        threadId: 'thread-1',
        input: { text: 'second turn after exit plan mode' },
        mode: 'normal',
      },
    ])
  })

  it('passes pending restore injected blocks into /context diagnostics after thread/resume', async () => {
    const reminderBlock = {
      type: 'text',
      text: '<system-reminder>\nRestored session memory for the next turn only:\n- Plan path: /repo/.formax/plan.md\n</system-reminder>',
    }
    const resolveContextDiagnostics = vi.fn(async () => ({
      stdout: 'Context diagnostics',
      diagnostics: {
        kind: 'formax.context_diagnostics' as const,
        schemaVersion: 1 as const,
        mode: 'normal',
        model: 'claude-3-5-sonnet-latest',
        latestCompactBoundary: null,
        projectionLayers: {} as any,
        contextMeterRaw: {} as any,
        snapshot: {} as any,
        nextTurnFixed: {} as any,
        notes: [],
      },
    }))
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async resumeThread(threadId) {
          return {
            thread: {
              id: threadId,
              cwd: '/repo/from-thread',
              createdAt: '2026-02-12T00:00:00.000Z',
              updatedAt: '2026-02-12T00:00:00.000Z',
            },
            staleInputs: [],
            nextTurnInjectedBlocks: [reminderBlock as any],
          }
        },
        async readThread() {
          return {
            thread: {
              id: 'thread-1',
              cwd: '/repo/from-thread',
              createdAt: '',
              updatedAt: '',
            },
            transcriptPreview: [],
          } as any
        },
      } as any,
      resolveContextDiagnostics,
    })

    await server.handleMessage(request(1, 'initialize'))
    await server.handleMessage(request(2, 'thread/resume', { threadId: 'thread-1' }))
    await server.handleMessage(request(3, 'command/dispatch', { threadId: 'thread-1', command: '/context' }))

    expect(resolveContextDiagnostics).toHaveBeenCalledWith({
      threadId: 'thread-1',
      cwd: '/repo/from-thread',
      mode: 'normal',
      modeExplicit: false,
      includeExitPlanReminder: false,
      nextTurnInjectedBlocks: [reminderBlock],
      format: 'text',
    })
  })

  it('does not apply pending exit-plan reminder when next turn re-enters plan mode', async () => {
    let received: unknown = null
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          received = params
          return { turn: { id: 'turn-plan-reentry', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const emit = server.createTurnNotificationEmitter()
    emit('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-previous', threadId: 'thread-1', status: 'running', mode: 'plan' },
      ts: '2026-02-12T00:00:00.000Z',
    })
    emit('turn/modeChanged', {
      threadId: 'thread-1',
      turnId: 'turn-previous',
      previousMode: 'plan',
      mode: 'normal',
      ts: '2026-02-12T00:00:01.000Z',
    })

    await server.handleMessage(
      request(2, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'go back to planning' },
        mode: 'plan',
      }),
    )

    expect(received).toEqual({
      threadId: 'thread-1',
      input: { text: 'go back to planning' },
      mode: 'plan',
    })
  })

  it('clears pending exit-plan reminder when turn/started enters plan mode before a later normal start', async () => {
    let received: unknown = null
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          received = params
          return { turn: { id: 'turn-clear-pending', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const emit = server.createTurnNotificationEmitter()
    emit('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-previous', threadId: 'thread-1', status: 'running', mode: 'plan' },
      ts: '2026-02-12T00:00:00.000Z',
    })
    emit('turn/modeChanged', {
      threadId: 'thread-1',
      turnId: 'turn-previous',
      previousMode: 'plan',
      mode: 'normal',
      ts: '2026-02-12T00:00:01.000Z',
    })
    emit('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-plan-again', threadId: 'thread-1', status: 'running', mode: 'plan' },
      ts: '2026-02-12T00:00:02.000Z',
    })
    emit('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-now-normal', threadId: 'thread-1', status: 'running', mode: 'normal' },
      ts: '2026-02-12T00:00:03.000Z',
    })

    await server.handleMessage(
      request(2, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'normal turn after pending clear' },
        mode: 'normal',
      }),
    )

    expect(received).toEqual({
      threadId: 'thread-1',
      input: { text: 'normal turn after pending clear' },
      mode: 'normal',
    })
  })

  it('preserves pending exit-plan reminder when startTurn fails and consumes it on next success', async () => {
    const received: unknown[] = []
    let startCalls = 0
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          startCalls += 1
          received.push(params)
          if (startCalls === 1) {
            throw new Error(`Turn already running for thread: ${params.threadId}`)
          }
          return { turn: { id: `turn-retry-${startCalls}`, threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const emit = server.createTurnNotificationEmitter()
    emit('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-previous', threadId: 'thread-1', status: 'running', mode: 'plan' },
      ts: '2026-02-12T00:00:00.000Z',
    })
    emit('turn/modeChanged', {
      threadId: 'thread-1',
      turnId: 'turn-previous',
      previousMode: 'plan',
      mode: 'normal',
      ts: '2026-02-12T00:00:01.000Z',
    })

    const first = await server.handleMessage(
      request(2, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'first attempt' },
        mode: 'normal',
      }),
    )
    expect((first[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)

    const second = await server.handleMessage(
      request(3, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'second attempt' },
        mode: 'normal',
      }),
    )
    expect((second[0] as any).result.turn.id).toBe('turn-retry-2')

    const third = await server.handleMessage(
      request(4, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'third attempt' },
        mode: 'normal',
      }),
    )
    expect((third[0] as any).result.turn.id).toBe('turn-retry-3')

    expect(received).toEqual([
      {
        threadId: 'thread-1',
        input: { text: 'first attempt' },
        mode: 'normal',
        includeExitPlanReminder: true,
      },
      {
        threadId: 'thread-1',
        input: { text: 'second attempt' },
        mode: 'normal',
        includeExitPlanReminder: true,
      },
      {
        threadId: 'thread-1',
        input: { text: 'third attempt' },
        mode: 'normal',
      },
    ])
  })

  it('routes command/dispatch to turnRunner startTurn', async () => {
    let received: unknown = null
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          received = params
          return { turn: { id: 'turn-cmd', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const out = await server.handleMessage(
      request(2, 'command/dispatch', {
        threadId: 'thread-1',
        command: '/init',
        mode: 'plan',
      }),
    )
    expect((out[0] as any).result.dispatched).toBe(true)
    expect((out[0] as any).result.command).toBe('/init')
    expect((out[0] as any).result.turn.id).toBe('turn-cmd')
    expect(received).toEqual({
      threadId: 'thread-1',
      input: { text: '/init' },
      mode: 'plan',
    })
  })

  it('reuses the thread-bound runner for non-local command/dispatch turns', async () => {
    const primaryRunner = {
      startTurn: vi.fn(async (params) => ({
        turn: { id: 'turn-primary', threadId: params.threadId, status: 'running' as const },
      })),
      interruptTurn: vi.fn(async () => ({})),
      submitInput: vi.fn(async () => ({ accepted: true, status: 'accepted' as const })),
    }
    const fallbackRunner = {
      startTurn: vi.fn(async (params) => ({
        turn: { id: 'turn-fallback', threadId: params.threadId, status: 'running' as const },
      })),
      interruptTurn: vi.fn(async () => ({})),
      submitInput: vi.fn(async () => ({ accepted: true, status: 'accepted' as const })),
    }
    const resolveTurnRunner = vi.fn(async (args?: { cwd?: string; threadId?: string }) =>
      args?.cwd === '/special-cwd' ? primaryRunner : fallbackRunner,
    )
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async readThread() {
          return {
            thread: { id: 'thread-1', cwd: '/special-cwd', createdAt: '', updatedAt: '' },
            transcriptPreview: [],
          } as any
        },
      } as any,
      resolveTurnRunner,
    })

    await server.handleMessage(request(1, 'initialize'))

    await server.handleMessage(
      request(2, 'turn/start', {
        threadId: 'thread-1',
        cwd: '/special-cwd',
        input: { text: 'hello' },
      }),
    )

    const dispatchOut = await server.handleMessage(
      request(3, 'command/dispatch', {
        threadId: 'thread-1',
        command: '/compact keep summary',
      }),
    )

    expect((dispatchOut[0] as any).result.turn.id).toBe('turn-primary')
    expect(resolveTurnRunner).toHaveBeenCalledTimes(1)
    expect(primaryRunner.startTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        threadId: 'thread-1',
        input: { text: '/compact keep summary' },
      }),
    )
    expect(fallbackRunner.startTurn).not.toHaveBeenCalled()
  })

  it('adds exit-plan reminder flag when mode transitions from plan to non-plan on command/dispatch', async () => {
    let received: unknown = null
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          received = params
          return { turn: { id: 'turn-cmd-exit-plan', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const emit = server.createTurnNotificationEmitter()
    emit('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-previous', threadId: 'thread-1', status: 'running', mode: 'plan' },
      ts: '2026-02-12T00:00:00.000Z',
    })

    const out = await server.handleMessage(
      request(2, 'command/dispatch', {
        threadId: 'thread-1',
        command: '/init',
        mode: 'acceptEdits',
      }),
    )
    expect((out[0] as any).result.turn.id).toBe('turn-cmd-exit-plan')
    expect(received).toEqual({
      threadId: 'thread-1',
      input: { text: '/init' },
      mode: 'acceptEdits',
      includeExitPlanReminder: true,
    })
  })

  it('routes /compact via command/dispatch to turnRunner startTurn', async () => {
    let received: unknown = null
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          received = params
          return { turn: { id: 'turn-compact', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const out = await server.handleMessage(
      request(2, 'command/dispatch', {
        threadId: 'thread-1',
        command: '/compact keep only key points',
        mode: 'acceptEdits',
      }),
    )
    expect((out[0] as any).result.dispatched).toBe(true)
    expect((out[0] as any).result.command).toBe('/compact keep only key points')
    expect((out[0] as any).result.turn.id).toBe('turn-compact')
    expect(received).toEqual({
      threadId: 'thread-1',
      input: { text: '/compact keep only key points' },
      mode: 'acceptEdits',
    })
  })

  it('routes /todos via command/dispatch as local command output', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-server-todos-'))
    const todosPath = path.join(cwd, 'todos', 'web-agent-web.json')
    await fs.mkdir(path.dirname(todosPath), { recursive: true })
    await fs.writeFile(
      todosPath,
      JSON.stringify(
        {
          todos: [{ content: 'Ship web parity', status: 'pending', activeForm: 'Shipping web parity' }],
        },
        null,
        2,
      ),
      'utf8',
    )

    const prevTodosPath = process.env.FORMAX_TODOS_PATH
    const prevTodosSessionId = process.env.FORMAX_TODOS_SESSION_ID
    process.env.FORMAX_TODOS_PATH = 'todos/web-agent-web.json'
    process.env.FORMAX_TODOS_SESSION_ID = 'web'

    let startTurnCount = 0
    try {
      const server = new AppServer({
        info: { name: 'formax', version: 'test' },
        threadStore: {
          async startThread() {
            return {
              id: 'thread-1',
              cwd,
              createdAt: new Date(0).toISOString(),
              updatedAt: new Date(0).toISOString(),
            }
          },
          async resumeThread() {
            return {
              thread: {
                id: 'thread-1',
                cwd,
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
              },
              staleInputs: [],
            }
          },
          async listThreads() {
            return { data: [], nextCursor: null }
          },
          async readThread() {
            return {
              thread: {
                id: 'thread-1',
                cwd: '/tmp/should-not-be-used',
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
              },
              transcriptPreview: [],
            }
          },
          async listThreadMessages() {
            return { data: [], nextCursor: null }
          },
        },
        turnRunner: {
          async startTurn(params) {
            startTurnCount += 1
            return { turn: { id: 'turn-todos', threadId: params.threadId, status: 'running' as const } }
          },
          async interruptTurn() {
            return {}
          },
          async submitInput() {
            return { accepted: true, status: 'accepted' as const }
          },
        },
      })
      await server.handleMessage(request(1, 'initialize'))

      const out = await server.handleMessage(
        request(2, 'command/dispatch', {
          threadId: 'thread-1',
          command: '/ToDos',
          cwd,
        }),
      )

      expect((out[0] as any).result.dispatched).toBe(true)
      expect((out[0] as any).result.command).toBe('/ToDos')
      expect(typeof (out[0] as any).result.local?.stdout).toBe('string')
      expect((out[0] as any).result.local.stdout).toContain('Ship web parity')
      expect((out[0] as any).result.local.stdout).not.toContain('\u001b[')
      expect(startTurnCount).toBe(0)
    } finally {
      if (prevTodosPath === undefined) {
        delete process.env.FORMAX_TODOS_PATH
      } else {
        process.env.FORMAX_TODOS_PATH = prevTodosPath
      }
      if (prevTodosSessionId === undefined) {
        delete process.env.FORMAX_TODOS_SESSION_ID
      } else {
        process.env.FORMAX_TODOS_SESSION_ID = prevTodosSessionId
      }
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it('returns INTERNAL_ERROR when /todos local dispatch does not return local effect', async () => {
    const dispatch = vi.fn(() => null)
    const list = vi.fn(() => [])
    const suggest = vi.fn(() => [])
    const spy = vi
      .spyOn(commandRegistryModule, 'createSlashCommandRegistry')
      .mockReturnValue({ dispatch, list, suggest } as any)
    try {
      const server = new AppServer({
        info: { name: 'formax', version: 'test' },
        threadStore: {
          async startThread() {
            return {
              id: 't-1',
              cwd: '/tmp/workspace',
              createdAt: '2026-02-08T00:00:00.000Z',
              updatedAt: '2026-02-08T00:00:01.000Z',
            }
          },
          async resumeThread(threadId) {
            return {
              thread: {
                id: threadId,
                cwd: '/tmp/workspace',
                createdAt: '2026-02-08T00:00:00.000Z',
                updatedAt: '2026-02-08T00:00:01.000Z',
              },
              staleInputs: [],
            }
          },
          async listThreads() {
            return { data: [], nextCursor: null }
          },
          async readThread() {
            return {
              thread: {
                id: 't-1',
                cwd: '/tmp/workspace',
                createdAt: '2026-02-08T00:00:00.000Z',
                updatedAt: '2026-02-08T00:00:01.000Z',
              },
              transcriptPreview: [],
            }
          },
          async listThreadMessages() {
            return { data: [], nextCursor: null }
          },
        },
      })
      await server.handleMessage(request(1, 'initialize'))
      const out = await server.handleMessage(request(2, 'command/dispatch', { threadId: 't-1', command: '/todos' }))
      expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INTERNAL_ERROR)
      expect((out[0] as any).error.message).toContain('Failed to dispatch local command')
    } finally {
      spy.mockRestore()
    }
  })

  it('handles local /todos stdout even when value is missing', async () => {
    const dispatch = vi.fn(() => ({ kind: 'local', stdout: undefined }))
    const list = vi.fn(() => [])
    const suggest = vi.fn(() => [])
    const spy = vi
      .spyOn(commandRegistryModule, 'createSlashCommandRegistry')
      .mockReturnValue({ dispatch, list, suggest } as any)
    try {
      const server = new AppServer({
        info: { name: 'formax', version: 'test' },
        threadStore: {
          async startThread() {
            return {
              id: 't-1',
              cwd: '/tmp/workspace',
              createdAt: '2026-02-08T00:00:00.000Z',
              updatedAt: '2026-02-08T00:00:01.000Z',
            }
          },
          async resumeThread(threadId) {
            return {
              thread: {
                id: threadId,
                cwd: '/tmp/workspace',
                createdAt: '2026-02-08T00:00:00.000Z',
                updatedAt: '2026-02-08T00:00:01.000Z',
              },
              staleInputs: [],
            }
          },
          async listThreads() {
            return { data: [], nextCursor: null }
          },
          async readThread() {
            return {
              thread: {
                id: 't-1',
                cwd: '/tmp/workspace',
                createdAt: '2026-02-08T00:00:00.000Z',
                updatedAt: '2026-02-08T00:00:01.000Z',
              },
              transcriptPreview: [],
            }
          },
          async listThreadMessages() {
            return { data: [], nextCursor: null }
          },
        },
      })
      await server.handleMessage(request(1, 'initialize'))
      const out = await server.handleMessage(request(2, 'command/dispatch', { threadId: 't-1', command: '/todos' }))
      expect((out[0] as any).result.local.stdout).toBe('')
    } finally {
      spy.mockRestore()
    }
  })

  it('validates command/dispatch params', async () => {
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          return { turn: { id: 'turn-1', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const out = await server.handleMessage(
      request(2, 'command/dispatch', {
        threadId: 'thread-1',
        command: 'init',
      }),
    )
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((out[0] as any).error.message).toContain('params.command')
  })

  it('rejects unsupported command/dispatch commands', async () => {
    let startTurnCount = 0
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          startTurnCount += 1
          return { turn: { id: 'turn-1', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const out = await server.handleMessage(
      request(2, 'command/dispatch', {
        threadId: 'thread-1',
        command: '/permissions',
      }),
    )
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((out[0] as any).error.message).toContain('Unsupported params.command')
    expect(startTurnCount).toBe(0)
  })

  it('validates thread/replay params', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'thread/replay', { threadId: 't-1', after: -1 }))
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((out[0] as any).error.message).toContain('params.after')
  })

  it('does not mark replay gap when no buffered entries exist and nothing was trimmed', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'thread/replay', { threadId: 't-1', after: 42 }))
    const result = (out[0] as any).result
    expect(result.data).toEqual([])
    expect(result.nextCursor).toBe(0)
    expect(result.latestCursor).toBe(0)
    expect(result.hasGap).toBe(false)
  })

  it('keeps invariantIssues contract stable across empty, normal, and anomaly replay snapshots', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))

    const emptyReplay = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-empty' }))
    expect((emptyReplay[0] as any).result.state).toBeNull()

    const emit = server.createTurnNotificationEmitter()
    emit('turn/started', {
      threadId: 'thread-normal',
      eventId: 'normal-1',
      source: 'engine',
      ts: '2026-02-17T12:00:01.000Z',
      turn: { id: 'turn-normal', threadId: 'thread-normal', status: 'running' },
    })
    emit('turn/completed', {
      threadId: 'thread-normal',
      eventId: 'normal-2',
      source: 'engine',
      ts: '2026-02-17T12:00:02.000Z',
      turn: { id: 'turn-normal', threadId: 'thread-normal', status: 'completed' },
    })
    const normalReplay = await server.handleMessage(request(3, 'thread/replay', { threadId: 'thread-normal' }))
    expect((normalReplay[0] as any).result.state).toEqual(
      expect.objectContaining({
        canonicalProtocolAnomalyCount: 0,
        invariantIssues: [],
      }),
    )

    const runtimeStateByThreadId = (server as any).runtimeStateByThreadId as Map<string, any>
    const transcriptProjectionByThreadId = (server as any).transcriptProjectionByThreadId as Map<string, any>
    runtimeStateByThreadId.set('thread-contract-anomaly', {
      threadId: 'thread-contract-anomaly',
      mode: 'normal',
      activeTurnId: null,
      lastTurnId: 'turn-1',
      lastTurnStatus: 'completed',
      pendingInputs: {
        'input-1': {
          inputId: 'input-1',
          threadId: 'thread-contract-anomaly',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          kind: 'approval',
          status: 'pending',
          createdAt: '2026-02-17T12:00:01.000Z',
          expiresAt: '2026-02-17T12:05:01.000Z',
          payload: {},
        },
      },
      toolNameByUseId: { 'tool-1': 'Bash' },
      updatedAt: '2026-02-17T12:00:02.000Z',
      lastNotificationMethod: 'turn/completed',
      lastReplaySeq: 3,
    })
    transcriptProjectionByThreadId.set('thread-contract-anomaly', {
      threadId: 'thread-contract-anomaly',
      segments: [
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          toolName: 'Bash',
          status: 'running',
          summary: 'Bash running',
          detailLines: [],
        },
        {
          id: 'footer-1',
          kind: 'turn_footer',
          turnId: 'turn-1',
          status: 'completed',
        },
      ],
      seenEventIds: new Set<string>(),
      lastReplaySeq: 3,
      toolNameByUseId: { 'tool-1': 'Bash' },
      openAssistantSegmentIdByTurn: {},
      openThinkingSegmentIdByTurn: {},
    })
    const anomalyReplay = await server.handleMessage(request(4, 'thread/replay', { threadId: 'thread-contract-anomaly' }))
    expect((anomalyReplay[0] as any).result.state).toEqual(
      expect.objectContaining({
        canonicalProtocolAnomalyCount: 0,
        invariantIssues: expect.arrayContaining([
          expect.objectContaining({ kind: 'running_tool_after_terminal_turn' }),
          expect.objectContaining({ kind: 'pending_input_after_terminal_turn' }),
        ]),
      }),
    )
  })

  it('replays buffered turn notifications with cursor and state snapshot', async () => {
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      emitNotification(message) {
        notifications.push(message)
      },
    })
    await server.handleMessage(request(1, 'initialize'))

    const emit = server.createTurnNotificationEmitter()
    emit('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', threadId: 'thread-1', status: 'running' },
      ts: '2026-02-10T00:00:00.000Z',
    })
    emit('turn/inputRequested', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      eventId: 'input-requested-1',
      source: 'policy',
      input: {
        inputId: 'input-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        kind: 'approval',
        status: 'pending',
        createdAt: '2026-02-10T00:00:01.000Z',
        expiresAt: '2026-02-10T00:05:01.000Z',
        payload: { toolName: 'Bash', action: {}, effectiveDecision: {} },
      },
      ts: '2026-02-10T00:00:01.000Z',
    })
    emit('turn/modeChanged', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      previousMode: 'normal',
      mode: 'acceptEdits',
      ts: '2026-02-10T00:00:01.500Z',
    })
    emit('turn/event', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      eventId: 'event-tool-start-1',
      source: 'tool',
      event: {
        type: 'tool_start',
        id: 'tool-1',
        name: 'Bash',
      },
      ts: '2026-02-10T00:00:01.750Z',
    })
    emit('turn/completed', {
      threadId: 'thread-1',
      eventId: 'turn-completed-1',
      source: 'engine',
      turn: { id: 'turn-1', threadId: 'thread-1', status: 'completed' },
      ts: '2026-02-10T00:00:02.000Z',
    })

    const baseline = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-1' }))
    expect((baseline[0] as any).result.data).toEqual([])
    const baselineCursor = (baseline[0] as any).result.nextCursor as number
    expect(baselineCursor).toBeGreaterThan(0)
    expect((baseline[0] as any).result.state).toEqual(
      expect.objectContaining({
        mode: 'acceptEdits',
        activeTurnId: null,
        lastTurnId: 'turn-1',
        lastTurnStatus: 'completed',
        pendingInputCount: 0,
        projection: expect.objectContaining({
          segments: expect.any(Array),
          lastReplaySeq: expect.any(Number),
        }),
        toolNameByUseId: { 'tool-1': 'Bash' },
      }),
    )

    const page = await server.handleMessage(
      request(3, 'thread/replay', {
        threadId: 'thread-1',
        after: 0,
        limit: 2,
      }),
    )
    expect((page[0] as any).result.data).toHaveLength(2)
    expect((page[0] as any).result.latestCursor).toBeGreaterThanOrEqual((page[0] as any).result.nextCursor)
    expect((page[0] as any).result.hasGap).toBe(false)

    const next = await server.handleMessage(
      request(4, 'thread/replay', {
        threadId: 'thread-1',
        after: (page[0] as any).result.nextCursor,
        limit: 10,
      }),
    )
    expect((next[0] as any).result.data).toHaveLength(3)

    const notificationReplaySeqs = notifications
      .map((entry) => (entry.params as any)?.replaySeq)
      .filter((value) => typeof value === 'number')
    expect(notificationReplaySeqs.length).toBe(5)
  })

  it('returns empty replay page when after cursor is beyond latest cursor', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))

    const emit = server.createTurnNotificationEmitter()
    emit('turn/event', { threadId: 'thread-gap' })

    const replayOut = await server.handleMessage(
      request(2, 'thread/replay', { threadId: 'thread-gap', after: 9999, limit: 10 }),
    )
    expect((replayOut[0] as any).result.data).toEqual([])
    expect((replayOut[0] as any).result.nextCursor).toBe((replayOut[0] as any).result.latestCursor)
  })

  it('includes pending input details in replay state snapshot', async () => {
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
    })
    await server.handleMessage(request(1, 'initialize'))

    const emit = server.createTurnNotificationEmitter()
    emit('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', threadId: 'thread-1', status: 'running' },
      ts: '2026-02-10T00:00:00.000Z',
    })
    emit('turn/inputRequested', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      eventId: 'input-requested-2',
      source: 'policy',
      input: {
        inputId: 'input-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        kind: 'approval',
        status: 'pending',
        createdAt: '2026-02-10T00:00:01.000Z',
        expiresAt: '2026-02-10T00:05:01.000Z',
        payload: { toolName: 'Bash', action: { command: 'rm -rf a.js' } },
      },
      ts: '2026-02-10T00:00:01.000Z',
    })

    const replay = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-1' }))
    expect((replay[0] as any).result.state).toEqual(
      expect.objectContaining({
        pendingInputCount: 1,
        invariantIssues: expect.any(Array),
        pendingInputs: [
          expect.objectContaining({
            inputId: 'input-1',
            threadId: 'thread-1',
            turnId: 'turn-1',
            toolUseId: 'tool-1',
            kind: 'approval',
            status: 'pending',
          }),
        ],
      }),
    )
  })

  it('includes invariant issues in replay state snapshot for terminal drift diagnostics', async () => {
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
    })
    await server.handleMessage(request(1, 'initialize'))

    const runtimeStateByThreadId = (server as any).runtimeStateByThreadId as Map<string, any>
    const transcriptProjectionByThreadId = (server as any).transcriptProjectionByThreadId as Map<string, any>
    runtimeStateByThreadId.set('thread-invariant', {
      threadId: 'thread-invariant',
      mode: 'normal',
      activeTurnId: null,
      lastTurnId: 'turn-1',
      lastTurnStatus: 'completed',
      pendingInputs: {
        'input-1': {
          inputId: 'input-1',
          threadId: 'thread-invariant',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          kind: 'approval',
          status: 'pending',
          createdAt: '2026-02-17T00:00:01.000Z',
          expiresAt: '2026-02-17T00:05:01.000Z',
          payload: {},
        },
      },
      toolNameByUseId: { 'tool-1': 'Bash' },
      updatedAt: '2026-02-17T00:00:02.000Z',
      lastNotificationMethod: 'turn/completed',
      lastReplaySeq: 3,
    })
    transcriptProjectionByThreadId.set('thread-invariant', {
      threadId: 'thread-invariant',
      segments: [
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          toolName: 'Bash',
          status: 'running',
          summary: 'Bash running',
          detailLines: [],
        },
        {
          id: 'footer-1',
          kind: 'turn_footer',
          turnId: 'turn-1',
          status: 'completed',
        },
      ],
      seenEventIds: new Set<string>(),
      lastReplaySeq: 3,
      toolNameByUseId: { 'tool-1': 'Bash' },
      openAssistantSegmentIdByTurn: {},
      openThinkingSegmentIdByTurn: {},
    })

    const replay = await server.handleMessage(request(2, 'thread/replay', { threadId: 'thread-invariant' }))
    expect((replay[0] as any).result.state).toEqual(
      expect.objectContaining({
        invariantIssues: expect.arrayContaining([
          expect.objectContaining({
            kind: 'running_tool_after_terminal_turn',
            turnId: 'turn-1',
            toolUseId: 'tool-1',
          }),
          expect.objectContaining({
            kind: 'pending_input_after_terminal_turn',
            turnId: 'turn-1',
            inputId: 'input-1',
            toolUseId: 'tool-1',
          }),
        ]),
      }),
    )
  })

  it('marks canonical envelope anomalies and skips projection for invalid notifications', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))

    const emit = server.createTurnNotificationEmitter()
    emit('turn/event', {
      threadId: 'thread-envelope',
      turnId: 'turn-envelope',
      replaySeq: 999,
      event: { type: 'assistant_delta', text: 'hello anomaly' },
    })

    const replay = await server.handleMessage(
      request(2, 'thread/replay', {
        threadId: 'thread-envelope',
        after: 0,
        limit: 10,
      }),
    )
    const result = (replay[0] as any).result
    expect(result.data).toHaveLength(1)
    expect(result.state).toEqual(
      expect.objectContaining({
        canonicalProtocolAnomalyCount: 1,
        projection: null,
      }),
    )

    const anomalyCounts = (server as any).canonicalProtocolAnomalyCountByThreadId as Map<string, number>
    expect(anomalyCounts.get('thread-envelope')).toBe(1)
  })

  it('marks replay gap based on trimmed boundary for the thread buffer', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))
    const emit = server.createTurnNotificationEmitter()
    for (let index = 0; index < 2050; index += 1) {
      emit('turn/event', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        eventId: `gap-event-${index}`,
        source: 'engine',
        ts: '2026-02-10T00:00:00.000Z',
        event: { type: 'assistant_delta', text: `delta-${index}` },
      })
    }
    const latestCompactBoundary = {
      schemaVersion: 1,
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 4096,
      summaryKind: 'session_memory',
    }
    emit('turn/event', {
      threadId: 'thread-1',
      turnId: 'turn-compact-tail',
      eventId: 'gap-compact-tail',
      source: 'engine',
      ts: '2026-02-10T00:01:00.000Z',
      event: { type: 'compact_boundary', boundary: latestCompactBoundary },
    })

    const out = await server.handleMessage(
      request(2, 'thread/replay', {
        threadId: 'thread-1',
        after: 1,
        limit: 10,
      }),
    )
    const result = (out[0] as any).result
    expect(result.hasGap).toBe(true)
    expect(result.data).toHaveLength(10)
    expect((result.data[0] as any).replaySeq).toBeGreaterThan(1)
    expect(result.latestCompactBoundary).toEqual(latestCompactBoundary)
    expect(result.state).toEqual(
      expect.objectContaining({
        projection: expect.objectContaining({
          segments: expect.any(Array),
          lastReplaySeq: expect.any(Number),
        }),
      }),
    )
  })

  it('returns projection snapshot on hasGap even when runtime state cache is missing', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))
    const emit = server.createTurnNotificationEmitter()
    for (let index = 0; index < 2050; index += 1) {
      emit('turn/event', {
        threadId: 'thread-gap-state',
        turnId: 'turn-gap-state',
        eventId: `gap-state-event-${index}`,
        source: 'engine',
        ts: '2026-02-10T00:00:00.000Z',
        event: { type: 'assistant_delta', text: `delta-${index}` },
      })
    }

    const runtimeStateByThreadId = (server as any).runtimeStateByThreadId as Map<string, unknown>
    runtimeStateByThreadId.delete('thread-gap-state')

    const out = await server.handleMessage(
      request(2, 'thread/replay', {
        threadId: 'thread-gap-state',
        after: 1,
        limit: 10,
      }),
    )
    const result = (out[0] as any).result
    expect(result.hasGap).toBe(true)
    expect(result.state).toEqual(
      expect.objectContaining({
        mode: 'normal',
        projection: expect.objectContaining({
          segments: expect.any(Array),
          lastReplaySeq: expect.any(Number),
        }),
      }),
    )
  })

  it('validates turn/start mode params', async () => {
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          return { turn: { id: 'turn-1', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(
      request(2, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'hello' },
        mode: 'invalid',
      }),
    )
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((out[0] as any).error.message).toContain('params.mode')
  })

  it('returns INTERNAL_ERROR when turn runner is not configured', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(
      request(2, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'hello' },
      }),
    )
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INTERNAL_ERROR)
  })

  it('returns INPUT_EXPIRED for stale input submissions after resume', async () => {
    const baseThread: Thread = {
      id: 't-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread(threadId) {
          return {
            thread: { ...baseThread, id: threadId },
            staleInputs: [
              {
                inputId: 'stale-1',
                threadId,
                turnId: 'turn-stale',
                toolUseId: 'ask-1',
                kind: 'ask_user_question' as const,
                status: 'expired' as const,
                createdAt: '2026-02-08T00:00:00.000Z',
                expiresAt: '2026-02-08T00:05:00.000Z',
                resolvedAt: '2026-02-08T00:10:00.000Z',
                reason: 'server_restart',
              },
            ],
          }
        },
        async listThreads() {
          return { data: [{ ...baseThread, messageCount: 1, lastUserPrompt: 'hi', label: null }], nextCursor: null }
        },
        async readThread() {
          return { thread: baseThread, transcriptPreview: [{ role: 'user', text: 'hi' }] }
        },
        async listThreadMessages() {
          return { data: [{ id: '0', kind: 'message', role: 'user', text: 'hi' }], nextCursor: null }
        },
      },
      turnRunner: {
        async startTurn() {
          return { turn: { id: 'turn-1', threadId: 't-1', status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    await server.handleMessage(request(2, 'thread/resume', { threadId: 't-1' }))
    const submit = await server.handleMessage(
      request(3, 'turn/input/submit', {
        threadId: 't-1',
        turnId: 'turn-stale',
        inputId: 'stale-1',
        answers: { Choice: 'A' },
      }),
    )
    expect((submit[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((submit[0] as any).error.message).toBe('INPUT_EXPIRED')
    expect((submit[0] as any).error.data).toEqual(
      expect.objectContaining({
        kind: 'INPUT_EXPIRED',
        inputId: 'stale-1',
      }),
    )

    const submitByToolUseId = await server.handleMessage(
      request(4, 'turn/input/submit', {
        threadId: 't-1',
        turnId: 'turn-stale',
        toolUseId: 'ask-1',
        answers: { Choice: 'A' },
      }),
    )
    expect((submitByToolUseId[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((submitByToolUseId[0] as any).error.message).toBe('INPUT_EXPIRED')
    expect((submitByToolUseId[0] as any).error.data).toEqual(
      expect.objectContaining({
        kind: 'INPUT_EXPIRED',
        inputId: 'stale-1',
      }),
    )
  })

  it('supports ask_user_question request -> submit -> completed integration flow', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const userInput = createUserInputManager()
    const threadStore = new ThreadStore({ cwd, env })

    let runner: TurnRunner | null = null
    let server: AppServer
    server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore,
      resolveTurnRunner: async () => {
        if (runner) return runner
        runner = new TurnRunner({
          engine: {
            async runTurn(args) {
              const userText = Array.isArray(args.user.content)
                ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
                : ''
              if (userText.includes('Please write a 5-10 word title')) {
                return [
                  ...args.history,
                  args.user,
                  { role: 'assistant', content: [{ type: 'text', text: 'Flow Title' }] },
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
          cwd,
          env,
          userInputManager: userInput,
          emitNotification: server.createTurnNotificationEmitter(),
        })
        return runner
      },
      emitNotification(message) {
        notifications.push(message)
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const threadStart = await server.handleMessage(request(2, 'thread/start'))
    const threadId = (threadStart[0] as any).result.thread.id as string
    const turnStart = await server.handleMessage(
      request(3, 'turn/start', {
        threadId,
        input: { text: 'hello' },
      }),
    )
    const turnId = (turnStart[0] as any).result.turn.id as string

    const requested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && (n.params as any)?.input?.kind === 'ask_user_question',
    )
    const inputId = (requested.params as any).input.inputId as string

    const submit = await server.handleMessage(
      request(4, 'turn/input/submit', {
        threadId,
        turnId,
        inputId,
        answers: { Choice: 'A' },
        submissionId: 'submission-1',
      }),
    )
    expect((submit[0] as any).result).toEqual({ accepted: true, status: 'accepted' })

    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputResolved' && (n.params as any)?.input?.status === 'submitted',
    )
    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && (n.params as any)?.turn?.id === turnId,
    )
  })

  it('supports approval then ask_user_question in one turn integration flow', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const userInput = createUserInputManager()
    const threadStore = new ThreadStore({ cwd, env })

    let runner: TurnRunner | null = null
    let server: AppServer
    server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore,
      resolveTurnRunner: async () => {
        if (runner) return runner
        runner = new TurnRunner({
          engine: {
            async runTurn(args) {
              const userText = Array.isArray(args.user.content)
                ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
                : ''
              if (userText.includes('Please write a 5-10 word title')) {
                return [
                  ...args.history,
                  args.user,
                  { role: 'assistant', content: [{ type: 'text', text: 'Flow Title' }] },
                ] as ChatHistory
              }
              args.onEvent({
                type: 'approval_request',
                toolUseId: 'approval-1',
                toolName: 'Bash',
                action: { kind: 'bash.exec', command: 'echo hello' },
                effectiveDecision: { decision: 'ask' },
              })
              const approvalAnswers = await userInput.requestAnswers({
                toolUseId: 'approval-1',
                questions: [],
                signal: args.signal,
              })

              const questions = [
                {
                  question: 'Pick one?',
                  header: 'Choice',
                  options: [{ label: 'A', description: 'Option A' }],
                  multiSelect: false,
                },
              ]
              args.onEvent({ type: 'ask_user_question', toolUseId: 'ask-1', questions })
              const askAnswers = await userInput.requestAnswers({ toolUseId: 'ask-1', questions, signal: args.signal })

              args.onEvent({
                type: 'assistant_delta',
                text: `approval=${String(approvalAnswers.decision ?? 'none')} choice=${String(askAnswers.Choice ?? '')}`,
              })
              args.onEvent({ type: 'complete' })
              return [
                ...args.history,
                args.user,
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'text',
                      text: `approval=${String(approvalAnswers.decision ?? 'none')} choice=${String(askAnswers.Choice ?? '')}`,
                    },
                  ],
                },
              ] as ChatHistory
            },
          },
          tools: [],
          allowedSubagents: [],
          model: 'test-model',
          cwd,
          env,
          userInputManager: userInput,
          emitNotification: server.createTurnNotificationEmitter(),
        })
        return runner
      },
      emitNotification(message) {
        notifications.push(message)
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const threadStart = await server.handleMessage(request(2, 'thread/start'))
    const threadId = (threadStart[0] as any).result.thread.id as string
    const turnStart = await server.handleMessage(
      request(3, 'turn/start', {
        threadId,
        input: { text: 'hello' },
      }),
    )
    const turnId = (turnStart[0] as any).result.turn.id as string

    const approvalRequested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && (n.params as any)?.input?.toolUseId === 'approval-1',
    )
    const approvalInputId = (approvalRequested.params as any).input.inputId as string
    const submitApproval = await server.handleMessage(
      request(4, 'turn/input/submit', {
        threadId,
        turnId,
        inputId: approvalInputId,
        answers: { decision: 'approve' },
        submissionId: 'submission-approval-1',
      }),
    )
    expect((submitApproval[0] as any).result).toEqual({ accepted: true, status: 'accepted' })

    await waitForNotification(
      notifications,
      (n) =>
        n.method === 'turn/inputResolved' &&
        (n.params as any)?.input?.status === 'submitted' &&
        (n.params as any)?.input?.toolUseId === 'approval-1',
    )

    const askRequested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && (n.params as any)?.input?.toolUseId === 'ask-1',
    )
    const askInputId = (askRequested.params as any).input.inputId as string
    const submitAsk = await server.handleMessage(
      request(5, 'turn/input/submit', {
        threadId,
        turnId,
        inputId: askInputId,
        answers: { Choice: 'A' },
        submissionId: 'submission-ask-1',
      }),
    )
    expect((submitAsk[0] as any).result).toEqual({ accepted: true, status: 'accepted' })

    await waitForNotification(
      notifications,
      (n) =>
        n.method === 'turn/inputResolved' &&
        (n.params as any)?.input?.status === 'submitted' &&
        (n.params as any)?.input?.toolUseId === 'ask-1',
    )
    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && (n.params as any)?.turn?.id === turnId,
    )
  })

  it('coalesces duplicate/conflicting submissions for the same inputId', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const userInput = createUserInputManager()
    const threadStore = new ThreadStore({ cwd, env })
    let releaseEngineAfterSubmissions: (() => void) | null = null
    const waitForSubmissionBurst = new Promise<void>((resolve) => {
      releaseEngineAfterSubmissions = resolve
    })

    let runner: TurnRunner | null = null
    let server: AppServer
    server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore,
      resolveTurnRunner: async () => {
        if (runner) return runner
        runner = new TurnRunner({
          engine: {
            async runTurn(args) {
              const userText = Array.isArray(args.user.content)
                ? String((args.user.content.find((b) => (b as any)?.type === 'text') as any)?.text ?? '')
                : ''
              if (userText.includes('Please write a 5-10 word title')) {
                return [
                  ...args.history,
                  args.user,
                  { role: 'assistant', content: [{ type: 'text', text: 'Flow Title' }] },
                ] as ChatHistory
              }
              const questions = [
                {
                  question: 'Pick one?',
                  header: 'Choice',
                  options: [
                    { label: 'A', description: 'Option A' },
                    { label: 'B', description: 'Option B' },
                  ],
                  multiSelect: false,
                },
              ]
              args.onEvent({ type: 'ask_user_question', toolUseId: 'ask-1', questions })
              const answers = await userInput.requestAnswers({ toolUseId: 'ask-1', questions, signal: args.signal })
              await waitForSubmissionBurst
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
          cwd,
          env,
          userInputManager: userInput,
          emitNotification: server.createTurnNotificationEmitter(),
        })
        return runner
      },
      emitNotification(message) {
        notifications.push(message)
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const threadStart = await server.handleMessage(request(2, 'thread/start'))
    const threadId = (threadStart[0] as any).result.thread.id as string
    const turnStart = await server.handleMessage(
      request(3, 'turn/start', {
        threadId,
        input: { text: 'hello' },
      }),
    )
    const turnId = (turnStart[0] as any).result.turn.id as string

    const requested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && (n.params as any)?.input?.kind === 'ask_user_question',
    )
    const inputId = (requested.params as any).input.inputId as string

    try {
      const submit1 = await server.handleMessage(
        request(4, 'turn/input/submit', {
          threadId,
          turnId,
          inputId,
          answers: { Choice: 'A' },
          submissionId: 'submission-1',
        }),
      )
      expect((submit1[0] as any).result).toEqual({ accepted: true, status: 'accepted' })

      const submitSame = await server.handleMessage(
        request(5, 'turn/input/submit', {
          threadId,
          turnId,
          inputId,
          answers: { Choice: 'A' },
          submissionId: 'submission-1',
        }),
      )
      expect((submitSame[0] as any).result).toEqual({ accepted: true, status: 'already_submitted_same' })

      const submitConflict = await server.handleMessage(
        request(6, 'turn/input/submit', {
          threadId,
          turnId,
          inputId,
          answers: { Choice: 'B' },
          submissionId: 'submission-2',
        }),
      )
      expect((submitConflict[0] as any).result).toEqual({ accepted: false, status: 'conflict_already_submitted' })
    } finally {
      releaseEngineAfterSubmissions?.()
    }

    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && (n.params as any)?.turn?.id === turnId,
    )
    const resolvedSubmittedCount = notifications.filter(
      (n) => n.method === 'turn/inputResolved' && (n.params as any)?.input?.status === 'submitted',
    ).length
    expect(resolvedSubmittedCount).toBe(1)
  })

  it('interrupt resolves pending input before turn end', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const userInput = createUserInputManager()
    const threadStore = new ThreadStore({ cwd, env })

    let runner: TurnRunner | null = null
    let server: AppServer
    server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore,
      resolveTurnRunner: async () => {
        if (runner) return runner
        runner = new TurnRunner({
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
              args.onEvent({ type: 'ask_user_question', toolUseId: 'ask-1', questions })
              await userInput.requestAnswers({ toolUseId: 'ask-1', questions, signal: args.signal })
              return [...args.history, args.user] as ChatHistory
            },
          },
          tools: [],
          allowedSubagents: [],
          model: 'test-model',
          cwd,
          env,
          userInputManager: userInput,
          emitNotification: server.createTurnNotificationEmitter(),
        })
        return runner
      },
      emitNotification(message) {
        notifications.push(message)
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const threadStart = await server.handleMessage(request(2, 'thread/start'))
    const threadId = (threadStart[0] as any).result.thread.id as string
    const turnStart = await server.handleMessage(
      request(3, 'turn/start', {
        threadId,
        input: { text: 'hello' },
      }),
    )
    const turnId = (turnStart[0] as any).result.turn.id as string

    const requested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && (n.params as any)?.input?.kind === 'ask_user_question',
    )
    const inputId = (requested.params as any).input.inputId as string

    const interrupted = await server.handleMessage(
      request(4, 'turn/interrupt', {
        threadId,
        turnId,
      }),
    )
    expect((interrupted[0] as any).result).toEqual({})

    const resolved = await waitForNotification(
      notifications,
      (n) =>
        n.method === 'turn/inputResolved' &&
        (n.params as any)?.input?.status === 'canceled' &&
        (n.params as any)?.input?.inputId === inputId,
    )
    expect((resolved.params as any)?.input?.reason).toBe('turn_interrupted')

    const failed = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/failed' && (n.params as any)?.turn?.id === turnId,
    )
    expect((failed.params as any)?.turn?.status).toBe('interrupted')

    const resolvedIndex = notifications.findIndex(
      (n) =>
        n.method === 'turn/inputResolved' &&
        (n.params as any)?.input?.status === 'canceled' &&
        (n.params as any)?.input?.inputId === inputId,
    )
    const failedIndex = notifications.findIndex(
      (n) => n.method === 'turn/failed' && (n.params as any)?.turn?.id === turnId,
    )
    expect(resolvedIndex).toBeGreaterThanOrEqual(0)
    expect(failedIndex).toBeGreaterThan(resolvedIndex)
  })

  it('emits thread/archived notification defaults when opId and archivedAt are missing', async () => {
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return { id: 't-1', cwd: '/tmp', createdAt: '', updatedAt: '' } as any
        },
        async readThread() {
          return { thread: { id: 't-1', cwd: '/tmp', createdAt: '', updatedAt: '' }, transcriptPreview: [] } as any
        },
        async listThreads() { return { data: [], nextCursor: null } as any },
        async resumeThread() { return { thread: { id: 't-1', cwd: '/tmp', createdAt: '', updatedAt: '' }, staleInputs: [] } as any },
        async listThreadMessages() { return { data: [], nextCursor: null } as any },
        async archiveThread(threadId: string) {
          return { thread: { id: threadId, cwd: '/tmp', createdAt: '', updatedAt: '' } } as any
        },
      } as any,
      emitNotification(message) {
        notifications.push(message)
      },
    })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'thread/archive', { threadId: 't-1' }))
    expect((out[0] as any).result.thread.id).toBe('t-1')
    const archived = notifications.find((n) => n.method === 'thread/archived')
    expect((archived?.params as any)?.opId).toBeNull()
    expect(typeof (archived?.params as any)?.archivedAt).toBe('string')
  })

  it('routes /todos with arguments via local command dispatch', async () => {
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async readThread() {
          return { thread: { id: 't-1', cwd: process.cwd(), createdAt: '', updatedAt: '' }, transcriptPreview: [] } as any
        },
      } as any,
    })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'command/dispatch', { threadId: 't-1', command: '/todos now' }))
    expect((out[0] as any).result.local.stdout).toBeTypeOf('string')
  })

  it('routes /context via command/dispatch as local diagnostics output', async () => {
    const resolveContextDiagnostics = vi.fn(async () => ({
      stdout: 'Context diagnostics\n- Mode: plan\n- Tool result blocks: 2',
      diagnostics: {
        kind: 'formax.context_diagnostics' as const,
        schemaVersion: 1 as const,
        mode: 'plan',
        model: 'claude-3-5-sonnet-latest',
        latestCompactBoundary: null,
        projectionLayers: {} as any,
        contextMeterRaw: {} as any,
        snapshot: {} as any,
        nextTurnFixed: {} as any,
        notes: [],
      },
    }))
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async readThread() {
          return { thread: { id: 't-1', cwd: '/repo/from-thread', createdAt: '', updatedAt: '' }, transcriptPreview: [] } as any
        },
      } as any,
      resolveContextDiagnostics,
    })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(
      request(2, 'command/dispatch', { threadId: 't-1', command: '/context', cwd: '/repo/from-param', mode: 'plan' }),
    )

    expect((out[0] as any).result.dispatched).toBe(true)
    expect((out[0] as any).result.command).toBe('/context')
    expect((out[0] as any).result.local.stdout).toContain('Context diagnostics')
    expect((out[0] as any).result.local.diagnostics?.kind).toBe('formax.context_diagnostics')
    expect(resolveContextDiagnostics).toHaveBeenCalledWith({
      threadId: 't-1',
      cwd: '/repo/from-param',
      mode: 'plan',
      modeExplicit: true,
      includeExitPlanReminder: false,
      nextTurnInjectedBlocks: [],
      format: 'text',
    })
  })

  it('routes /context --json via command/dispatch as local diagnostics output', async () => {
    const resolveContextDiagnostics = vi.fn(async () => ({
      stdout: '{\n  "kind": "formax.context_diagnostics"\n}',
      diagnostics: {
        kind: 'formax.context_diagnostics' as const,
        schemaVersion: 1 as const,
        mode: 'plan',
        model: 'claude-3-5-sonnet-latest',
        latestCompactBoundary: null,
        projectionLayers: {} as any,
        contextMeterRaw: {} as any,
        snapshot: {} as any,
        nextTurnFixed: {} as any,
        notes: [],
      },
    }))
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async readThread() {
          return { thread: { id: 't-1', cwd: '/repo/from-thread', createdAt: '', updatedAt: '' }, transcriptPreview: [] } as any
        },
      } as any,
      resolveContextDiagnostics,
    })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(
      request(2, 'command/dispatch', { threadId: 't-1', command: '/context --json', cwd: '/repo/from-param', mode: 'plan' }),
    )

    expect((out[0] as any).result.dispatched).toBe(true)
    expect((out[0] as any).result.local.stdout).toContain('"kind": "formax.context_diagnostics"')
    expect((out[0] as any).result.local.diagnostics?.schemaVersion).toBe(1)
    expect(resolveContextDiagnostics).toHaveBeenCalledWith({
      threadId: 't-1',
      cwd: '/repo/from-param',
      mode: 'plan',
      modeExplicit: true,
      includeExitPlanReminder: false,
      nextTurnInjectedBlocks: [],
      format: 'json',
    })
  })

  it('returns usage for /context with extra arguments without invoking diagnostics resolver', async () => {
    const resolveContextDiagnostics = vi.fn(async () => ({ stdout: 'should not run', diagnostics: {} as any }))
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async readThread() {
          return { thread: { id: 't-1', cwd: process.cwd(), createdAt: '', updatedAt: '' }, transcriptPreview: [] } as any
        },
      } as any,
      resolveContextDiagnostics,
    })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'command/dispatch', { threadId: 't-1', command: '/context now' }))
    expect((out[0] as any).result.local.stdout).toBe('Usage: /context [--json]')
    expect(resolveContextDiagnostics).not.toHaveBeenCalled()
  })

  it('passes cwd through command/dispatch and submitInput ignores missing stale toolUseId mapping', async () => {
    const startTurn = vi.fn(async () => ({ turn: { id: 'turn-1', status: 'running' } }))
    const submitInput = vi.fn(async () => ({}))
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async readThread() {
          return { thread: { id: 't-1', cwd: process.cwd(), createdAt: '', updatedAt: '' }, transcriptPreview: [] } as any
        },
      } as any,
      resolveTurnRunner: async () =>
        ({
          startTurn,
          interruptTurn: async () => ({}),
          submitInput,
        }) as any,
    })
    await server.handleMessage(request(1, 'initialize'))
    await server.handleMessage(
      request(2, 'command/dispatch', { threadId: 't-1', command: '/compact keep summary', cwd: process.cwd() }),
    )
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ cwd: process.cwd() }))

    await server.handleMessage(
      request(3, 'turn/input/submit', {
        threadId: 't-1',
        turnId: 'turn-1',
        inputId: 'in-1',
        toolUseId: 'missing-tool',
        answers: { Choice: 'A' },
      }),
    )
    expect(submitInput).toHaveBeenCalled()
  })

  it('maps non-Error exceptions to INTERNAL_ERROR via toRpcError', async () => {
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          throw 'boom'
        },
      } as any,
    })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(request(2, 'thread/start', {}))
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INTERNAL_ERROR)
    expect((out[0] as any).error.message).toBe('Internal error')
  })

  it('emits notifications with undefined/primitive params when no threadId can be extracted', () => {
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      emitNotification(message) {
        notifications.push(message)
      },
    })
    const emit = server.createTurnNotificationEmitter()
    emit('custom/no-params')
    emit('custom/primitive', 'x')
    emit('custom/object', { ok: true })
    expect(notifications[0]).toEqual({ jsonrpc: '2.0', method: 'custom/no-params' })
    expect(notifications[1]).toEqual({ jsonrpc: '2.0', method: 'custom/primitive' })
    expect(notifications[2]).toEqual({ jsonrpc: '2.0', method: 'custom/object', params: { ok: true } })
  })

  it('does not regress replay trimmed boundary when previous threshold is already newer', () => {
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      emitNotification(message) {
        notifications.push(message)
      },
    })
    ;(server as any).maxReplayEventsPerThread = 1
    ;(server as any).replayTrimmedBeforeByThreadId.set('thread-trim', 100)
    const emit = server.createTurnNotificationEmitter()
    emit('turn/started', { threadId: 'thread-trim' })
    emit('turn/started', { threadId: 'thread-trim' })
    const trimmedBefore = (server as any).replayTrimmedBeforeByThreadId.get('thread-trim')
    expect(trimmedBefore).toBe(100)
    expect(notifications.length).toBeGreaterThan(0)
  })
})
