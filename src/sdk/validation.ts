import { ZodError, z } from 'zod'
import type { PromptMessage } from '../prompts/index.js'
import type { StopReason, StreamEvent, TokenUsage } from '../streaming/types.js'
import type { ToolDefinition } from '../tools/types.js'
import type {
  ApprovalInputResponse,
  AskUserQuestionInputResponse,
  GetSessionMessagesOptions,
  ListSessionsOptions,
  QueryArgs,
  SDKUserMessage,
  SDKSessionInfo,
  SessionMessage,
} from './types.js'

const promptBlockSchema = z.record(z.string(), z.unknown())

const promptMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.array(promptBlockSchema),
  })
  .strict()

const promptHistorySchema = z.array(promptMessageSchema)

const sdkUserTextBlockSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
  })
  .strict()

const sdkUserMessageSchema = z
  .object({
    role: z.literal('user'),
    content: z.array(sdkUserTextBlockSchema),
  })
  .strict()

const systemPromptPresetSchema = z
  .object({
    type: z.literal('preset'),
    preset: z.literal('claude_code'),
    append: z.string().optional(),
  })
  .strict()

const systemPromptInputSchema = z.union([
  z.string(),
  z.array(promptBlockSchema),
  systemPromptPresetSchema,
])

const toolDefinitionSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    input_schema: z.unknown(),
  })
  .strict()

const toolDefinitionsSchema = z.array(toolDefinitionSchema)

const tokenUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  })
  .strict()

const stopReasonSchema = z.union([z.string(), z.null()])

const outputFormatSchema = z
  .object({
    type: z.literal('json_schema'),
    schema: z.record(z.string(), z.unknown()),
    maxRetries: z.number().int().nonnegative().max(10).optional(),
  })
  .strict()

const thinkingConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('adaptive') }).strict(),
  z
    .object({
      type: z.literal('enabled'),
      budgetTokens: z.number().int().positive().optional(),
    })
    .strict(),
  z.object({ type: z.literal('disabled') }).strict(),
])

function isAbortSignalLike(value: unknown): value is AbortSignal {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.aborted === 'boolean' &&
    typeof record.addEventListener === 'function' &&
    typeof record.removeEventListener === 'function'
  )
}

function isAbortControllerLike(value: unknown): value is AbortController {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.abort === 'function' &&
    isAbortSignalLike(record.signal)
  )
}

const queryOptionsSchema = z
  .object({
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string().optional()).optional(),
    model: z.string().optional(),
    promptProfile: z.enum(['lite', 'full']).optional(),
    systemPrompt: systemPromptInputSchema.optional(),
    appendSystemPrompt: systemPromptInputSchema.optional(),
    includePartialMessages: z.boolean().optional(),
    allowedTools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
    replMode: z.enum(['normal', 'acceptEdits', 'plan']).optional(),
    permissionMode: z.enum(['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']).optional(),
    interactive: z.boolean().optional(),
    thinking: thinkingConfigSchema.optional(),
    thinkingEnabled: z.boolean().optional(),
    outputFormat: outputFormatSchema.optional(),
    signal: z.custom<AbortSignal>(isAbortSignalLike, {
      message: 'Expected AbortSignal-compatible object',
    }).optional(),
    abortController: z.custom<AbortController>(isAbortControllerLike, {
      message: 'Expected AbortController-compatible object',
    }).optional(),
    onInputRequest: z.custom<(...args: any[]) => unknown>((value) => typeof value === 'function', {
      message: 'Expected function',
    }).optional(),
    onMessage: z.custom<(...args: any[]) => unknown>((value) => typeof value === 'function', {
      message: 'Expected function',
    }).optional(),
  })
  .strict()

const queryArgsSchema = z
  .object({
    prompt: z.union([
      z.string(),
      z.custom<AsyncIterable<unknown>>((value) => {
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false
        return typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
      }, { message: 'Expected string or AsyncIterable<SDKUserMessage>' }),
    ]),
    history: z.array(promptMessageSchema).optional(),
    options: queryOptionsSchema.optional(),
  })
  .strict()

