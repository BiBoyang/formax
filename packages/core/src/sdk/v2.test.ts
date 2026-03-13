import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptMessage } from '../prompts/index.js'
import type { QueryArgs, QueryMessage, ResultMessage, SDKUserMessage } from './types.js'
import {
  unstable_v2_createSession,
  unstable_v2_prompt,
  unstable_v2_resumeSession,
} from './v2.js'

const { state } = vi.hoisted(() => ({
  state: {
    query: vi.fn(),
  },
}))

vi.mock('./query.js', () => ({
  query: (args: QueryArgs) => state.query(args),
}))

function createResultMessage(args: {
  sessionId: string
  result: string
  history?: PromptMessage[]
}): ResultMessage {
  return {
    type: 'result',
    session_id: args.sessionId,
    uuid: 'result-uuid',
    subtype: 'success',
    stop_reason: 'end_turn',
    result: args.result,
    usage: null,
    assistant: null,
    history:
      args.history ??
      [
        {
          role: 'user',
          content: [{ type: 'text', text: args.result }],
        },
      ],
    duration_ms: 1,
  }
}

function toGenerator(messages: QueryMessage[]): AsyncGenerator<QueryMessage, void> {
  return (async function* () {
    for (const message of messages) {
      yield message
    }
  })()
}

async function collectMessages(stream: AsyncGenerator<QueryMessage, void>): Promise<QueryMessage[]> {
  const out: QueryMessage[] = []
  for await (const message of stream) out.push(message)
  return out
}

function asPromptString(prompt: QueryArgs['prompt']): string {
  if (typeof prompt !== 'string') {
    throw new Error('v2 tests expect string prompt input')
  }
  return prompt
}

