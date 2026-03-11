import type { ExecutionContext } from '../executor/index.js'
import type { StreamEvent } from '../../streaming/types.js'
import type { ToolCall, ToolResult } from '../types.js'
import type { AskUserAnswers, AskUserQuestion, UserInputManager } from './userInputManager.js'

type InteractiveRequestEvent = Extract<StreamEvent, { type: 'approval_request' | 'ask_user_question' }>
const TOOL_ERROR_PREFIX = 'Error: '

export type InteractivePromptDescriptor =
  | {
      kind: 'approval'
      requestEvent: Extract<StreamEvent, { type: 'approval_request' }>
      questions?: AskUserQuestion[]
      emitToolUpdate?: boolean
    }
  | {
      kind: 'ask_user_question'
      requestEvent: Extract<StreamEvent, { type: 'ask_user_question' }>
      questions: AskUserQuestion[]
      emitToolUpdate?: boolean
    }

export type ApprovalLikeAnswerShape = {
  decision?: string
  feedback?: string
}

export type InteractivePromptTransactionResult<TAnswers extends AskUserAnswers> =
  | { ok: true; answers: TAnswers }
  | { ok: false; result: ToolResult }

export function createAskUserQuestionPromptDescriptor(args: {
  call: Pick<ToolCall, 'id'>
  questions: AskUserQuestion[]
  emitToolUpdate?: boolean
}): InteractivePromptDescriptor {
  return {
    kind: 'ask_user_question',
    questions: args.questions,
    requestEvent: {
      type: 'ask_user_question',
      toolUseId: args.call.id,
      questions: args.questions,
    },
    ...(args.emitToolUpdate !== undefined ? { emitToolUpdate: args.emitToolUpdate } : {}),
  }
}

export function createApprovalPromptDescriptor(args: {
  call: Pick<ToolCall, 'id'>
  toolName: string
  action: unknown
  effectiveDecision: unknown
  suggestions?: string[]
  workspaceRequest?: { dir: string } | null
  blockedPath?: string
  decisionReason?: string
  agentID?: string
  emitToolUpdate?: boolean
}): InteractivePromptDescriptor {
  return {
    kind: 'approval',
    requestEvent: {
      type: 'approval_request',
      toolUseId: args.call.id,
      toolName: args.toolName,
      action: args.action,
      effectiveDecision: args.effectiveDecision,
      ...(args.suggestions ? { suggestions: args.suggestions } : {}),
      ...(args.workspaceRequest !== undefined ? { workspaceRequest: args.workspaceRequest } : {}),
      ...(args.blockedPath ? { blockedPath: args.blockedPath } : {}),
      ...(args.decisionReason ? { decisionReason: args.decisionReason } : {}),
      ...(args.agentID ? { agentID: args.agentID } : {}),
    },
    ...(args.emitToolUpdate !== undefined ? { emitToolUpdate: args.emitToolUpdate } : {}),
  }
}

export function getInteractivePromptFailureMessage(args: {
  result: Pick<ToolResult, 'content'>
  fallbackMessage?: string
}): string {
  const content = String(args.result.content ?? '').trim()
  if (!content) return args.fallbackMessage ?? 'Request failed'
  if (content.startsWith(TOOL_ERROR_PREFIX)) {
    return content.slice(TOOL_ERROR_PREFIX.length)
  }
  return content
}

export function throwInteractivePromptFailure(args: {
  result: Pick<ToolResult, 'content'>
  fallbackMessage?: string
}): never {
  throw new Error(getInteractivePromptFailureMessage(args))
}

export function toInteractivePromptFailureToolResult(args: {
  toolUseId: string
  result: Pick<ToolResult, 'content'>
  fallbackMessage?: string
}): ToolResult {
  const message = getInteractivePromptFailureMessage({
    result: args.result,
    fallbackMessage: args.fallbackMessage,
  })
  return {
    tool_use_id: args.toolUseId,
    content: `${TOOL_ERROR_PREFIX}${message}`,
    is_error: true,
  }
}

export function normalizeApprovalLikeAnswer<TAnswer extends ApprovalLikeAnswerShape>(answers: TAnswer): {
  decision: string
  feedback: string
} {
  return {
    decision: String(answers.decision || '').trim().toLowerCase(),
    feedback: String(answers.feedback || '').trim(),
  }
}

export async function runInteractivePromptTransaction<TAnswers extends AskUserAnswers>(args: {
  call: ToolCall
  ctx: ExecutionContext
  userInput: UserInputManager | null
  questions?: AskUserQuestion[]
  descriptor?: InteractivePromptDescriptor
  requestEvent?: InteractiveRequestEvent
  beforeRequest?: () => void
  unavailableContent: string
  abortedContent: string
  requireInteractive?: boolean
  emitToolUpdate?: boolean
}): Promise<InteractivePromptTransactionResult<TAnswers>> {
  const questions =
    args.descriptor?.kind === 'ask_user_question'
      ? args.descriptor.questions
      : (args.descriptor?.questions ?? args.questions ?? [])
  const requestEvent = args.descriptor?.requestEvent ?? args.requestEvent
  const emitToolUpdate = args.descriptor?.emitToolUpdate ?? args.emitToolUpdate

  if (!args.userInput || (args.requireInteractive === true && args.ctx.interactive === false)) {
    return {
      ok: false,
      result: {
        tool_use_id: args.call.id,
        content: args.unavailableContent,
        is_error: true,
      },
    }
  }

  if (args.ctx.signal?.aborted) {
    return {
      ok: false,
      result: {
        tool_use_id: args.call.id,
        content: args.abortedContent,
        is_error: true,
      },
    }
  }

  args.beforeRequest?.()

  if (requestEvent) {
    args.ctx.onEvent?.(requestEvent)
  }

  const answersPromise = args.userInput.requestAnswers({
    toolUseId: args.call.id,
    questions,
    signal: args.ctx.signal,
  })

  if (emitToolUpdate !== false) {
    args.ctx.onEvent?.({ type: 'tool_update', id: args.call.id, middleLines: [] })
  }

  try {
    return {
      ok: true,
      answers: (await answersPromise) as TAnswers,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      result: {
        tool_use_id: args.call.id,
        content: `Error: ${msg}`,
        is_error: true,
      },
    }
  }
}
