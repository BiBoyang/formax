import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { AskUserQuestion, UserInputManager } from '../../runtime/userInputManager'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'
import { toInteractivePromptFailureToolResult } from '../../runtime/interactivePromptTransaction'
import { requestAskUserQuestionAnswersResult } from '../../runtime/askUserQuestionPrompt'

export function createAskUserQuestionToolHandler(userInput: UserInputManager): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'AskUserQuestion'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const input = requirePlainObject(call.input || {}, 'AskUserQuestion.input')
        assertNoExtraKeys(input, ['questions', 'answers'], 'AskUserQuestion.input')
        const questionsRaw = (input as any).questions
        const prefilledAnswers = (input as any).answers

        if (!Array.isArray(questionsRaw) || questionsRaw.length === 0) {
          return {
            tool_use_id: call.id,
            content: 'Error: Missing required field questions.',
            is_error: true,
          }
        }

        const questions: AskUserQuestion[] = questionsRaw.map((q: any) => ({
          question: String(q?.question ?? ''),
          header: String(q?.header ?? ''),
          ...(typeof q?.fieldId === 'string' && q.fieldId.trim().length > 0 ? { fieldId: q.fieldId.trim() } : {}),
          options: Array.isArray(q?.options)
            ? q.options.map((o: any) => ({
                label: String(o?.label ?? ''),
                description: String(o?.description ?? ''),
              }))
            : [],
          multiSelect: Boolean(q?.multiSelect),
        }))

        if (prefilledAnswers && typeof prefilledAnswers === 'object' && !Array.isArray(prefilledAnswers)) {
          const answers: Record<string, string> = {}
          for (const [k, v] of Object.entries(prefilledAnswers as any)) {
            answers[String(k)] = String(v)
          }
          return {
            tool_use_id: call.id,
            content: JSON.stringify({ answers }, null, 2),
          }
        }

        const answersResult = await requestAskUserQuestionAnswersResult({
          call,
          ctx,
          userInput,
          questions,
        })
        if (answersResult.ok !== true) {
          return toInteractivePromptFailureToolResult({
            toolUseId: call.id,
            result: answersResult.result,
          })
        }

        return {
          tool_use_id: call.id,
          content: JSON.stringify({ answers: answersResult.answers }, null, 2),
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}
