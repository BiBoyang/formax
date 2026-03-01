import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { SessionWriter } from '../../sessionSave/writer'
import {
  buildPersistedMsgRefMap,
  buildPersistedSigMap,
  ensureSessionWriter,
  openInitialSessionWriter,
  persistDirtyStableMessages,
  persistStableMessagesFromSnapshot,
  shutdownSessionWriter,
  startNewSessionWriter,
  shouldPersistUiMsg,
} from './sessionLifecycle'

function createMsg(overrides: Partial<Msg>): Msg {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'ok',
    timestamp: new Date(),
    ...overrides,
  }
}

function createRefs() {
  return {
    sessionWriterRef: { current: null as any },
    sessionWriterInitPromiseRef: { current: null as Promise<void> | null },
    lastPersistedSigByMsgIdRef: { current: new Map<string, string>() },
    lastPersistedMsgByIdRef: { current: new Map<string, Msg>() },
  }
}

describe('sessionLifecycle', () => {
  it('does not persist streaming or running tool messages', () => {
    const streaming = createMsg({ id: 's1', isStreaming: true })
    const runningTool = createMsg({
      id: 't1',
      role: 'tool',
      toolInfo: { name: 'Read', status: 'running', input: {} },
    })
    const completedTool = createMsg({
      id: 't2',
      role: 'tool',
      toolInfo: { name: 'Read', status: 'completed', result: 'done', input: {} },
    })

    expect(shouldPersistUiMsg(streaming)).toBe(false)
    expect(shouldPersistUiMsg(runningTool)).toBe(false)
    expect(shouldPersistUiMsg(completedTool)).toBe(true)
  })

  it('builds signature map only for stable messages', () => {
    const map = buildPersistedSigMap([
      createMsg({ id: 'a1', content: 'first' }),
      createMsg({ id: 's1', isStreaming: true }),
      createMsg({
        id: 't1',
        role: 'tool',
        toolInfo: { name: 'Write', status: 'running', input: {} },
      }),
      createMsg({ id: 'a2', content: 'second' }),
    ])

    expect(Array.from(map.keys())).toEqual(['a1', 'a2'])
  })

  it('builds stable message ref map only for stable messages', () => {
    const stable = createMsg({ id: 'a1', content: 'first' })
    const map = buildPersistedMsgRefMap([
      stable,
      createMsg({ id: 's1', isStreaming: true }),
      createMsg({
        id: 't1',
        role: 'tool',
        toolInfo: { name: 'Write', status: 'running', input: {} },
      }),
    ])

    expect(Array.from(map.keys())).toEqual(['a1'])
    expect(map.get('a1')).toBe(stable)
  })

  it('skips stringify and append for unchanged message references', () => {
    const appendStableMsg = vi.fn(async () => {})
    const writer = { appendStableMsg }
    const sigRef = { current: new Map<string, string>() }
    const msgRef = { current: new Map<string, Msg>() }
    const stable = createMsg({ id: 'a1', content: 'first' })

    persistStableMessagesFromSnapshot({
      writer,
      messages: [stable],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })
    persistStableMessagesFromSnapshot({
      writer,
      messages: [stable],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })

    expect(appendStableMsg).toHaveBeenCalledTimes(1)
  })

  it('appends changed stable messages and prunes removed ids', () => {
    const appendStableMsg = vi.fn(async () => {})
    const writer = { appendStableMsg }
    const sigRef = { current: new Map<string, string>() }
    const msgRef = { current: new Map<string, Msg>() }
    const first = createMsg({ id: 'a1', content: 'first' })
    const updated = createMsg({ id: 'a1', content: 'second' })

    persistStableMessagesFromSnapshot({
      writer,
      messages: [first],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })
    persistStableMessagesFromSnapshot({
      writer,
      messages: [updated],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })
    persistStableMessagesFromSnapshot({
      writer,
      messages: [],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })

    expect(appendStableMsg).toHaveBeenCalledTimes(2)
    expect(sigRef.current.size).toBe(0)
    expect(msgRef.current.size).toBe(0)
  })

  it('persists only dirty ids and prunes removed/non-stable entries', () => {
    const appendStableMsg = vi.fn(async () => {})
    const writer = { appendStableMsg }
    const stable = createMsg({ id: 'a1', content: 'first' })
    const messageByIdRef = { current: new Map<string, Msg>([['a1', stable]]) }
    const dirtyMessageIdsRef = { current: new Set<string>(['a1', 'removed']) }
    const sigRef = { current: new Map<string, string>([['removed', 'x']]) }
    const msgRef = { current: new Map<string, Msg>([['removed', createMsg({ id: 'removed' })]]) }

    persistDirtyStableMessages({
      writer,
      dirtyMessageIdsRef,
      messageByIdRef,
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })

    expect(appendStableMsg).toHaveBeenCalledTimes(1)
    expect(appendStableMsg).toHaveBeenCalledWith(stable)
    expect(dirtyMessageIdsRef.current.size).toBe(0)
    expect(sigRef.current.has('removed')).toBe(false)
    expect(msgRef.current.has('removed')).toBe(false)
  })

  it('no-ops snapshot persistence when writer is missing or messages are empty', () => {
    const sigRef = { current: new Map<string, string>([['a1', 'sig']]) }
    const msgRef = { current: new Map<string, Msg>([['a1', createMsg({ id: 'a1', content: 'x' })]]) }

    persistStableMessagesFromSnapshot({
      writer: null,
      messages: [createMsg({ id: 'a1', content: 'x' })],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })

    const appendStableMsg = vi.fn(async () => undefined)
    persistStableMessagesFromSnapshot({
      writer: { appendStableMsg },
      messages: [],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })
    expect(appendStableMsg).not.toHaveBeenCalled()
  })

  it('skips unstable and same-signature stable messages during snapshot persistence', () => {
    const appendStableMsg = vi.fn(async () => undefined)
    const stableOriginal = createMsg({ id: 'a1', content: 'same' })
    const stableClone = createMsg({ id: 'a1', content: 'same' })
    const sig = JSON.stringify(stableOriginal)
    const sigRef = { current: new Map<string, string>([['a1', sig]]) }
    const msgRef = { current: new Map<string, Msg>([['a1', createMsg({ id: 'a1', content: 'old-ref' })]]) }

    persistStableMessagesFromSnapshot({
      writer: { appendStableMsg },
      messages: [createMsg({ id: 's1', isStreaming: true }), stableClone],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })

    expect(appendStableMsg).not.toHaveBeenCalled()
  })

  it('no-ops dirty persistence for missing writer, empty dirty set, and unchanged refs', () => {
    const stable = createMsg({ id: 'a1', content: 'x' })
    const dirtyMessageIdsRef = { current: new Set<string>() }
    const messageByIdRef = { current: new Map<string, Msg>([['a1', stable]]) }
    const sigRef = { current: new Map<string, string>() }
    const msgRef = { current: new Map<string, Msg>([['a1', stable]]) }

    persistDirtyStableMessages({
      writer: null,
      dirtyMessageIdsRef,
      messageByIdRef,
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })

    const appendStableMsg = vi.fn(async () => undefined)
    persistDirtyStableMessages({
      writer: { appendStableMsg },
      dirtyMessageIdsRef,
      messageByIdRef,
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })

    dirtyMessageIdsRef.current = new Set(['a1'])
    persistDirtyStableMessages({
      writer: { appendStableMsg },
      dirtyMessageIdsRef,
      messageByIdRef,
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })

    expect(appendStableMsg).not.toHaveBeenCalled()
  })

  it('skips dirty persistence when signature is unchanged for a new object reference', () => {
    const appendStableMsg = vi.fn(async () => undefined)
    const stable = createMsg({ id: 'a1', content: 'same' })
    const sig = JSON.stringify(stable)
    const dirtyMessageIdsRef = { current: new Set<string>(['a1']) }
    const messageByIdRef = { current: new Map<string, Msg>([['a1', createMsg({ id: 'a1', content: 'same' })]]) }
    const sigRef = { current: new Map<string, string>([['a1', sig]]) }
    const msgRef = { current: new Map<string, Msg>([['a1', createMsg({ id: 'a1', content: 'older-ref' })]]) }

    persistDirtyStableMessages({
      writer: { appendStableMsg },
      dirtyMessageIdsRef,
      messageByIdRef,
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })

    expect(appendStableMsg).not.toHaveBeenCalled()
  })

  it('startNewSessionWriter creates writer and appends history snapshot', async () => {
    const writer = {
      appendHistorySnapshot: vi.fn(async () => undefined),
    } as any
    const createSpy = vi.spyOn(SessionWriter, 'createNew').mockResolvedValue({
      filePath: '/tmp/session.jsonl',
      writer,
    } as any)
    const refs = createRefs()
    const historyRef = { current: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] as any }

    await startNewSessionWriter({
      sessionSaveEnabled: true,
      cwd: '/repo',
      env: {},
      model: 'claude',
      historyRef,
      refs,
    })

    expect(createSpy).toHaveBeenCalledWith({ cwd: '/repo', env: {}, model: 'claude' })
    expect(refs.sessionWriterRef.current).toBe(writer)
    expect(writer.appendHistorySnapshot).toHaveBeenCalledWith(historyRef.current)
    createSpy.mockRestore()
  })

  it('startNewSessionWriter no-ops when session save is disabled', async () => {
    const createSpy = vi.spyOn(SessionWriter, 'createNew')
    const refs = createRefs()
    await startNewSessionWriter({
      sessionSaveEnabled: false,
      cwd: '/repo',
      env: {},
      model: 'claude',
      historyRef: { current: [] as any },
      refs,
    })
    expect(createSpy).not.toHaveBeenCalled()
    createSpy.mockRestore()
  })

  it('openInitialSessionWriter opens existing session and persists resume metadata', async () => {
    const writer = {
      appendEvent: vi.fn(async () => undefined),
      appendHistorySnapshot: vi.fn(async () => undefined),
    } as any
    const openSpy = vi.spyOn(SessionWriter, 'openExisting').mockResolvedValue(writer)
    const refs = createRefs()
    const historyRef = { current: [{ role: 'assistant', content: [{ type: 'text', text: 'yo' }] }] as any }
    const initialMessages = [createMsg({ id: 'm1', content: 'hello' })]
    const startNewWriter = vi.fn(async () => undefined)

    await openInitialSessionWriter({
      sessionSaveEnabled: true,
      initialSession: { filePath: '/tmp/existing.jsonl', messages: initialMessages },
      historyRef,
      refs,
      startNewWriter,
    })

    expect(openSpy).toHaveBeenCalledWith({ filePath: '/tmp/existing.jsonl' })
    expect(startNewWriter).not.toHaveBeenCalled()
    expect(writer.appendEvent).toHaveBeenCalledWith('resume')
    expect(writer.appendHistorySnapshot).toHaveBeenCalledWith(historyRef.current)
    openSpy.mockRestore()
  })

  it('openInitialSessionWriter starts new writer without file path and no-ops when already initialized', async () => {
    const refs = createRefs()
    const historyRef = { current: [] as any }
    const startNewWriter = vi.fn(async () => undefined)

    await openInitialSessionWriter({
      sessionSaveEnabled: true,
      initialSession: {},
      historyRef,
      refs,
      startNewWriter,
    })
    expect(startNewWriter).toHaveBeenCalledTimes(1)

    refs.sessionWriterRef.current = { existing: true } as any
    await openInitialSessionWriter({
      sessionSaveEnabled: true,
      initialSession: { filePath: '/tmp/ignored.jsonl', messages: [] },
      historyRef,
      refs,
      startNewWriter,
    })
    expect(startNewWriter).toHaveBeenCalledTimes(1)
  })

  it('openInitialSessionWriter no-ops when session save is disabled and supports missing messages', async () => {
    const refs = createRefs()
    const historyRef = { current: [] as any }
    const startNewWriter = vi.fn(async () => undefined)

    await openInitialSessionWriter({
      sessionSaveEnabled: false,
      initialSession: { filePath: '/tmp/ignored.jsonl' },
      historyRef,
      refs,
      startNewWriter,
    })
    expect(startNewWriter).not.toHaveBeenCalled()

    const writer = {
      appendEvent: vi.fn(async () => undefined),
      appendHistorySnapshot: vi.fn(async () => undefined),
    } as any
    const openSpy = vi.spyOn(SessionWriter, 'openExisting').mockResolvedValue(writer)
    await openInitialSessionWriter({
      sessionSaveEnabled: true,
      initialSession: { filePath: '/tmp/existing-no-messages.jsonl' },
      historyRef,
      refs,
      startNewWriter,
    })
    expect(openSpy).toHaveBeenCalledWith({ filePath: '/tmp/existing-no-messages.jsonl' })
    openSpy.mockRestore()
  })

  it('shutdownSessionWriter clears ref and shuts writer down', async () => {
    const shutdown = vi.fn(async () => undefined)
    const refs = createRefs()
    refs.sessionWriterRef.current = { shutdown } as any

    await shutdownSessionWriter(refs as any)
    expect(refs.sessionWriterRef.current).toBeNull()
    expect(shutdown).toHaveBeenCalledTimes(1)

    await shutdownSessionWriter(refs as any)
    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it('ensureSessionWriter handles disabled/already-initialized/inflight/new-init paths', async () => {
    const refs = createRefs()
    const openInitialWriter = vi.fn(async () => undefined)

    await ensureSessionWriter({
      sessionSaveEnabled: false,
      refs: refs as any,
      openInitialWriter,
    })
    expect(openInitialWriter).not.toHaveBeenCalled()

    refs.sessionWriterRef.current = { ready: true } as any
    await ensureSessionWriter({
      sessionSaveEnabled: true,
      refs: refs as any,
      openInitialWriter,
    })
    expect(openInitialWriter).not.toHaveBeenCalled()
    refs.sessionWriterRef.current = null

    refs.sessionWriterInitPromiseRef.current = Promise.resolve()
    await ensureSessionWriter({
      sessionSaveEnabled: true,
      refs: refs as any,
      openInitialWriter,
    })
    expect(openInitialWriter).not.toHaveBeenCalled()
    refs.sessionWriterInitPromiseRef.current = null

    await ensureSessionWriter({
      sessionSaveEnabled: true,
      refs: refs as any,
      openInitialWriter,
    })
    expect(openInitialWriter).toHaveBeenCalledTimes(1)
    expect(refs.sessionWriterInitPromiseRef.current).toBeNull()
  })

  it('ensureSessionWriter keeps external replacement of init promise', async () => {
    const refs = createRefs()
    const external = Promise.resolve()
    const openInitialWriter = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            refs.sessionWriterInitPromiseRef.current = external
            resolve()
          }, 0)
        }),
    )

    await ensureSessionWriter({
      sessionSaveEnabled: true,
      refs: refs as any,
      openInitialWriter,
    })

    expect(refs.sessionWriterInitPromiseRef.current).toBe(external)
  })
})
