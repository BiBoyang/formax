import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { useSessionPersistence } from './useSessionPersistence'

const {
  buildMessageByIdMapMock,
  markDirtyMessageIdsFromTransitionMock,
  persistDirtyStableMessagesMock,
  runSessionTurnCompletionSideEffectsMock,
} = vi.hoisted(() => ({
  buildMessageByIdMapMock: vi.fn((messages: Msg[]) => new Map(messages.map((msg) => [msg.id, msg]))),
  markDirtyMessageIdsFromTransitionMock: vi.fn(),
  persistDirtyStableMessagesMock: vi.fn(),
  runSessionTurnCompletionSideEffectsMock: vi.fn(),
}))

vi.mock('./sessionDirtyTracking', () => ({
  buildMessageByIdMap: buildMessageByIdMapMock,
  markDirtyMessageIdsFromTransition: markDirtyMessageIdsFromTransitionMock,
}))

vi.mock('./sessionLifecycle', () => ({
  persistDirtyStableMessages: persistDirtyStableMessagesMock,
}))

vi.mock('./sessionTurnCompletion', () => ({
  runSessionTurnCompletionSideEffects: runSessionTurnCompletionSideEffectsMock,
}))

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function msg(id: string): Msg {
  return {
    id,
    role: 'assistant',
    content: id,
    timestamp: new Date(),
  }
}

function Harness(props: Parameters<typeof useSessionPersistence>[0]) {
  useSessionPersistence(props)
  return <Text>ready</Text>
}

