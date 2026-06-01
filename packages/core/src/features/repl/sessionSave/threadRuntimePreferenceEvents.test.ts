import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildThreadRuntimeStatePatchEventData,
  readThreadRuntimePreferencesFromSession,
  SessionWriter,
  THREAD_RUNTIME_STATE_PATCH_EVENT_NAME,
} from './index.js'

describe('thread runtime preference session events', () => {
  async function createSession(threadId = 'thread-1') {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-thread-runtime-preferences-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-thread-runtime-preferences-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
    return SessionWriter.createNew({ cwd, env, sessionId: threadId })
  }

  it('reduces latest valid preference event wins and clear patches omit fields', async () => {
    const { writer, filePath } = await createSession()
    await writer.appendEvent(
      THREAD_RUNTIME_STATE_PATCH_EVENT_NAME,
      buildThreadRuntimeStatePatchEventData({
        threadId: 'thread-1',
        source: 'web',
        patch: { preferences: { modelTier: 'haiku', thinkingMode: true, thinkingEffort: 'high' } },
      }),
    )
    await writer.appendEvent(
      THREAD_RUNTIME_STATE_PATCH_EVENT_NAME,
      buildThreadRuntimeStatePatchEventData({
        threadId: 'thread-1',
        source: 'web',
        patch: { preferences: { modelTier: 'opus', thinkingMode: null, thinkingEffort: null } },
        opId: 'op-2',
      }),
    )
    await writer.shutdown()

    await expect(readThreadRuntimePreferencesFromSession({ filePath, threadId: 'thread-1' })).resolves.toEqual({
      preferences: { modelTier: 'opus' },
      validEventCount: 2,
      ignoredEventCount: 0,
    })
  })

  it('persists all five valid thinking effort levels with latest valid value winning', async () => {
    const { writer, filePath } = await createSession()
    for (const thinkingEffort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      await writer.appendEvent(
        THREAD_RUNTIME_STATE_PATCH_EVENT_NAME,
        buildThreadRuntimeStatePatchEventData({
          threadId: 'thread-1',
          source: 'web',
          patch: { preferences: { thinkingEffort } },
        }),
      )
    }
    await writer.shutdown()

    await expect(readThreadRuntimePreferencesFromSession({ filePath, threadId: 'thread-1' })).resolves.toEqual({
      preferences: { thinkingEffort: 'max' },
      validEventCount: 5,
      ignoredEventCount: 0,
    })
  })

  it('ignores malformed events without clearing prior valid preferences', async () => {
    const { writer, filePath } = await createSession()
    await writer.appendEvent(
      THREAD_RUNTIME_STATE_PATCH_EVENT_NAME,
      buildThreadRuntimeStatePatchEventData({
        threadId: 'thread-1',
        source: 'web',
        patch: { preferences: { modelTier: 'sonnet', thinkingMode: false, thinkingEffort: 'xhigh' } },
      }),
    )
    await writer.appendEvent(THREAD_RUNTIME_STATE_PATCH_EVENT_NAME, {
      schemaVersion: 2,
      threadId: 'thread-1',
      source: 'web',
      patch: { preferences: { modelTier: 'opus' } },
    })
    await writer.appendEvent(THREAD_RUNTIME_STATE_PATCH_EVENT_NAME, {
      schemaVersion: 1,
      threadId: 'other-thread',
      source: 'web',
      patch: { preferences: { modelTier: 'opus' } },
    })
    await writer.appendEvent(THREAD_RUNTIME_STATE_PATCH_EVENT_NAME, {
      schemaVersion: 1,
      threadId: 'thread-1',
      source: 'web',
      patch: { futureFacet: { ok: true } },
    })
    await writer.appendEvent(THREAD_RUNTIME_STATE_PATCH_EVENT_NAME, {
      schemaVersion: 1,
      threadId: 'thread-1',
      source: 'web',
      patch: { preferences: { modelTier: 'medium' } },
    })
    await writer.appendEvent(THREAD_RUNTIME_STATE_PATCH_EVENT_NAME, {
      schemaVersion: 1,
      threadId: 'thread-1',
      source: 'web',
      patch: { preferences: { thinkingEffort: 'minimal' } },
    })
    await writer.appendEvent(THREAD_RUNTIME_STATE_PATCH_EVENT_NAME, {
      schemaVersion: 1,
      threadId: 'thread-1',
      source: 'web',
      patch: { preferences: { thinkingEffort: 1 } },
    })
    await writer.shutdown()

    await expect(readThreadRuntimePreferencesFromSession({ filePath, threadId: 'thread-1' })).resolves.toEqual({
      preferences: { modelTier: 'sonnet', thinkingMode: false, thinkingEffort: 'xhigh' },
      validEventCount: 1,
      ignoredEventCount: 6,
    })
  })

  it('returns no override for old sessions with no preference event', async () => {
    const { writer, filePath } = await createSession()
    await writer.appendEvent('session_rename', { label: 'Old thread' })
    await writer.shutdown()

    await expect(readThreadRuntimePreferencesFromSession({ filePath, threadId: 'thread-1' })).resolves.toEqual({
      preferences: {},
      validEventCount: 0,
      ignoredEventCount: 0,
    })
  })
})
