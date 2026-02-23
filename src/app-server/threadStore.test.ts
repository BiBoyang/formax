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

    const readBeforePersist = await store.readThread(thread.id)
    expect(readBeforePersist.thread.id).toBe(thread.id)
    expect(readBeforePersist.transcriptPreview).toEqual([])

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
