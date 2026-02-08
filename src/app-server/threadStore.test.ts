import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findSessionFileBySessionId, SessionWriter } from '../features/repl/sessionSave/index.js'
import { ThreadStore } from './threadStore.js'

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

describe('ThreadStore', () => {
  it('supports start/resume/read using sessionSave', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})
    expect(thread.id).toBeTypeOf('string')
    expect(thread.cwd).toBe(cwd)

    const filePath = await findSessionFileBySessionId({ cwd, env, sessionId: thread.id })
    expect(filePath).toBeTruthy()
    const writer = await SessionWriter.openExisting({ filePath: filePath! })
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

    const readOut = await store.readThread(thread.id)
    expect(readOut.thread.id).toBe(thread.id)
    expect(readOut.transcriptPreview).toEqual(
      expect.arrayContaining([{ role: 'user', text: 'hello thread' }]),
    )
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
    const filePath = await findSessionFileBySessionId({ cwd, env, sessionId: thread.id })
    expect(filePath).toBeTruthy()
    const writer = await SessionWriter.openExisting({ filePath: filePath! })
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
})