describe('sdk v2 session api', () => {
  beforeEach(() => {
    state.query.mockReset()
  })

  it('supports send/stream and rewrites per-turn session ids to logical session id', async () => {
    state.query.mockImplementation((args: QueryArgs) => {
      const history = [
        ...(args.history ?? []),
        {
          role: 'user' as const,
          content: [{ type: 'text', text: asPromptString(args.prompt) }],
        },
      ]
      return toGenerator([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'turn-session-id',
          cwd: '/tmp',
          model: 'claude-test',
          tools: [],
        },
        {
          type: 'assistant',
          session_id: 'turn-session-id',
          uuid: 'assistant-uuid',
          text: 'hello',
          blocks: [{ type: 'text', text: 'hello' }],
        },
        createResultMessage({
          sessionId: 'turn-session-id',
          result: 'hello',
          history,
        }),
      ])
    })

    const session = unstable_v2_createSession({ model: 'claude-test' })
    expect(() => session.sessionId).toThrow('sessionId is available after the first streamed message')
    await session.send('hello')

    const messages = await collectMessages(session.stream())
    const firstSessionId = messages[0]?.session_id
    expect(typeof firstSessionId).toBe('string')
    expect(firstSessionId?.length).toBeGreaterThan(0)
    expect(messages.every((message) => message.session_id === firstSessionId)).toBe(true)
    expect(session.sessionId).toBe(firstSessionId)
  })

  it('exposes sessionId after first streamed message before terminal result', async () => {
    state.query.mockImplementation((_args: QueryArgs) =>
      toGenerator([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'turn-session-id',
          cwd: '/tmp',
          model: 'claude-test',
          tools: [],
        },
        createResultMessage({
          sessionId: 'turn-session-id',
          result: 'done',
        }),
      ]),
    )

    const session = unstable_v2_createSession({})
    await session.send('hello')
    const stream = session.stream()
    const first = await stream.next()
    expect(first.done).toBe(false)
    const firstMessage = first.value as QueryMessage
    expect(firstMessage.session_id).toBeTruthy()
    expect(() => session.sessionId).not.toThrow()
    expect(session.sessionId).toBe(firstMessage.session_id)

    await collectMessages(stream)
  })

  it('preserves turn history across multiple sends', async () => {
    state.query.mockImplementation((args: QueryArgs) => {
      const history = [
        ...(args.history ?? []),
        { role: 'user' as const, content: [{ type: 'text', text: asPromptString(args.prompt) }] },
        { role: 'assistant' as const, content: [{ type: 'text', text: `echo:${asPromptString(args.prompt)}` }] },
      ]
      return toGenerator([
        createResultMessage({
          sessionId: 'turn-session-id',
          result: `echo:${asPromptString(args.prompt)}`,
          history,
        }),
      ])
    })

    const session = unstable_v2_createSession({})
    await session.send('turn-1')
    await collectMessages(session.stream())

    await session.send('turn-2')
    await collectMessages(session.stream())

    expect(state.query).toHaveBeenCalledTimes(2)
    const secondCallArgs = state.query.mock.calls[1][0] as QueryArgs
    expect(secondCallArgs.history).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'turn-1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'echo:turn-1' }] },
    ])
  })

  it('supports in-process resume with existing history', async () => {
    state.query.mockImplementation((args: QueryArgs) => {
      const history = [
        ...(args.history ?? []),
        { role: 'user' as const, content: [{ type: 'text', text: asPromptString(args.prompt) }] },
        { role: 'assistant' as const, content: [{ type: 'text', text: `ok:${asPromptString(args.prompt)}` }] },
      ]
      return toGenerator([
        createResultMessage({
          sessionId: 'turn-session-id',
          result: `ok:${asPromptString(args.prompt)}`,
          history,
        }),
      ])
    })

    const firstSession = unstable_v2_createSession({})
    await firstSession.send('one')
    const firstMessages = await collectMessages(firstSession.stream())
    const sessionId = firstMessages[0]?.session_id as string

    const resumed = unstable_v2_resumeSession(sessionId, {})
    expect(resumed.sessionId).toBe(sessionId)
    await resumed.send('two')
    await collectMessages(resumed.stream())

    expect(state.query).toHaveBeenCalledTimes(2)
    const secondCallArgs = state.query.mock.calls[1][0] as QueryArgs
    expect(secondCallArgs.history).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'one' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok:one' }] },
    ])
  })

  it('implements one-shot unstable_v2_prompt()', async () => {
    state.query.mockImplementation((args: QueryArgs) =>
      toGenerator([
        createResultMessage({
          sessionId: 'turn-session-id',
          result: `answer:${asPromptString(args.prompt)}`,
        }),
      ]),
    )

    const result = await unstable_v2_prompt('question?', { model: 'claude-test' })
    expect(result.type).toBe('result')
    expect(result.result).toBe('answer:question?')
    expect(state.query).toHaveBeenCalledWith({
      prompt: 'question?',
      options: { model: 'claude-test' },
    })
  })

  it('rewrites session_id for onMessage callbacks in v2 streams', async () => {
    const callbackMessages: QueryMessage[] = []
    state.query.mockImplementation((args: QueryArgs) => {
      const messages: QueryMessage[] = [
        {
          type: 'system',
          subtype: 'init',
          session_id: 'turn-session-id',
          cwd: '/tmp',
          model: 'claude-test',
          tools: [],
        },
        createResultMessage({
          sessionId: 'turn-session-id',
          result: 'ok',
          history: [{ role: 'user', content: [{ type: 'text', text: asPromptString(args.prompt) }] }],
        }),
      ]

      for (const message of messages) {
        args.options?.onMessage?.(message)
      }

      return toGenerator(messages)
    })

    const session = unstable_v2_createSession({
      onMessage: (message) => callbackMessages.push(message),
    })
    await session.send('hello')
    const streamed = await collectMessages(session.stream())
    const logicalSessionId = streamed[0]?.session_id

    expect(logicalSessionId).toBeTruthy()
    expect(callbackMessages).toHaveLength(2)
    expect(callbackMessages.every((message) => message.session_id === logicalSessionId)).toBe(true)
  })

  it('supports SDK user message input in send()', async () => {
    state.query.mockImplementation((args: QueryArgs) =>
      toGenerator([
        createResultMessage({
          sessionId: 'turn-session-id',
          result: asPromptString(args.prompt),
        }),
      ]),
    )

    const session = unstable_v2_createSession({})
    await session.send({
      role: 'user',
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' },
      ],
    })
    await collectMessages(session.stream())

    expect(state.query).toHaveBeenCalledWith({
      prompt: 'hello world',
      history: [],
      options: {},
    })
  })

  it('preserves leading/trailing whitespace for SDK user message blocks', async () => {
    state.query.mockImplementation((args: QueryArgs) =>
      toGenerator([
        createResultMessage({
          sessionId: 'turn-session-id',
          result: asPromptString(args.prompt),
        }),
      ]),
    )

    const session = unstable_v2_createSession({})
    await session.send({
      role: 'user',
      content: [
        { type: 'text', text: '  hello' },
        { type: 'text', text: ' world  ' },
      ],
    })
    await collectMessages(session.stream())

    expect(state.query).toHaveBeenCalledWith({
      prompt: '  hello world  ',
      history: [],
      options: {},
    })
  })

  it('rejects unsupported non-text SDK user message blocks', async () => {
    const session = unstable_v2_createSession({})
    const invalidMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_use', id: 'u1', name: 'tool', input: {} },
      ],
    } as unknown as SDKUserMessage

    await expect(
      session.send(invalidMessage),
    ).rejects.toThrow('SDKUserMessage currently supports only text blocks')
  })

  it('rejects resume while a turn is pending to avoid state forking', async () => {
    state.query.mockImplementation((args: QueryArgs) =>
      toGenerator([
        createResultMessage({
          sessionId: 'turn-session-id',
          result: asPromptString(args.prompt),
          history: [{ role: 'user', content: [{ type: 'text', text: asPromptString(args.prompt) }] }],
        }),
      ]),
    )

    const session = unstable_v2_createSession({})
    await session.send('first turn')
    const streamed = await collectMessages(session.stream())
    const sessionId = streamed[0]?.session_id as string

    await session.send('another pending turn')
    expect(() => unstable_v2_resumeSession(sessionId, {})).toThrow(
      'Cannot resume session while a turn is active or pending',
    )
  })

  it('keeps closed session handles unusable after resume', async () => {
    state.query.mockImplementation((args: QueryArgs) =>
      toGenerator([
        createResultMessage({
          sessionId: 'turn-session-id',
          result: asPromptString(args.prompt),
          history: [{ role: 'user', content: [{ type: 'text', text: asPromptString(args.prompt) }] }],
        }),
      ]),
    )

    const oldHandle = unstable_v2_createSession({})
    await oldHandle.send('seed')
    const firstMessages = await collectMessages(oldHandle.stream())
    const sessionId = firstMessages[0]?.session_id as string

    const resumed = unstable_v2_resumeSession(sessionId, {})
    oldHandle.close()
    await resumed.send('next')
    await collectMessages(resumed.stream())

    await expect(oldHandle.send('should-fail')).rejects.toThrow('Session is closed')
  })

  it('cannot resume session after all handles are closed', async () => {
    state.query.mockImplementation((args: QueryArgs) =>
      toGenerator([
        createResultMessage({
          sessionId: 'turn-session-id',
          result: asPromptString(args.prompt),
          history: [{ role: 'user', content: [{ type: 'text', text: asPromptString(args.prompt) }] }],
        }),
      ]),
    )

    const session = unstable_v2_createSession({})
    await session.send('seed')
    const firstMessages = await collectMessages(session.stream())
    const sessionId = firstMessages[0]?.session_id as string

    session.close()
    expect(() => unstable_v2_resumeSession(sessionId, {})).toThrow('is not available in this process')
  })

  it('supports empty-string prompts as pending turns', async () => {
    state.query.mockImplementation((args: QueryArgs) =>
      toGenerator([
        createResultMessage({
          sessionId: 'turn-session-id',
          result: `echo:${asPromptString(args.prompt)}`,
          history: [{ role: 'user', content: [{ type: 'text', text: asPromptString(args.prompt) }] }],
        }),
      ]),
    )

    const session = unstable_v2_createSession({})
    await session.send('')
    const messages = await collectMessages(session.stream())
    const result = [...messages].reverse().find((message) => message.type === 'result')

    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.result).toBe('echo:')
    }
  })
})
