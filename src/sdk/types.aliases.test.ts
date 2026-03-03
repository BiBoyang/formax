import { describe, expectTypeOf, it } from 'vitest'
import type {
  AssistantMessage,
  Options,
  PartialAssistantMessage,
  QueryMessage,
  QueryOptions,
  Query,
  ResultMessage,
  McpSetServersResult,
  RewindFilesResult,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultError,
  SDKResultMessage,
  SDKResultSuccess,
  SDKSystemMessage,
  SystemMessage,
} from './types.js'

describe('SDK type alias alignment', () => {
  it('aligns Options alias', () => {
    expectTypeOf<Options>().toEqualTypeOf<QueryOptions>()
  })

  it('aligns SDK message aliases', () => {
    expectTypeOf<SDKSystemMessage>().toEqualTypeOf<SystemMessage>()
    expectTypeOf<SDKPartialAssistantMessage>().toEqualTypeOf<PartialAssistantMessage>()
    expectTypeOf<SDKAssistantMessage>().toEqualTypeOf<AssistantMessage>()
    expectTypeOf<SDKResultMessage>().toEqualTypeOf<ResultMessage>()
    expectTypeOf<SDKMessage>().toEqualTypeOf<QueryMessage>()
  })

  it('narrows SDK result success/error aliases', () => {
    expectTypeOf<SDKResultSuccess['subtype']>().toEqualTypeOf<'success'>()
    expectTypeOf<SDKResultError['subtype']>().toEqualTypeOf<
      Exclude<ResultMessage['subtype'], 'success'>
    >()
  })

  it('aligns Query control method return type aliases', () => {
    expectTypeOf<Awaited<ReturnType<Query['setMcpServers']>>>().toEqualTypeOf<McpSetServersResult>()
    expectTypeOf<Awaited<ReturnType<Query['rewindFiles']>>>().toEqualTypeOf<RewindFilesResult>()
  })
})
