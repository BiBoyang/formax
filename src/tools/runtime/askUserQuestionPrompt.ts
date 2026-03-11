import type { ToolCall } from '../types.js'
import type { AskUserQuestion, AskUserAnswers, UserInputManager } from './userInputManager.js'
import type { ExecutionContext } from '../executor/index.js'

export async function requestAskUserQuestionAnswers(args: {
  call: ToolCall
  ctx: ExecutionContext
  userInput: UserInputManager
  questions: AskUserQuestion[]
}): Promise<AskUserAnswers> {
  args.ctx.onEvent?.({
    type: 'ask_user_question',
    toolUseId: args.call.id,
    questions: args.questions,
  })

  return await args.userInput.requestAnswers({
    toolUseId: args.call.id,
    questions: args.questions,
    signal: args.ctx.signal,
  })
}
