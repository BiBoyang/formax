import { randomUUID } from 'node:crypto'
import type { StreamEvent } from '../../streaming/types.js'
import type {
  InputRequestMessage,
  InputRequestResponse,
  QueryMessage,
} from '../types.js'
import {
  asValidationError,
  parseApprovalInputResponse,
  parseAskUserQuestionInputResponse,
} from '../validation.js'

type UserInputManagerLike = {
  submitAnswers: (toolUseId: string, answers: Record<string, string>) => void
  reject: (toolUseId: string, error: Error) => void
}

type HandleInputRequestEventArgs = {
  event: StreamEvent
  sessionId: string
  emitMessage: (message: QueryMessage) => void
  onInputRequest?: (
    request: InputRequestMessage,
  ) => Promise<InputRequestResponse> | InputRequestResponse
  userInputManager?: UserInputManagerLike | null
  addPendingResolution: (task: Promise<void>) => void
}

function toApprovalAnswers(
  response: ReturnType<typeof parseApprovalInputResponse>,
): Record<string, string> {
  if (!response) {
    return { decision: 'deny' }
  }

  const out: Record<string, string> = {
    decision: response.decision,
  }

  if (response.scope) {
    out.scope = response.scope
  }

  if (typeof response.feedback === 'string' && response.feedback.trim()) {
    out.feedback = response.feedback
  }

  return out
}

function toAskUserAnswers(
  response: ReturnType<typeof parseAskUserQuestionInputResponse>,
): Record<string, string> {
  if (!response) return {}

  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(response.answers)) {
    out[String(key)] = String(value ?? '')
  }
  return out
}

function handleApprovalRequest(args: Omit<HandleInputRequestEventArgs, 'event'> & {
  event: Extract<StreamEvent, { type: 'approval_request' }>
}): void {
  const requestMessage: InputRequestMessage = {
    type: 'input_request',
    subtype: 'approval_request',
    session_id: args.sessionId,
    uuid: randomUUID(),
    tool_use_id: args.event.toolUseId,
    tool_name: args.event.toolName,
    action: args.event.action,
    effective_decision: args.event.effectiveDecision,
    ...(args.event.suggestions ? { suggestions: args.event.suggestions } : {}),
    ...(args.event.workspaceRequest !== undefined
      ? { workspace_request: args.event.workspaceRequest }
      : {}),
  }

  args.emitMessage(requestMessage)

  if (!args.userInputManager) return

  const task = (async () => {
    try {
      const response = args.onInputRequest
        ? await args.onInputRequest(requestMessage)
        : null
      const parsedResponse = parseApprovalInputResponse(response)
      args.userInputManager.submitAnswers(
        args.event.toolUseId,
        toApprovalAnswers(parsedResponse),
      )
    } catch (error) {
      args.userInputManager.reject(
        args.event.toolUseId,
        asValidationError(error, 'Invalid approval input response'),
      )
    }
  })()

  args.addPendingResolution(task)
}

function handleAskUserQuestionRequest(args: Omit<HandleInputRequestEventArgs, 'event'> & {
  event: Extract<StreamEvent, { type: 'ask_user_question' }>
}): void {
  const requestMessage: InputRequestMessage = {
    type: 'input_request',
    subtype: 'ask_user_question',
    session_id: args.sessionId,
    uuid: randomUUID(),
    tool_use_id: args.event.toolUseId,
    questions: args.event.questions,
  }

  args.emitMessage(requestMessage)

  if (!args.userInputManager) return

  const task = (async () => {
    try {
      const response = args.onInputRequest
        ? await args.onInputRequest(requestMessage)
        : null
      const parsedResponse = parseAskUserQuestionInputResponse(response)
      args.userInputManager.submitAnswers(
        args.event.toolUseId,
        toAskUserAnswers(parsedResponse),
      )
    } catch (error) {
      args.userInputManager.reject(
        args.event.toolUseId,
        asValidationError(error, 'Invalid ask_user_question input response'),
      )
    }
  })()

  args.addPendingResolution(task)
}

export function handleInputRequestEvent(args: HandleInputRequestEventArgs): boolean {
  if (args.event.type === 'approval_request') {
    handleApprovalRequest({
      event: args.event,
      sessionId: args.sessionId,
      emitMessage: args.emitMessage,
      onInputRequest: args.onInputRequest,
      userInputManager: args.userInputManager,
      addPendingResolution: args.addPendingResolution,
    })
    return true
  }

  if (args.event.type === 'ask_user_question') {
    handleAskUserQuestionRequest({
      event: args.event,
      sessionId: args.sessionId,
      emitMessage: args.emitMessage,
      onInputRequest: args.onInputRequest,
      userInputManager: args.userInputManager,
      addPendingResolution: args.addPendingResolution,
    })
    return true
  }

  return false
}