const listSessionsOptionsSchema = z
  .object({
    dir: z.string().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict()

const getSessionMessagesOptionsSchema = z
  .object({
    dir: z.string().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict()

const sessionIdSchema = z.string().trim().min(1, 'Expected non-empty session id')

const sessionMetaSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  gitBranch: z.string().optional(),
})

const rawSessionSummarySchema = z.object({
  filePath: z.string(),
  meta: sessionMetaSchema,
  updatedAt: z.date(),
  messageCount: z.number().int().nullable(),
  lastUserPrompt: z.string().nullable(),
  label: z.string().nullable(),
})

const rawSessionSummaryListSchema = z.array(rawSessionSummarySchema)

const rawSessionReplaySchema = z.object({
  meta: sessionMetaSchema,
  history: promptHistorySchema,
})

const sessionMessageSchema = z
  .object({
    type: z.enum(['user', 'assistant']),
    uuid: z.string(),
    session_id: z.string(),
    message: promptMessageSchema,
    parent_tool_use_id: z.null(),
  })
  .strict()

const sessionMessageListSchema = z.array(sessionMessageSchema)

const sdkSessionInfoSchema = z
  .object({
    sessionId: z.string(),
    summary: z.string(),
    lastModified: z.number().int().nonnegative(),
    fileSize: z.number().int().nonnegative(),
    customTitle: z.string().optional(),
    firstPrompt: z.string().optional(),
    gitBranch: z.string().optional(),
    cwd: z.string().optional(),
  })
  .strict()

const sdkSessionInfoListSchema = z.array(sdkSessionInfoSchema)

const workspaceRequestSchema = z.object({ dir: z.string() }).strict().nullable()

const approvalRequestEventSchema = z
  .object({
    type: z.literal('approval_request'),
    toolUseId: z.string(),
    toolName: z.string(),
    action: z.unknown(),
    effectiveDecision: z.unknown(),
    suggestions: z.array(z.string()).optional(),
    workspaceRequest: workspaceRequestSchema.optional(),
  })
  .strict()

const askUserQuestionOptionSchema = z
  .object({
    label: z.string(),
    description: z.string(),
  })
  .strict()

const askUserQuestionItemSchema = z
  .object({
    question: z.string(),
    header: z.string(),
    fieldId: z.string().optional(),
    options: z.array(askUserQuestionOptionSchema),
    multiSelect: z.boolean(),
  })
  .strict()

const askUserQuestionEventSchema = z
  .object({
    type: z.literal('ask_user_question'),
    toolUseId: z.string(),
    questions: z.array(askUserQuestionItemSchema),
  })
  .strict()

const approvalInputResponseSchema = z
  .object({
    decision: z.enum(['approve', 'approve_remember', 'deny', 'feedback']),
    feedback: z.string().optional(),
    scope: z.enum(['session', 'project', 'global']).optional(),
  })
  .strict()

const askUserQuestionInputResponseSchema = z
  .object({
    answers: z.record(z.string(), z.string()),
  })
  .strict()

function isErrorLike(value: unknown): boolean {
  if (value instanceof Error) return true
  if (!value || typeof value !== 'object') return false
  return typeof (value as { message?: unknown }).message === 'string'
}

const streamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assistant_delta'), text: z.string() }).strict(),
  z.object({ type: z.literal('thinking_delta'), thinking: z.string() }).strict(),
  z.object({ type: z.literal('thinking_stop') }).strict(),
  z.object({ type: z.literal('tool_start'), id: z.string(), name: z.string() }).strict(),
  z.object({ type: z.literal('tool_input'), id: z.string(), input: z.unknown() }).strict(),
  z
    .object({
      type: z.literal('tool_update'),
      id: z.string(),
      middleLines: z.array(z.string()).optional(),
      transcriptLines: z.array(z.string()).optional(),
      toolUses: z.number().int().nonnegative().optional(),
      usage: tokenUsageSchema.optional(),
      nestedTools: z
        .array(
          z
            .object({
              id: z.string(),
              name: z.string(),
              input: z.record(z.string(), z.unknown()),
              status: z.enum(['running', 'completed', 'error']),
              summary: z.string().optional(),
            })
            .strict(),
        )
        .optional(),
    })
    .strict(),
  z.object({ type: z.literal('usage'), usage: tokenUsageSchema, model: z.string().optional() }).strict(),
  z
    .object({
      type: z.literal('tool_end'),
      id: z.string(),
      result: z
        .object({
          tool_use_id: z.string(),
          content: z.string(),
          is_error: z.boolean().optional(),
          extraTextBlocks: z.array(z.string()).optional(),
        })
        .strict(),
      patchStartLineNumber: z.number().int().optional(),
    })
    .strict(),
  approvalRequestEventSchema,
  askUserQuestionEventSchema,
  z
    .object({
      type: z.literal('error'),
      error: z.custom<Error>(isErrorLike, { message: 'Expected Error-like object' }),
    })
    .strict(),
  z.object({ type: z.literal('complete') }).strict(),
])

