import { ZodError, z } from 'zod'
import type { PromptMessage } from '../prompts/index.js'
import type { StopReason, StreamEvent, TokenUsage } from '../streaming/types.js'
import type { ToolDefinition } from '../tools/types.js'
import type {
  ApprovalInputResponse,
  AskUserQuestionInputResponse,
  QueryArgs,
} from './types.js'

const promptBlockSchema = z.record(z.string(), z.unknown())

const promptMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.array(promptBlockSchema),
  })
  .strict()

const promptHistorySchema = z.array(promptMessageSchema)

const systemPromptInputSchema = z.union([z.string(), z.array(promptBlockSchema)])

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

function isAbortSignalLike(value: unknown): value is AbortSignal {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.aborted === 'boolean' &&
    typeof record.addEventListener === 'function' &&
    typeof record.removeEventListener === 'function'
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
    interactive: z.boolean().optional(),
    thinkingEnabled: z.boolean().optional(),
    outputFormat: outputFormatSchema.optional(),
    signal: z.custom<AbortSignal>(isAbortSignalLike, {
      message: 'Expected AbortSignal-compatible object',
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
    prompt: z.string(),
    history: z.array(promptMessageSchema).optional(),
    options: queryOptionsSchema.optional(),
  })
  .strict()

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
