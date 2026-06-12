import type { ToolCall, ToolResult } from '../types.js'
import type { UserInputManager } from '../runtime/userInputManager.js'
import type { ExecutionContext } from './index.js'
import {
  createApprovalPromptDescriptor as createApprovalPromptDescriptorBase,
  type ApprovalPromptDescriptor,
  type InteractivePromptUi,
} from '../runtime/interactivePromptDescriptor.js'
import {
  normalizeApprovalLikeAnswer,
  runInteractivePromptTransaction,
} from '../runtime/interactivePromptTransaction.js'

export type ApprovalLikeAnswer = {
  decision?: string
  feedback?: string
}

export type ApprovalLikePromptResult<TAnswer extends ApprovalLikeAnswer> =
  | {
      ok: true
      answers: TAnswer
      decision: string
      feedback: string
    }
  | {
      ok: false
      result: ToolResult
    }

export type ApprovalLikeResolvedOutcome =
  | { type: 'approve' }
  | { type: 'approve_remember' }
  | { type: 'feedback'; result: ToolResult }
  | { type: 'cancel'; result: ToolResult }

export type ApprovalPromptDescriptorArgs = {
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
  emitToolUpdate?: boolean
}

export function buildToolUseRejectedContent(args: { message?: string }): string {
  const msg = String(args.message ?? '').trim()
  if (msg) return `Tool use rejected with user message: ${msg}`
  return 'Tool use rejected by user.'
}

export function createApprovalPromptDescriptor(args: ApprovalPromptDescriptorArgs): ApprovalPromptDescriptor {
  return createApprovalPromptDescriptorBase(args)
}

export function resolveApprovalLikeOutcome(args: {
  call: Pick<ToolCall, 'id'>
  decision: string
  feedback: string
}): ApprovalLikeResolvedOutcome {
  if (args.decision === 'approve') {
    return { type: 'approve' }
  }

  if (args.decision === 'approve_remember') {
    return { type: 'approve_remember' }
  }

  if (args.decision === 'feedback' && args.feedback) {
    return {
      type: 'feedback',
      result: {
        tool_use_id: args.call.id,
        content: buildToolUseRejectedContent({ message: args.feedback }),
        is_error: true,
      },
    }
  }

  return {
    type: 'cancel',
    result: {
      tool_use_id: args.call.id,
      content: buildToolUseRejectedContent({}),
      is_error: true,
    },
  }
}

export async function promptForApprovalLikeAnswer<TAnswer extends ApprovalLikeAnswer>(args: {
  call: ToolCall
  ctx: ExecutionContext
  userInput: UserInputManager | null
  descriptor?: ApprovalPromptDescriptor
  unavailableContent: string
  abortedContent: string
  requireInteractive?: boolean
  beforeRequest?: () => void
}): Promise<ApprovalLikePromptResult<TAnswer>> {
  const tx = await runInteractivePromptTransaction<TAnswer>({
    call: args.call,
    ctx: args.ctx,
    userInput: args.userInput,
    descriptor: args.descriptor,
    // Approval-like choices are rendered from tool context, not
    // AskUserQuestion-form question rows.
    questions: args.descriptor?.kind === 'approval' ? (args.descriptor.questions ?? []) : [],
    unavailableContent: args.unavailableContent,
    abortedContent: args.abortedContent,
    requireInteractive: args.requireInteractive,
    beforeRequest: args.beforeRequest,
  })

  if (tx.ok !== true) {
    return tx
  }

  const answers = tx.answers
  const normalized = normalizeApprovalLikeAnswer(answers)
  return {
    ok: true,
    answers,
    decision: normalized.decision,
    feedback: normalized.feedback,
  }
}