export function parseQueryArgsInput(input: unknown): QueryArgs {
  return queryArgsSchema.parse(input) as QueryArgs
}

export function parseSDKUserMessageInput(input: unknown): SDKUserMessage {
  return sdkUserMessageSchema.parse(input) as SDKUserMessage
}

export function parseListSessionsOptionsInput(input: unknown): ListSessionsOptions {
  if (input == null) return {}
  return listSessionsOptionsSchema.parse(input) as ListSessionsOptions
}

export function parseGetSessionMessagesOptionsInput(input: unknown): GetSessionMessagesOptions {
  if (input == null) return {}
  return getSessionMessagesOptionsSchema.parse(input) as GetSessionMessagesOptions
}

export function parseSessionIdInput(input: unknown): string {
  return sessionIdSchema.parse(input)
}

export function parseRawSessionSummaryListOutput(input: unknown): Array<{
  filePath: string
  meta: {
    sessionId: string
    cwd: string
    gitBranch?: string
  }
  updatedAt: Date
  messageCount: number | null
  lastUserPrompt: string | null
  label: string | null
}> {
  return rawSessionSummaryListSchema.parse(input) as Array<{
    filePath: string
    meta: {
      sessionId: string
      cwd: string
      gitBranch?: string
    }
    updatedAt: Date
    messageCount: number | null
    lastUserPrompt: string | null
    label: string | null
  }>
}

export function parseRawSessionReplayOutput(input: unknown): {
  sessionId: string
  history: PromptMessage[]
} {
  const parsed = rawSessionReplaySchema.parse(input)
  return {
    sessionId: parsed.meta.sessionId,
    history: parsed.history as PromptMessage[],
  }
}

export function parseSDKSessionInfoListOutput(input: unknown): SDKSessionInfo[] {
  return sdkSessionInfoListSchema.parse(input) as SDKSessionInfo[]
}

export function parseSessionMessageListOutput(input: unknown): SessionMessage[] {
  return sessionMessageListSchema.parse(input) as SessionMessage[]
}

export function parsePromptHistory(input: unknown): PromptMessage[] {
  return promptHistorySchema.parse(input) as PromptMessage[]
}

export function parseToolDefinitions(input: unknown): ToolDefinition[] {
  return toolDefinitionsSchema.parse(input) as ToolDefinition[]
}

export function parseStreamEvent(input: unknown): StreamEvent {
  return streamEventSchema.parse(input) as StreamEvent
}

export function parseTokenUsage(input: unknown): TokenUsage | null {
  if (input == null) return null
  return tokenUsageSchema.parse(input) as TokenUsage
}

export function parseStopReason(input: unknown): StopReason {
  return stopReasonSchema.parse(input) as StopReason
}

export function parseApprovalInputResponse(input: unknown): ApprovalInputResponse | null {
  if (input == null) return null
  return approvalInputResponseSchema.parse(input) as ApprovalInputResponse
}

export function parseAskUserQuestionInputResponse(input: unknown): AskUserQuestionInputResponse | null {
  if (input == null) return null
  return askUserQuestionInputResponseSchema.parse(input) as AskUserQuestionInputResponse
}

export function asValidationError(error: unknown, context: string): Error {
  if (error instanceof ZodError) {
    const details = error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
        return `${path}${issue.message}`
      })
      .join('; ')
    return new Error(`${context}: ${details}`)
  }
  return error instanceof Error ? error : new Error(`${context}: ${String(error)}`)
}
