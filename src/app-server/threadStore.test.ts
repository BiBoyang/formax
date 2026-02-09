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

    const messagesOut = await store.listThreadMessages({ threadId: thread.id, limit: 50 })
    expect(messagesOut.data).toEqual(
      expect.arrayContaining([{ id: expect.any(String), kind: 'message', role: 'user', text: 'hello thread' }]),
    )
    expect(messagesOut.nextCursor).toBeNull()
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

  it('supports pagination in thread/messages', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})

    const filePath = await findSessionFileBySessionId({ cwd, env, sessionId: thread.id })
    expect(filePath).toBeTruthy()
    const writer = await SessionWriter.openExisting({ filePath: filePath! })
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

    const filePath = await findSessionFileBySessionId({ cwd, env, sessionId: thread.id })
    expect(filePath).toBeTruthy()
    const writer = await SessionWriter.openExisting({ filePath: filePath! })
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

  it('includes persisted tool messages in thread/messages', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})

    const filePath = await findSessionFileBySessionId({ cwd, env, sessionId: thread.id })
    expect(filePath).toBeTruthy()
    const writer = await SessionWriter.openExisting({ filePath: filePath! })
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
        expect.objectContaining({
          id: 'tool-1',
          kind: 'tool',
          toolUseId: 'call-1',
          toolName: 'Bash',
          status: 'completed',
        }),
      ]),
    )
    const tool = out.data.find((entry) => entry.id === 'tool-1') as any
    expect(tool.paramsText).toContain('command=')
    expect(tool.detailLines).toEqual(expect.arrayContaining(['Ran command for 3s', 'update', 'end']))
  })

  it('hydrates tool rows from app_tool_event records when ui_msg has no tool role', async () => {
    const { cwd, env, store } = await createStore()
    const thread = await store.startThread({})

    const filePath = await findSessionFileBySessionId({ cwd, env, sessionId: thread.id })
    expect(filePath).toBeTruthy()
    const writer = await SessionWriter.openExisting({ filePath: filePath! })
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
    expect(tool.paramsText).toBe('command="npm run type-check"')
    expect(tool.detailLines).toEqual(expect.arrayContaining(['running...', '> tsc --noEmit']))
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
