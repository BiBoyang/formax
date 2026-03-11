import type { ToolCall } from '../types.js'
import type { AskUserQuestion, AskUserAnswers, UserInputManager } from './userInputManager.js'
import type { ExecutionContext } from '../executor/index.js'
import { runInteractivePromptTransaction } from './interactivePromptTransaction.js'

export async function requestAskUserQuestionAnswers(args: {
  call: ToolCall
  ctx: ExecutionContext
  userInput: UserInputManager
  questions: AskUserQuestion[]
}): Promise<AskUserAnswers> {
  const tx = await runInteractivePromptTransaction<AskUserAnswers>({
    call: args.call,
    ctx: args.ctx,
    userInput: args.userInput,
    questions: args.questions,
    requestEvent: {
      type: 'ask_user_question',
      toolUseId: args.call.id,
      questions: args.questions,
    },
    // AskUserQuestion handlers historically do not emit tool_update keepalive
    // rows while waiting for answers.
    emitToolUpdate: false,
    unavailableContent: 'User input unavailable',
    abortedContent: 'Request aborted',
  })
  if (tx.ok !== true) {
    const content = String(tx.result.content ?? '').trim()
    if (content.startsWith('Error: ')) {
      throw new Error(content.slice('Error: '.length))
    }
    throw new Error(content || 'Request failed')
  }
  return tx.answers
}
