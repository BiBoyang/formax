import { randomUUID } from 'node:crypto'
import type { StreamEvent } from '../../streaming/types.js'
import type {
  CanUseTool,
  ElicitationRequest,
  ElicitationResult,
  InputRequestMessage,
  PermissionResult,
  PermissionUpdate,
  PermissionUpdateDestination,
  QueryMessage,
} from '../types.js'
import {
  asValidationError,
  parseElicitationRequestInput,
  parseElicitationResultOutput,
  parsePermissionResultOutput,
} from '../validation.js'

type UserInputManagerLike = {
  submitAnswers: (toolUseId: string, answers: Record<string, string>) => void
  reject: (toolUseId: string, error: Error) => void
}

type HandleInputRequestEventArgs = {
  event: StreamEvent
  sessionId: string
  emitMessage: (message: QueryMessage) => void
  canUseTool?: CanUseTool
  onElicitation?: (
    request: ElicitationRequest,
    options: { signal: AbortSignal },
  ) => Promise<ElicitationResult>
  userInputManager?: UserInputManagerLike | null
  signal: AbortSignal
  addPendingResolution: (task: Promise<void>) => void
}

type AskUserQuestionEvent = Extract<StreamEvent, { type: 'ask_user_question' }>
type ApprovalRequestEvent = Extract<StreamEvent, { type: 'approval_request' }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mapPermissionDestinationToScope(destination: PermissionUpdateDestination): 'session' | 'project' | 'global' {
  if (destination === 'userSettings') return 'global'
  if (destination === 'projectSettings' || destination === 'localSettings') return 'project'
  return 'session'
}

function isRememberCapablePermissionUpdate(update: PermissionUpdate): boolean {
  switch (update.type) {
    case 'addRules':
    case 'replaceRules':
      return update.behavior === 'allow' && update.rules.length > 0
    case 'setMode':
      return update.mode === 'acceptEdits'
    case 'addDirectories':
      return update.directories.some((directory) => String(directory ?? '').trim().length > 0)
    case 'removeRules':
    case 'removeDirectories':
      return false
    default:
      return false
  }
}

function resolveRememberScopeFromPermissionUpdates(
  updates: PermissionUpdate[] | undefined,
): 'session' | 'project' | 'global' | null {
  if (!updates || updates.length === 0) return null
  let rememberScope: 'session' | 'project' | 'global' | null = null
  for (const update of updates) {
    if (!update || typeof update !== 'object') continue
    if (!('destination' in update)) continue
    if (!isRememberCapablePermissionUpdate(update)) continue
    const destination = update.destination
    if (!destination) continue
    const nextScope = mapPermissionDestinationToScope(destination)
    if (!rememberScope) {
      rememberScope = nextScope
      continue
    }
    if (rememberScope !== nextScope) {
      // SDK approval answers can only encode one scope; mixed destinations
      // must fall back to one-time approval to avoid broadening permissions.
      return null
    }
  }
  return rememberScope
}

function toApprovalAnswersFromPermissionResult(result: PermissionResult): Record<string, string> {
  const serializeUpdatedInput = (): string | null => {
    if (result.behavior !== 'allow') return null
    if (!result.updatedInput || !isRecord(result.updatedInput)) return null
    try {
      return JSON.stringify(result.updatedInput)
    } catch {
      return null
    }
  }

  if (result.behavior === 'deny') {
    const message = String(result.message ?? '').trim()
    if (!message) return { decision: 'deny' }
    return {
      decision: 'feedback',
      feedback: message,
    }
  }

  const rememberScope = resolveRememberScopeFromPermissionUpdates(result.updatedPermissions)
  if (rememberScope) {
    const out: Record<string, string> = {
      decision: 'approve_remember',
      scope: rememberScope,
    }
    const updatedInputJson = serializeUpdatedInput()
    if (updatedInputJson) out.updated_input_json = updatedInputJson
    return out
  }

  const out: Record<string, string> = { decision: 'approve' }
  const updatedInputJson = serializeUpdatedInput()
  if (updatedInputJson) out.updated_input_json = updatedInputJson
  return out
}