describe('useSessionPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ensures initial session writer when session save is enabled with an initial file path', async () => {
    const ensureSessionWriter = vi.fn(async () => undefined)

    render(
      <Harness
        sessionSaveEnabled={true}
        initialSessionFilePath='/tmp/session.jsonl'
        ensureSessionWriter={ensureSessionWriter}
        messages={[]}
        previousMessagesRef={{ current: [] }}
        messageByIdRef={{ current: new Map() }}
        dirtyMessageIdsRef={{ current: new Set() }}
        sessionWriterRef={{ current: null }}
        lastPersistedSigByMsgIdRef={{ current: new Map() }}
        lastPersistedMsgByIdRef={{ current: new Map() }}
        isLoading={false}
        previousIsLoadingRef={{ current: false }}
        historyRef={{ current: [] as ChatHistory }}
        engine={{} as any}
        cwd='/tmp/cwd'
        mode='normal'
        getPlanPath={() => null}
        attemptedSessionIds={new Set<string>()}
        checkedTopicPromptKeys={new Set<string>()}
        model='sonnet'
      />,
    )

    await tick()

    expect(ensureSessionWriter).toHaveBeenCalledTimes(1)
  })

  it('runs mark-dirty before persist on message updates when session save is enabled', async () => {
    const order: string[] = []
    markDirtyMessageIdsFromTransitionMock.mockImplementation(() => {
      order.push('mark')
    })
    persistDirtyStableMessagesMock.mockImplementation(() => {
      order.push('persist')
    })

    const previousMessagesRef = { current: [] as Msg[] }
    const messageByIdRef = { current: new Map<string, Msg>() }
    const dirtyMessageIdsRef = { current: new Set<string>() }

    const app = render(
      <Harness
        sessionSaveEnabled={true}
        ensureSessionWriter={vi.fn(async () => undefined)}
        messages={[msg('m1')]}
        previousMessagesRef={previousMessagesRef}
        messageByIdRef={messageByIdRef}
        dirtyMessageIdsRef={dirtyMessageIdsRef}
        sessionWriterRef={{ current: null }}
        lastPersistedSigByMsgIdRef={{ current: new Map() }}
        lastPersistedMsgByIdRef={{ current: new Map() }}
        isLoading={false}
        previousIsLoadingRef={{ current: false }}
        historyRef={{ current: [] as ChatHistory }}
        engine={{} as any}
        cwd='/tmp/cwd'
        mode='normal'
        getPlanPath={() => null}
        attemptedSessionIds={new Set<string>()}
        checkedTopicPromptKeys={new Set<string>()}
        model='sonnet'
      />,
    )

    await tick()
    order.length = 0

    app.rerender(
      <Harness
        sessionSaveEnabled={true}
        ensureSessionWriter={vi.fn(async () => undefined)}
        messages={[msg('m1'), msg('m2')]}
        previousMessagesRef={previousMessagesRef}
        messageByIdRef={messageByIdRef}
        dirtyMessageIdsRef={dirtyMessageIdsRef}
        sessionWriterRef={{ current: null }}
        lastPersistedSigByMsgIdRef={{ current: new Map() }}
        lastPersistedMsgByIdRef={{ current: new Map() }}
        isLoading={false}
        previousIsLoadingRef={{ current: false }}
        historyRef={{ current: [] as ChatHistory }}
        engine={{} as any}
        cwd='/tmp/cwd'
        mode='normal'
        getPlanPath={() => null}
        attemptedSessionIds={new Set<string>()}
        checkedTopicPromptKeys={new Set<string>()}
        model='sonnet'
      />,
    )

    await tick()

    expect(order).toEqual(['mark', 'persist'])
    expect(markDirtyMessageIdsFromTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        previous: [expect.objectContaining({ id: 'm1' })],
        next: [expect.objectContaining({ id: 'm1' }), expect.objectContaining({ id: 'm2' })],
        messageByIdRef,
        dirtyMessageIdsRef,
      }),
    )
  })

  it('clears dirty state and refreshes maps when session save is disabled', async () => {
    const nextMessages = [msg('m1')]
    const previousMessagesRef = { current: [msg('old')] }
    const messageByIdRef = { current: new Map<string, Msg>() }
    const dirtyMessageIdsRef = { current: new Set<string>(['dirty-1']) }

    render(
      <Harness
        sessionSaveEnabled={false}
        ensureSessionWriter={vi.fn(async () => undefined)}
        messages={nextMessages}
        previousMessagesRef={previousMessagesRef}
        messageByIdRef={messageByIdRef}
        dirtyMessageIdsRef={dirtyMessageIdsRef}
        sessionWriterRef={{ current: null }}
        lastPersistedSigByMsgIdRef={{ current: new Map() }}
        lastPersistedMsgByIdRef={{ current: new Map() }}
        isLoading={false}
        previousIsLoadingRef={{ current: false }}
        historyRef={{ current: [] as ChatHistory }}
        engine={{} as any}
        cwd='/tmp/cwd'
        mode='normal'
        getPlanPath={() => null}
        attemptedSessionIds={new Set<string>()}
        checkedTopicPromptKeys={new Set<string>()}
        model='sonnet'
      />,
    )

    await tick()

    expect(buildMessageByIdMapMock).toHaveBeenCalledWith(nextMessages)
    expect(previousMessagesRef.current).toBe(nextMessages)
    expect(messageByIdRef.current).toBeInstanceOf(Map)
    expect(dirtyMessageIdsRef.current.size).toBe(0)
    expect(markDirtyMessageIdsFromTransitionMock).not.toHaveBeenCalled()
    expect(persistDirtyStableMessagesMock).not.toHaveBeenCalled()
  })

  it('runs turn-completion side effects with previous loading state bookkeeping', async () => {
    const previousIsLoadingRef = { current: true }
    const sessionWriterRef = { current: { appendEvent: vi.fn() } as any }

    render(
      <Harness
        sessionSaveEnabled={true}
        ensureSessionWriter={vi.fn(async () => undefined)}
        messages={[msg('m1')]}
        previousMessagesRef={{ current: [] }}
        messageByIdRef={{ current: new Map() }}
        dirtyMessageIdsRef={{ current: new Set() }}
        sessionWriterRef={sessionWriterRef}
        lastPersistedSigByMsgIdRef={{ current: new Map() }}
        lastPersistedMsgByIdRef={{ current: new Map() }}
        isLoading={false}
        previousIsLoadingRef={previousIsLoadingRef}
        historyRef={{ current: [] as ChatHistory }}
        engine={{} as any}
        cwd='/tmp/cwd'
        mode='plan'
        getPlanPath={() => '/tmp/current-plan.md'}
        attemptedSessionIds={new Set<string>(['s1'])}
        checkedTopicPromptKeys={new Set<string>(['k1'])}
        model='sonnet'
      />,
    )

    await tick()

    expect(runSessionTurnCompletionSideEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        writer: sessionWriterRef.current,
        wasLoading: true,
        isLoading: false,
        cwd: '/tmp/cwd',
        mode: 'plan',
        planPath: '/tmp/current-plan.md',
        model: 'sonnet',
      }),
    )
    expect(previousIsLoadingRef.current).toBe(false)
  })
})
