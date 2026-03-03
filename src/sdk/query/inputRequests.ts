import { randomUUID } from 'node:crypto'
import type { StreamEvent } from '../../streaming/types.js'
import type {
  ElicitationRequest,
  ElicitationResult,
  InputRequestMessage,
  InputRequestResponse,
  QueryMessage,
} from '../types.js'
import {
  asValidationError,
  parseApprovalInputResponse,
  parseAskUserQuestionInputResponse,
  parseElicitationRequestInput,
  parseElicitationResultOutput,
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
  onElicitation?: (
    request: ElicitationRequest,
    options: { signal: AbortSignal },
  ) => Promise<ElicitationResult>
  userInputManager?: UserInputManagerLike | null
  signal: AbortSignal
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

function resolveQuestionFieldId(
  question: { fieldId?: string; header?: string; question?: string },
  index: number,
): string {
  const fieldId = String(question.fieldId ?? '').trim()
  if (fieldId) return fieldId
  const header = String(question.header ?? '').trim()
  if (header) return header
  const text = String(question.question ?? '').trim()
  if (text) return text
  return `question_${index + 1}`
}

function buildElicitationRequest(event: Extract<StreamEvent, { type: 'ask_user_question' }>): ElicitationRequest {
  const message = event.questions
    .map((question) => {
      const header = String(question.header ?? '').trim()
      const body = String(question.question ?? '').trim()
      if (!header) return body
      if (!body) return header
      return `${header}: ${body}`
    })
    .filter(Boolean)
    .join('\n')

  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [index, question] of event.questions.entries()) {
    const fieldId = resolveQuestionFieldId(question, index)
    const labels = question.options.map((option) => String(option.label))
    const property: Record<string, unknown> = {
      type: question.multiSelect ? 'array' : 'string',
      title: question.header,
      description: question.question,
    }

    if (labels.length > 0) {
      if (question.multiSelect) {
        property.items = {
          type: 'string',
          enum: labels,
        }
      } else {
        property.enum = labels
      }
    }

    properties[fieldId] = property
    required.push(fieldId)
  }

  const requestedSchema: Record<string, unknown> = {
    type: 'object',
    properties,
  }
  if (required.length > 0) {
    requestedSchema.required = required
  }

  return parseElicitationRequestInput({
    serverName: 'formax',
    message,
    mode: 'form',
    elicitationId: event.toolUseId,
    requestedSchema,
  })
}

function toAskUserAnswersFromElicitation(args: {
  event: Extract<StreamEvent, { type: 'ask_user_question' }>
  response: ElicitationResult
}): Record<string, string> {
  if (args.response.action !== 'accept') return {}

  const out: Record<string, string> = {}
  for (const [index, question] of args.event.questions.entries()) {
    const fieldId = resolveQuestionFieldId(question, index)
    if (!Object.prototype.hasOwnProperty.call(args.response.content, fieldId)) continue
    const value = args.response.content[fieldId]
    if (Array.isArray(value)) {
      out[fieldId] = value.map((item) => String(item ?? '')).join(',')
      continue
    }
    out[fieldId] = String(value ?? '')
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
    let errorContext = 'Invalid ask_user_question input response'
    try {
      let answers: Record<string, string>

      if (args.onInputRequest) {
        const response = await args.onInputRequest(requestMessage)
        const parsedResponse = parseAskUserQuestionInputResponse(response)
        answers = toAskUserAnswers(parsedResponse)
      } else if (args.onElicitation) {
        errorContext = 'Invalid elicitation response'
        const elicitationRequest = buildElicitationRequest(args.event)
        const response = await args.onElicitation(elicitationRequest, { signal: args.signal })
        const parsedResponse = parseElicitationResultOutput(response)
        answers = toAskUserAnswersFromElicitation({
          event: args.event,
          response: parsedResponse,
        })
      } else {
        answers = {}
      }

      args.userInputManager.submitAnswers(
        args.event.toolUseId,
        answers,
      )
    } catch (error) {
      args.userInputManager.reject(
        args.event.toolUseId,
        asValidationError(error, errorContext),
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
      onElicitation: args.onElicitation,
      userInputManager: args.userInputManager,
      signal: args.signal,
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
      onElicitation: args.onElicitation,
      userInputManager: args.userInputManager,
      signal: args.signal,
      addPendingResolution: args.addPendingResolution,
    })
    return true
  }

  return false
}