function toAskUserAnswersFromPermissionResult(result: PermissionResult): Record<string, string> {
  if (result.behavior !== 'allow') {
    throw new Error('AskUserQuestion canUseTool response must be allow with updatedInput.answers')
  }

  if (!result.updatedInput || !isRecord(result.updatedInput)) {
    throw new Error('AskUserQuestion canUseTool allow response must include updatedInput object')
  }

  const answersRaw = result.updatedInput.answers
  if (!isRecord(answersRaw)) {
    throw new Error('AskUserQuestion canUseTool allow response must include updatedInput.answers object')
  }

  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(answersRaw)) {
    if (Array.isArray(value)) {
      out[String(key)] = value.map((item) => String(item ?? '')).join(',')
      continue
    }
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

function buildElicitationRequest(event: AskUserQuestionEvent): ElicitationRequest {
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
  event: AskUserQuestionEvent
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

function toCanUseToolInputFromApprovalEvent(event: ApprovalRequestEvent): Record<string, unknown> {
  if (isRecord(event.action)) {
    return { ...event.action }
  }
  return { action: event.action }
}

function buildPermissionRuleSuggestion(args: {
  toolName: string
  ruleContent: unknown
}): PermissionUpdate | null {
  const ruleContent = String(args.ruleContent ?? '').trim()
  if (!ruleContent) return null
  return {
    type: 'addRules',
    rules: [{ toolName: args.toolName, ruleContent }],
    behavior: 'allow',
    destination: 'session',
  }
}

function buildPermissionSuggestionsFromApprovalEvent(
  event: ApprovalRequestEvent,
): PermissionUpdate[] | undefined {
  const updates: PermissionUpdate[] = []
  if (event.blockedPath) {
    updates.push({
      type: 'addDirectories',
      directories: [event.blockedPath],
      destination: 'session',
    })
  } else if (event.workspaceRequest?.dir) {
    updates.push({
      type: 'addDirectories',
      directories: [event.workspaceRequest.dir],
      destination: 'session',
    })
  }

  if (!isRecord(event.action)) {
    return updates.length > 0 ? updates : undefined
  }

  const kind = String(event.action.kind ?? '').trim()
  if (!kind) return updates.length > 0 ? updates : undefined

  if (kind === 'fs.write') {
    updates.push({
      type: 'setMode',
      mode: 'acceptEdits',
      destination: 'session',
    })
    const writePathRule = buildPermissionRuleSuggestion({
      toolName: event.toolName,
      ruleContent: event.action.path,
    })
    if (writePathRule) updates.push(writePathRule)
    return updates.length > 0 ? updates : undefined
  }

  const ruleContentByKind: Record<string, unknown> = {
    'fs.read': event.action.path,
    'bash.exec': event.action.command,
    'net.fetch': event.action.url,
    'net.search': event.action.query,
    'tool.install': event.action.tool,
    'tool.name': event.action.toolName ?? event.toolName,
  }
  const fallbackRule = buildPermissionRuleSuggestion({
    toolName: event.toolName,
    ruleContent: ruleContentByKind[kind],
  })
  if (fallbackRule) updates.push(fallbackRule)
  return updates.length > 0 ? updates : undefined
}

function resolveApprovalDecisionReason(event: ApprovalRequestEvent): string | undefined {
  const explicit = String(event.decisionReason ?? '').trim()
  if (explicit) return explicit

  if (typeof event.effectiveDecision === 'string' && event.effectiveDecision.trim()) {
    return `effectiveDecision=${event.effectiveDecision.trim()}`
  }

  if (Array.isArray(event.suggestions) && event.suggestions.length > 0) {
    const joined = event.suggestions.map((item) => String(item)).filter(Boolean).join('\n')
    if (joined) return joined
  }

  return undefined
}

function handleApprovalRequest(args: Omit<HandleInputRequestEventArgs, 'event'> & {
  event: ApprovalRequestEvent
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
    ...(args.event.blockedPath ? { blocked_path: args.event.blockedPath } : {}),
    ...(args.event.decisionReason ? { decision_reason: args.event.decisionReason } : {}),
    ...(args.event.agentID ? { agent_id: args.event.agentID } : {}),
  }

  args.emitMessage(requestMessage)

  if (!args.userInputManager) return

  const task = (async () => {
    try {
      let answers: Record<string, string> = { decision: 'deny' }
      if (args.canUseTool) {
        const response = await args.canUseTool(
          args.event.toolName,
          toCanUseToolInputFromApprovalEvent(args.event),
          {
            signal: args.signal,
            suggestions: buildPermissionSuggestionsFromApprovalEvent(args.event),
            blockedPath: args.event.blockedPath ?? args.event.workspaceRequest?.dir,
            decisionReason: resolveApprovalDecisionReason(args.event),
            toolUseID: args.event.toolUseId,
            agentID: args.event.agentID,
          },
        )
        const parsedResponse = parsePermissionResultOutput(response)
        answers = toApprovalAnswersFromPermissionResult(parsedResponse)
      }

      args.userInputManager.submitAnswers(
        args.event.toolUseId,
        answers,
      )
    } catch (error) {
      args.userInputManager.reject(
        args.event.toolUseId,
        asValidationError(error, 'Invalid canUseTool response for approval_request'),
      )
    }
  })()

  args.addPendingResolution(task)
}

function handleAskUserQuestionRequest(args: Omit<HandleInputRequestEventArgs, 'event'> & {
  event: AskUserQuestionEvent
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
    let errorContext = 'Invalid canUseTool response for ask_user_question'
    try {
      let answers: Record<string, string>

      if (args.canUseTool) {
        const response = await args.canUseTool(
          'AskUserQuestion',
          { questions: args.event.questions },
          {
            signal: args.signal,
            toolUseID: args.event.toolUseId,
          },
        )
        const parsedResponse = parsePermissionResultOutput(response)
        if (parsedResponse.behavior === 'deny') {
          args.userInputManager.reject(
            args.event.toolUseId,
            new Error(parsedResponse.message),
          )
          return
        }
        answers = toAskUserAnswersFromPermissionResult(parsedResponse)
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
      canUseTool: args.canUseTool,
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
      canUseTool: args.canUseTool,
      onElicitation: args.onElicitation,
      userInputManager: args.userInputManager,
      signal: args.signal,
      addPendingResolution: args.addPendingResolution,
    })
    return true
  }

  return false
}
