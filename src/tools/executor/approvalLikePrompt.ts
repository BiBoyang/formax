import type { ToolCall, ToolResult } from '../types.js'
import type { UserInputManager } from '../runtime/userInputManager.js'
import type { ExecutionContext } from './index.js'
import { runInteractivePromptTransaction } from '../runtime/interactivePromptTransaction.js'

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

export function buildToolUseRejectedContent(args: { message?: string }): string {
  const msg = String(args.message ?? '').trim()
  if (msg) return `Tool use rejected with user message: ${msg}`
  return 'Tool use rejected by user.'
}

export async function promptForApprovalLikeAnswer<TAnswer extends ApprovalLikeAnswer>(args: {
  call: ToolCall
  ctx: ExecutionContext
  userInput: UserInputManager | null
  unavailableContent: string
  abortedContent: string
  requireInteractive?: boolean
  beforeRequest?: () => void
}): Promise<ApprovalLikePromptResult<TAnswer>> {
  const tx = await runInteractivePromptTransaction<TAnswer>({
    call: args.call,
    ctx: args.ctx,
    userInput: args.userInput,
    // Approval-like choices are rendered from tool context, not
    // AskUserQuestion-form question rows.
    questions: [],
    unavailableContent: args.unavailableContent,
    abortedContent: args.abortedContent,
    requireInteractive: args.requireInteractive,
    beforeRequest: args.beforeRequest,
  })

  if (tx.ok !== true) {
    return tx
  }

  const answers = tx.answers
  return {
    ok: true,
    answers,
    decision: String(answers.decision || '').trim().toLowerCase(),
    feedback: String(answers.feedback || '').trim(),
  }
}
