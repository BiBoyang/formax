import type { ToolCall, ToolResult } from '../types.js'
import type { AskUserQuestion, AskUserAnswers, UserInputManager } from './userInputManager.js'
import type { ExecutionContext } from '../executor/index.js'
import { createAskUserQuestionPromptDescriptor } from './interactivePromptDescriptor.js'
import type {
  ExitPlanPromptSnapshot,
  GenericAskUserQuestionPromptUi,
  InteractivePromptUi,
  InteractivePromptVariant,
} from './interactivePromptDescriptor.js'
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
  promptData?: ExitPlanPromptSnapshot
}): Promise<AskUserQuestionPromptResult> {
  const promptVariant = askUserQuestionPromptVariant(args.call.name)
  const baseUi = { promptVariant, ...(args.descriptorUi ?? {}) }
  const descriptor =
    promptVariant === 'exit_plan_mode'
      ? createAskUserQuestionPromptDescriptor({
          call: args.call,
          questions: args.questions,
          ui: baseUi as InteractivePromptUi & { promptVariant: 'exit_plan_mode' },
          promptData:
            args.promptData ??
            (() => {
              throw new Error('ExitPlanMode requires promptData for bottom-slot rendering')
            })(),
          emitToolUpdate: false,
        })
      : createAskUserQuestionPromptDescriptor({
          call: args.call,
          questions: args.questions,
          ui: baseUi as GenericAskUserQuestionPromptUi,
          // AskUserQuestion handlers historically do not emit tool_update keepalive
          // rows while waiting for answers.
          emitToolUpdate: false,
        })
  const tx = await runInteractivePromptTransaction<AskUserAnswers>({
    call: args.call,
    ctx: args.ctx,
    userInput: args.userInput,
    descriptor,
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
