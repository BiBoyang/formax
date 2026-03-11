import type { ToolCall, ToolResult } from '../types.js'
import type { AskUserQuestion, AskUserAnswers, UserInputManager } from './userInputManager.js'
import type { ExecutionContext } from '../executor/index.js'
import { createAskUserQuestionPromptDescriptor } from './interactivePromptDescriptor.js'
import {
  runInteractivePromptTransaction,
  throwInteractivePromptFailure,
} from './interactivePromptTransaction.js'

export type AskUserQuestionPromptResult =
  | { ok: true; answers: AskUserAnswers }
  | { ok: false; result: ToolResult }

export async function requestAskUserQuestionAnswersResult(args: {
  call: ToolCall
  ctx: ExecutionContext
  userInput: UserInputManager
  questions: AskUserQuestion[]
}): Promise<AskUserQuestionPromptResult> {
  const tx = await runInteractivePromptTransaction<AskUserAnswers>({
    call: args.call,
    ctx: args.ctx,
    userInput: args.userInput,
    descriptor: createAskUserQuestionPromptDescriptor({
      call: args.call,
      questions: args.questions,
      // AskUserQuestion handlers historically do not emit tool_update keepalive
      // rows while waiting for answers.
      emitToolUpdate: false,
    }),
    unavailableContent: 'User input unavailable',
    abortedContent: 'Request aborted',
  })

  if (tx.ok !== true) {
    return tx
  }
  return { ok: true, answers: tx.answers }
}

export async function requestAskUserQuestionAnswers(args: {
  call: ToolCall
  ctx: ExecutionContext
  userInput: UserInputManager
  questions: AskUserQuestion[]
}): Promise<AskUserAnswers> {
  const result = await requestAskUserQuestionAnswersResult(args)
  if (result.ok !== true) {
    throwInteractivePromptFailure({ result: result.result })
  }
  return result.answers
}
