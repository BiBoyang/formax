import { describe, expect, it } from 'vitest'
import {
  APP_SERVER_PROTOCOL_VERSION,
  parseCommandDispatchParams,
  parseInitializeParams,
  parseRuntimeDefaultsPatchParams,
  parseThreadArchiveParams,
  parseThreadByIdParams,
  parseThreadGroupHideParams,
  parseThreadListParams,
  parseThreadMessagesParams,
  parseThreadRenameParams,
  parseThreadReplayParams,
  parseThreadRuntimeStatePatchParams,
  parseThreadStartParams,
  parseTurnInputSubmitParams,
  parseTurnInterruptParams,
  parseTurnStartParams,
} from './protocol.js'

describe('protocol parsers', () => {
  it('exports protocol version', () => {
    expect(APP_SERVER_PROTOCOL_VERSION).toBe('0.2')
  })

  it('parses thread runtime-state preference patches strictly', () => {
    expect(
      parseThreadRuntimeStatePatchParams({
        threadId: ' t1 ',
        opId: ' op-1 ',
        patch: { preferences: { modelTier: 'opus', thinkingMode: false } },
      }),
    ).toEqual({
      threadId: 't1',
      opId: 'op-1',
      patch: { preferences: { modelTier: 'opus', thinkingMode: false } },
    })
    expect(
      parseThreadRuntimeStatePatchParams({
        threadId: 't1',
        patch: { preferences: { modelTier: null, thinkingMode: null } },
      }),
    ).toEqual({
      threadId: 't1',
      patch: { preferences: { modelTier: null, thinkingMode: null } },
    })
    expect(parseThreadRuntimeStatePatchParams({ threadId: 't1', patch: {} })).toEqual({
      threadId: 't1',
      patch: { preferences: {} },
    })
    expect(() =>
      parseThreadRuntimeStatePatchParams({ threadId: 't1', patch: { mode: 'plan' } }),
    ).toThrow('Invalid params.patch.mode: unknown field')
    expect(() =>
      parseThreadRuntimeStatePatchParams({ threadId: 't1', patch: { preferences: { modelTier: 'medium' } } }),
    ).toThrow('Invalid params.patch.preferences.modelTier: expected haiku|sonnet|opus')
    expect(() =>
      parseThreadRuntimeStatePatchParams({ threadId: 't1', patch: { preferences: { thinkingMode: 'high' } } }),
    ).toThrow('Invalid params.patch.preferences.thinkingMode: expected boolean|null')
    expect(() =>
      parseThreadRuntimeStatePatchParams({ threadId: 't1', patch: { preferences: { mode: 'plan' } } }),
    ).toThrow('Invalid params.patch.preferences.mode: unknown field')
  })

  it('parses global runtime defaults patches without null clears', () => {
    expect(parseRuntimeDefaultsPatchParams({ modelTier: 'haiku', thinkingMode: true })).toEqual({
      modelTier: 'haiku',
      thinkingMode: true,
    })
    expect(parseRuntimeDefaultsPatchParams({})).toEqual({})
    expect(() => parseRuntimeDefaultsPatchParams({ modelTier: null })).toThrow(
      'Invalid params.modelTier: expected haiku|sonnet|opus',
    )
    expect(() => parseRuntimeDefaultsPatchParams({ thinkingMode: null })).toThrow(
      'Invalid params.thinkingMode: expected boolean',
    )
    expect(() => parseRuntimeDefaultsPatchParams({ effort: 'medium' })).toThrow(
      'Invalid params.effort: unknown field',
    )
  })

  it('parses initialize params and validates clientInfo', () => {
    expect(parseInitializeParams(undefined)).toEqual({})
    expect(parseInitializeParams(null)).toEqual({})
    expect(parseInitializeParams({})).toEqual({})
    expect(parseInitializeParams({ clientInfo: { name: ' web ', version: ' 1.0 ' } })).toEqual({
      clientInfo: { name: 'web', version: '1.0' },
    })
    expect(() => parseInitializeParams({ clientInfo: {} })).toThrow('Invalid params.clientInfo.name')
    expect(() => parseInitializeParams({ clientInfo: { name: 'web' } })).toThrow('Invalid params.clientInfo.version')

    expect(() => parseInitializeParams('x')).toThrow('Invalid params: expected object')
    expect(() => parseInitializeParams({ clientInfo: 'x' })).toThrow('Invalid params.clientInfo: expected object')
    expect(() => parseInitializeParams({ clientInfo: { name: '', version: '1.0' } })).toThrow('Invalid params.clientInfo.name')
    expect(() => parseInitializeParams({ clientInfo: { name: 'web', version: '' } })).toThrow('Invalid params.clientInfo.version')
  })

  it('parses thread start and by-id params', () => {
    expect(parseThreadStartParams(undefined)).toEqual({})
    expect(parseThreadStartParams({})).toEqual({})
    expect(parseThreadStartParams({ cwd: ' /repo ' })).toEqual({ cwd: '/repo' })
    expect(() => parseThreadStartParams('x')).toThrow('Invalid params: expected object')
    expect(() => parseThreadStartParams({ cwd: 1 })).toThrow('Invalid params.cwd: expected string')
    expect(() => parseThreadStartParams({ cwd: '   ' })).toThrow('Invalid params.cwd: expected non-empty string')

    expect(parseThreadByIdParams({ threadId: ' t1 ' })).toEqual({ threadId: 't1' })
    expect(() => parseThreadByIdParams(null)).toThrow('Invalid params: expected object')
    expect(() => parseThreadByIdParams({ threadId: '' })).toThrow('Invalid params.threadId: expected non-empty string')
  })

  it('parses archive, rename, and group-hide params', () => {
    expect(() => parseThreadArchiveParams(undefined)).toThrow('Invalid params: expected object')
    expect(parseThreadArchiveParams({ threadId: 't1' })).toEqual({ threadId: 't1' })
    expect(parseThreadArchiveParams({ threadId: 't1', opId: ' op-1 ' })).toEqual({ threadId: 't1', opId: 'op-1' })
    expect(() => parseThreadArchiveParams({ threadId: '' })).toThrow('Invalid params.threadId: expected non-empty string')
    expect(() => parseThreadArchiveParams({ threadId: 't1', opId: 1 })).toThrow('Invalid params.opId: expected string')

    expect(() => parseThreadRenameParams(undefined)).toThrow('Invalid params: expected object')
    expect(parseThreadRenameParams({ threadId: 't1', label: ' new ' })).toEqual({ threadId: 't1', label: 'new' })
    expect(() => parseThreadRenameParams({ threadId: 't1', label: null })).toThrow(
      'Invalid params.label: expected non-empty string',
    )
    expect(() => parseThreadRenameParams({ threadId: 't1', label: '' })).toThrow('Invalid params.label: expected non-empty string')

    expect(() => parseThreadGroupHideParams(undefined)).toThrow('Invalid params: expected object')
    expect(parseThreadGroupHideParams({ cwd: ' /repo ' })).toEqual({ cwd: '/repo' })
    expect(() => parseThreadGroupHideParams({ cwd: '' })).toThrow('Invalid params.cwd: expected non-empty string')
  })

  it('parses thread list params', () => {
    expect(parseThreadListParams(undefined)).toEqual({ limit: 20 })
    expect(parseThreadListParams(null)).toEqual({ limit: 20 })
    expect(parseThreadListParams({})).toEqual({ limit: 20 })
    expect(parseThreadListParams({ limit: 5, cursor: ' c1 ', archived: true })).toEqual({
      limit: 5,
      cursor: 'c1',
      archived: true,
    })

    expect(() => parseThreadListParams('x')).toThrow('Invalid params: expected object')
    expect(() => parseThreadListParams({ limit: 0 })).toThrow('Invalid params.limit: expected positive integer')
    expect(() => parseThreadListParams({ limit: 201 })).toThrow('Invalid params.limit: max 200')
    expect(() => parseThreadListParams({ archived: 'yes' })).toThrow('Invalid params.archived: expected boolean')
  })

  it('parses thread messages and replay params', () => {
    expect(() => parseThreadMessagesParams(null)).toThrow('Invalid params: expected object')
    expect(parseThreadMessagesParams({ threadId: 't1' })).toEqual({ threadId: 't1', limit: 50 })
    expect(parseThreadMessagesParams({ threadId: 't1', limit: 10, cursor: ' c2 ' })).toEqual({
      threadId: 't1',
      limit: 10,
      cursor: 'c2',
    })
    expect(() => parseThreadMessagesParams({ threadId: 't1', limit: 201 })).toThrow('Invalid params.limit: max 200')

    expect(() => parseThreadReplayParams(undefined)).toThrow('Invalid params: expected object')
    expect(parseThreadReplayParams({ threadId: 't1' })).toEqual({ threadId: 't1', limit: 200 })
    expect(parseThreadReplayParams({ threadId: 't1', after: 0, limit: 10 })).toEqual({ threadId: 't1', after: 0, limit: 10 })
    expect(() => parseThreadReplayParams({ threadId: 't1', after: -1 })).toThrow(
      'Invalid params.after: expected non-negative integer',
    )
    expect(() => parseThreadReplayParams({ threadId: 't1', limit: 501 })).toThrow('Invalid params.limit: max 500')
  })

  it('parses turn start params', () => {
    expect(
      parseTurnStartParams({
        threadId: 't1',
        input: { text: ' hello ' },
        mode: 'plan',
        cwd: ' /repo ',
      }),
    ).toEqual({
      threadId: 't1',
      input: { text: 'hello' },
      mode: 'plan',
      cwd: '/repo',
    })

    expect(parseTurnStartParams({ threadId: 't1', input: { text: 'x' }, mode: undefined })).toEqual({
      threadId: 't1',
      input: { text: 'x' },
    })

    expect(() => parseTurnStartParams('x')).toThrow('Invalid params: expected object')
    expect(() => parseTurnStartParams({ threadId: 't1', input: 'x' })).toThrow('Invalid params.input: expected object')
    expect(() => parseTurnStartParams({ threadId: 't1', input: { text: '' } })).toThrow(
      'Invalid params.input.text: expected non-empty string',
    )
    expect(() => parseTurnStartParams({ threadId: 't1', input: { text: 'x' }, mode: 'invalid' })).toThrow(
      'Invalid params.mode: expected normal|acceptEdits|plan',
    )
  })

  it('parses command dispatch params', () => {
    expect(() => parseCommandDispatchParams(undefined)).toThrow('Invalid params: expected object')
    expect(
      parseCommandDispatchParams({
        threadId: 't1',
        command: ' /help ',
        mode: 'normal',
        cwd: ' /repo ',
      }),
    ).toEqual({
      threadId: 't1',
      command: '/help',
      mode: 'normal',
      cwd: '/repo',
    })
    expect(parseCommandDispatchParams({ threadId: 't1', command: '/help', mode: undefined })).toEqual({
      threadId: 't1',
      command: '/help',
    })

    expect(() => parseCommandDispatchParams({ threadId: 't1', command: 'help' })).toThrow(
      'Invalid params.command: expected slash command',
    )
    expect(() => parseCommandDispatchParams({ threadId: 't1', command: '/help', mode: 'invalid' })).toThrow(
      'Invalid params.mode: expected normal|acceptEdits|plan',
    )
  })

  it('parses turn interrupt and input submit params', () => {
    expect(() => parseTurnInterruptParams(undefined)).toThrow('Invalid params: expected object')
    expect(parseTurnInterruptParams({ threadId: 't1', turnId: 'turn-1' })).toEqual({ threadId: 't1', turnId: 'turn-1' })
    expect(() => parseTurnInterruptParams({ threadId: 't1', turnId: '' })).toThrow(
      'Invalid params.turnId: expected non-empty string',
    )

    expect(() => parseTurnInputSubmitParams(undefined)).toThrow('Invalid params: expected object')
    expect(
      parseTurnInputSubmitParams({
        threadId: 't1',
        turnId: 'turn-1',
        inputId: 'input-1',
        answers: { a: 1 },
        submissionId: ' sub-1 ',
      }),
    ).toEqual({
      threadId: 't1',
      turnId: 'turn-1',
      inputId: 'input-1',
      answers: { a: '1' },
      submissionId: 'sub-1',
    })

    expect(
      parseTurnInputSubmitParams({
        threadId: 't1',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        answers: { ok: true },
      }),
    ).toEqual({
      threadId: 't1',
      turnId: 'turn-1',
      inputId: 'tool-1',
      answers: { ok: 'true' },
      toolUseId: 'tool-1',
    })

    expect(() => parseTurnInputSubmitParams({ threadId: 't1', turnId: 'turn-1', inputId: '', answers: {} })).toThrow(
      'Invalid params.inputId: expected non-empty string',
    )
    expect(() => parseTurnInputSubmitParams({ threadId: 't1', turnId: 'turn-1', inputId: 'i1', answers: null })).toThrow(
      'Invalid params.answers: expected object',
    )
  })
})
