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

export type ApprovalPromptVariant = Exclude<
  InteractivePromptVariant,
  'ask_user_question' | 'enter_plan_mode' | 'exit_plan_mode'
>

export type AskUserQuestionPromptVariant = Extract<
  InteractivePromptVariant,
  'ask_user_question' | 'enter_plan_mode' | 'exit_plan_mode'
>

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

export type ApprovalPromptUi = Omit<InteractivePromptUi, 'promptVariant'> & {
  promptVariant?: ApprovalPromptVariant
}

export type GenericAskUserQuestionPromptUi = Omit<InteractivePromptUi, 'promptVariant'> & {
  promptVariant?: 'ask_user_question'
}

export type EnterPlanModePromptUi = Omit<InteractivePromptUi, 'promptVariant'> & {
  promptVariant: 'enter_plan_mode'
}

export type ExitPlanModePromptUi = Omit<InteractivePromptUi, 'promptVariant'> & {
  promptVariant: 'exit_plan_mode'
}

export type ApprovalPromptDescriptor = {
  kind: 'approval'
  requestEvent: Extract<StreamEvent, { type: 'approval_request' }>
  questions?: AskUserQuestion[]
  emitToolUpdate?: boolean
  ui?: ApprovalPromptUi
}

export type GenericAskUserQuestionPromptDescriptor = {
  kind: 'ask_user_question'
  requestEvent: Extract<StreamEvent, { type: 'ask_user_question' }>
  questions: AskUserQuestion[]
  emitToolUpdate?: boolean
  ui?: GenericAskUserQuestionPromptUi
}

export type EnterPlanModePromptDescriptor = {
  kind: 'ask_user_question'
  requestEvent: Extract<StreamEvent, { type: 'ask_user_question' }>
  questions: AskUserQuestion[]
  emitToolUpdate?: boolean
  ui: EnterPlanModePromptUi
}

export type ExitPlanModePromptDescriptor = {
  kind: 'ask_user_question'
  requestEvent: Extract<StreamEvent, { type: 'ask_user_question' }>
  questions: AskUserQuestion[]
  emitToolUpdate?: boolean
  ui: ExitPlanModePromptUi
  promptData: ExitPlanPromptSnapshot
}

export type AskUserQuestionPromptDescriptor =
  | GenericAskUserQuestionPromptDescriptor
  | EnterPlanModePromptDescriptor
  | ExitPlanModePromptDescriptor

export type InteractivePromptDescriptor = ApprovalPromptDescriptor | AskUserQuestionPromptDescriptor

type AskUserQuestionPromptDescriptorArgs = {
  call: Pick<ToolCall, 'id'>
  questions: AskUserQuestion[]
  emitToolUpdate?: boolean
} & (
  | {
      ui?: GenericAskUserQuestionPromptUi
      promptData?: never
    }
  | {
      ui: EnterPlanModePromptUi
      promptData?: never
    }
  | {
      ui: ExitPlanModePromptUi
      promptData: ExitPlanPromptSnapshot
    }
)

type ApprovalPromptDescriptorArgs = {
  call: Pick<ToolCall, 'id'>
  toolName: string
  action: unknown
  effectiveDecision: unknown
  suggestions?: string[]
  workspaceRequest?: { dir: string } | null
  blockedPath?: string
  decisionReason?: string
  agentID?: string
  ui?: ApprovalPromptUi
  emitToolUpdate?: boolean
}

export function createAskUserQuestionPromptDescriptor(args: AskUserQuestionPromptDescriptorArgs): AskUserQuestionPromptDescriptor {
  const base = {
    kind: 'ask_user_question' as const,
    questions: args.questions,
    requestEvent: {
      type: 'ask_user_question' as const,
      toolUseId: args.call.id,
      questions: args.questions,
    },
    ...(args.emitToolUpdate !== undefined ? { emitToolUpdate: args.emitToolUpdate } : {}),
  }

  if (args.ui?.promptVariant === 'exit_plan_mode') {
    return validateInteractivePromptDescriptor({
      ...base,
      ui: args.ui,
      promptData: args.promptData,
    })
  }

  if (args.ui?.promptVariant === 'enter_plan_mode') {
    return validateInteractivePromptDescriptor({
      ...base,
      ui: args.ui,
    })
  }

  if (args.promptData !== undefined) {
    return validateInteractivePromptDescriptor({
      ...base,
      ...(args.ui ? { ui: args.ui } : {}),
      promptData: args.promptData,
    } as AskUserQuestionPromptDescriptor)
  }

  return validateInteractivePromptDescriptor({
    ...base,
    ...(args.ui ? { ui: args.ui } : {}),
  })
}

export function createApprovalPromptDescriptor(args: ApprovalPromptDescriptorArgs): ApprovalPromptDescriptor {
  return validateInteractivePromptDescriptor({
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
    ...(args.emitToolUpdate !== undefined ? { emitToolUpdate: args.emitToolUpdate } : {}),
  })
}

export function validateInteractivePromptDescriptor<T extends InteractivePromptDescriptor>(descriptor: T): T {
  if (descriptor.kind === 'approval') {
    return descriptor
  }

  const variant = descriptor.ui?.promptVariant ?? 'ask_user_question'
  if (variant === 'exit_plan_mode') {
    const promptData = 'promptData' in descriptor ? descriptor.promptData : undefined
    if (!promptData || promptData.kind !== 'exit_plan_mode') {
      throw new Error('exit_plan_mode descriptors require matching promptData')
    }
    return descriptor
  }

  if ('promptData' in descriptor && descriptor.promptData !== undefined) {
    throw new Error('promptData is only supported for domain prompt variants that require snapshot data')
  }

  return descriptor
}
