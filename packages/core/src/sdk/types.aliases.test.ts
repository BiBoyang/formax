import { describe, expectTypeOf, it } from 'vitest'
import type {
  AccountInfo,
  ApiKeySource,
  AssistantMessage,
  CanUseTool,
  Options,
  PromptRequest,
  PromptRequestOption,
  PromptResponse,
  ElicitationRequest,
  ElicitationResult,
  OnElicitation,
  OutputFormat,
  OutputFormatType,
  BaseOutputFormat,
  PermissionResult,
  PermissionUpdate,
  PartialAssistantMessage,
  QueryMessage,
  QueryOptions,
  Query,
  ResultMessage,
  McpSetServersResult,
  RewindFilesResult,
  AskUserQuestionRequest,
  AskUserQuestionInputResponse,
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

  it('aligns prompt interaction type aliases', () => {
    expectTypeOf<PromptRequest>().toEqualTypeOf<AskUserQuestionRequest>()
    expectTypeOf<PromptRequestOption>().toEqualTypeOf<AskUserQuestionRequest['options'][number]>()
    expectTypeOf<PromptResponse>().toEqualTypeOf<AskUserQuestionInputResponse>()
  })

  it('aligns output format type aliases', () => {
    expectTypeOf<OutputFormatType>().toEqualTypeOf<'json_schema'>()
    expectTypeOf<OutputFormat['type']>().toEqualTypeOf<OutputFormatType>()
    expectTypeOf<BaseOutputFormat>().toEqualTypeOf<{ type: OutputFormatType }>()
  })

  it('aligns elicitation type aliases', () => {
    expectTypeOf<QueryOptions['onElicitation']>().toEqualTypeOf<OnElicitation | undefined>()
    expectTypeOf<Parameters<OnElicitation>[0]>().toEqualTypeOf<ElicitationRequest>()
    expectTypeOf<Awaited<ReturnType<OnElicitation>>>().toEqualTypeOf<ElicitationResult>()
  })

  it('aligns permission callback type aliases', () => {
    expectTypeOf<QueryOptions['canUseTool']>().toEqualTypeOf<CanUseTool | undefined>()
    expectTypeOf<Awaited<ReturnType<CanUseTool>>>().toEqualTypeOf<PermissionResult>()
    expectTypeOf<NonNullable<Extract<PermissionResult, { behavior: 'allow' }>['updatedPermissions']>>()
      .toEqualTypeOf<PermissionUpdate[]>()
  })

  it('aligns account api-key source compatibility type', () => {
    expectTypeOf<NonNullable<AccountInfo['apiKeySource']>>().toEqualTypeOf<ApiKeySource | 'env' | 'config'>()
  })
})
