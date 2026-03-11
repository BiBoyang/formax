import type { ToolCall, ToolResult } from '../types.js'
import type { UserInputManager } from '../runtime/userInputManager.js'
import type { ExecutionContext } from './index.js'

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
  const answersPromise = args.userInput.requestAnswers({
    toolUseId: args.call.id,
    // Intentionally empty: approval-like choices are rendered from tool context,
    // not AskUserQuestion-form question rows.
    questions: [],
    signal: args.ctx.signal,
  })
  args.ctx.onEvent?.({ type: 'tool_update', id: args.call.id, middleLines: [] })

  let answers: TAnswer
  try {
    answers = (await answersPromise) as TAnswer
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

  return {
    ok: true,
    answers,
    decision: String(answers.decision || '').trim().toLowerCase(),
    feedback: String(answers.feedback || '').trim(),
  }
}
