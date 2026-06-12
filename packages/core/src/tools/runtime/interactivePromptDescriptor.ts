import type { StreamEvent } from '../../streaming/types.js'
import type { ToolCall } from '../types.js'
import type { AskUserQuestion } from './userInputManager.js'

export type InteractiveRequestEvent = Extract<StreamEvent, { type: 'approval_request' | 'ask_user_question' }>

export type InteractivePromptVariant =
  | 'fs_read'
  | 'fs_write'
  | 'bash'
  | 'mcp'
  | 'skill'
  | 'web_search'
  | 'web_fetch'
  | 'ask_user_question'
  | 'enter_plan_mode'
  | 'exit_plan_mode'
  | 'generic_approval'

export type InteractivePromptUi = {
  promptVariant?: InteractivePromptVariant
  title?: string
  targetLabel?: string
  directoryPath?: string
  command?: string
  cwd?: string
  toolLabel?: string
  rememberLabel?: string
}

export type ExitPlanPromptSnapshot = {
  kind: 'exit_plan_mode'
  planPath: string | null
  planContentState: { status: 'loaded'; text: string } | { status: 'error'; message?: string }
}

export type InteractivePromptData = ExitPlanPromptSnapshot

export type ApprovalPromptDescriptor = {
  kind: 'approval'
  requestEvent: Extract<StreamEvent, { type: 'approval_request' }>
  questions?: AskUserQuestion[]
  emitToolUpdate?: boolean
  ui?: InteractivePromptUi
  promptData?: InteractivePromptData
}

export type AskUserQuestionPromptDescriptor = {
  kind: 'ask_user_question'
  requestEvent: Extract<StreamEvent, { type: 'ask_user_question' }>
  questions: AskUserQuestion[]
  emitToolUpdate?: boolean
  ui?: InteractivePromptUi
  promptData?: InteractivePromptData
}

export type InteractivePromptDescriptor = ApprovalPromptDescriptor | AskUserQuestionPromptDescriptor

export function createAskUserQuestionPromptDescriptor(args: {
  call: Pick<ToolCall, 'id'>
  questions: AskUserQuestion[]
  ui?: InteractivePromptUi
  promptData?: InteractivePromptData
  emitToolUpdate?: boolean
}): AskUserQuestionPromptDescriptor {
  return {
    kind: 'ask_user_question',
    questions: args.questions,
    requestEvent: {
      type: 'ask_user_question',
      toolUseId: args.call.id,
      questions: args.questions,
    },
    ...(args.ui ? { ui: args.ui } : {}),
    ...(args.promptData ? { promptData: args.promptData } : {}),
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
  ui?: InteractivePromptUi
  promptData?: InteractivePromptData
  emitToolUpdate?: boolean
}): ApprovalPromptDescriptor {
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
    ...(args.ui ? { ui: args.ui } : {}),
    ...(args.promptData ? { promptData: args.promptData } : {}),
    ...(args.emitToolUpdate !== undefined ? { emitToolUpdate: args.emitToolUpdate } : {}),
  }
}
