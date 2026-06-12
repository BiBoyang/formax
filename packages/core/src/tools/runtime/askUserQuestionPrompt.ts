import type { ToolCall, ToolResult } from '../types.js'
import type { AskUserQuestion, AskUserAnswers, UserInputManager } from './userInputManager.js'
import type { ExecutionContext } from '../executor/index.js'
import { createAskUserQuestionPromptDescriptor } from './interactivePromptDescriptor.js'
import type { InteractivePromptData, InteractivePromptUi, InteractivePromptVariant } from './interactivePromptDescriptor.js'
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
  descriptorUi?: InteractivePromptUi
  promptData?: InteractivePromptData
}): Promise<AskUserQuestionPromptResult> {
  const promptVariant = askUserQuestionPromptVariant(args.call.name)
  const tx = await runInteractivePromptTransaction<AskUserAnswers>({
    call: args.call,
    ctx: args.ctx,
    userInput: args.userInput,
    descriptor: createAskUserQuestionPromptDescriptor({
      call: args.call,
      questions: args.questions,
      ui: { promptVariant, ...(args.descriptorUi ?? {}) },
      ...(args.promptData ? { promptData: args.promptData } : {}),
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

function askUserQuestionPromptVariant(toolName: string): InteractivePromptVariant {
  if (toolName === 'EnterPlanMode') return 'enter_plan_mode'
  if (toolName === 'ExitPlanMode') return 'exit_plan_mode'
  return 'ask_user_question'
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
