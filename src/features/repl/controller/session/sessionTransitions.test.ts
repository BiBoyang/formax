import { describe, expect, it, vi } from 'vitest'
import type { ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../components/tool/ToolMessage'
import { runNewSessionTransition, runResumeSessionTransition } from './sessionTransitions'

function createMsg(id: string, content: string): Msg {
  return {
    id,
    role: 'assistant',
    content,
    timestamp: new Date(),
  }
}

describe('runResumeSessionTransition', () => {
  it('applies restored transcript, then awaits shared surface reset transaction', async () => {
    const messages = [createMsg('m1', 'hello')]
    const history: ChatHistory = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] as any
    const order: string[] = []

    const beginNewSession = vi.fn(() => order.push('begin'))
    const resetSessionState = vi.fn(() => order.push('reset'))
    const replaceTranscript = vi.fn(async () => {
      order.push('replace')
      order.push('surface-reset:start')
      await new Promise((resolve) => setTimeout(resolve, 0))
      order.push('surface-reset:end')
    })

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages, history }),
      beginNewSession,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState,
      historyRef: { current: [] },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap: () => new Map(),
      buildPersistedMsgRefMap: () => new Map(),
    })

    expect(order).toEqual(['begin', 'reset', 'replace', 'surface-reset:start', 'surface-reset:end'])
    expect(replaceTranscript).toHaveBeenCalledWith(messages)
  })

  it('drops trailing /resume command rows from replayed messages', async () => {
    const replayMessages = [
      createMsg('m1', 'hello'),
      {
        id: 'm2',
        role: 'user' as const,
        content: '/resume',
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const history: ChatHistory = [] as any
    const replaceTranscript = vi.fn(async () => undefined)
    const buildPersistedSigMap = vi.fn(() => new Map())
    const buildPersistedMsgRefMap = vi.fn(() => new Map())

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap,
      buildPersistedMsgRefMap,
    })

    expect(replaceTranscript).toHaveBeenCalledWith([replayMessages[0]])
    expect(buildPersistedSigMap).toHaveBeenCalledWith([replayMessages[0]])
    expect(buildPersistedMsgRefMap).toHaveBeenCalledWith([replayMessages[0]])
  })

  it('drops trailing /resume + Resume cancelled pair from replayed messages', async () => {
    const replayMessages = [
      createMsg('m1', 'hello'),
      {
        id: 'm2',
        role: 'user' as const,
        content: '/resume',
        timestamp: new Date(),
      },
      {
        id: 'm3',
        role: 'assistant' as const,
        ui: { kind: 'command_subline' as const },
        content: 'Resume cancelled',
        timestamp: new Date(),
      },
    ] satisfies Msg[]
    const history: ChatHistory = [] as any
    const replaceTranscript = vi.fn(async () => undefined)
    const buildPersistedSigMap = vi.fn(() => new Map())
    const buildPersistedMsgRefMap = vi.fn(() => new Map())

    await runResumeSessionTransition({
      filePath: '/tmp/session.jsonl',
      readSessionFile: async () => ({ messages: replayMessages, history }),
      beginNewSession: () => undefined,
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => undefined,
      historyRef: { current: [] },
      replaceTranscript,
      openExistingSessionWriter: async () => {
        throw new Error('should not be called')
      },
      buildPersistedSigMap,
      buildPersistedMsgRefMap,
    })

    expect(replaceTranscript).toHaveBeenCalledWith([replayMessages[0]])
    expect(buildPersistedSigMap).toHaveBeenCalledWith([replayMessages[0]])
    expect(buildPersistedMsgRefMap).toHaveBeenCalledWith([replayMessages[0]])
  })
})

describe('runNewSessionTransition', () => {
  it('awaits replaceTranscript before resolving', async () => {
    const order: string[] = []
    let releaseReplace!: () => void
    const replaceGate = new Promise<void>((resolve) => {
      releaseReplace = resolve
    })

    const transitionPromise = runNewSessionTransition({
      beginNewSession: () => {
        order.push('begin')
      },
      sessionSaveEnabled: false,
      sessionWriterRef: { current: null },
      sessionWriterInitPromiseRef: { current: null },
      lastPersistedSigByMsgIdRef: { current: new Map() },
      lastPersistedMsgByIdRef: { current: new Map() },
      resetSessionState: () => {
        order.push('reset')
      },
      replaceTranscript: async () => {
        order.push('replace:start')
        await replaceGate
        order.push('replace:end')
      },
    }).then(() => {
      order.push('transition:done')
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['begin', 'reset', 'replace:start'])

    releaseReplace()
    await transitionPromise
    expect(order).toEqual(['begin', 'reset', 'replace:start', 'replace:end', 'transition:done'])
  })
})
