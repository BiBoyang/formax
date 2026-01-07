import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { AskUserQuestion, UserInputManager } from '../../runtime/userInputManager'

export function createAskUserQuestionToolHandler(userInput: UserInputManager): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'AskUserQuestion'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const input = call.input || {}
        const questionsRaw = (input as any).questions

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
          options: Array.isArray(q?.options)
            ? q.options.map((o: any) => ({
                label: String(o?.label ?? ''),
                description: String(o?.description ?? ''),
              }))
            : [],
          multiSelect: Boolean(q?.multiSelect),
        }))

        const answers = await userInput.requestAnswers({
          toolUseId: call.id,
          questions,
          signal: ctx.signal,
        })

        return {
          tool_use_id: call.id,
          content: JSON.stringify({ answers }, null, 2),
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

