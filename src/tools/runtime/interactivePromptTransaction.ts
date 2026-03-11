import type { ExecutionContext } from '../executor/index.js'
import type { StreamEvent } from '../../streaming/types.js'
import type { ToolCall, ToolResult } from '../types.js'
import type { AskUserAnswers, AskUserQuestion, UserInputManager } from './userInputManager.js'

type InteractiveRequestEvent = Extract<StreamEvent, { type: 'approval_request' | 'ask_user_question' }>

export type InteractivePromptTransactionResult<TAnswers extends AskUserAnswers> =
  | { ok: true; answers: TAnswers }
  | { ok: false; result: ToolResult }

export async function runInteractivePromptTransaction<TAnswers extends AskUserAnswers>(args: {
  call: ToolCall
  ctx: ExecutionContext
  userInput: UserInputManager | null
  questions: AskUserQuestion[]
  requestEvent?: InteractiveRequestEvent
  beforeRequest?: () => void
  unavailableContent: string
  abortedContent: string
  requireInteractive?: boolean
  emitToolUpdate?: boolean
}): Promise<InteractivePromptTransactionResult<TAnswers>> {
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

  if (args.requestEvent) {
    args.ctx.onEvent?.(args.requestEvent)
  }

  const answersPromise = args.userInput.requestAnswers({
    toolUseId: args.call.id,
    questions: args.questions,
    signal: args.ctx.signal,
  })

  if (args.emitToolUpdate !== false) {
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
