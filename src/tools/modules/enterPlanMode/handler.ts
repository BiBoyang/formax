import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { AskUserQuestion, UserInputManager } from '../../runtime/userInputManager'

const QUESTIONS: AskUserQuestion[] = [
  {
    header: 'Plan',
    question: 'Enter plan mode?',
    options: [
      { label: 'Yes, enter plan mode', description: 'Explore and design an implementation plan first.' },
      { label: 'No, start implementing now', description: 'Skip planning and start making changes.' },
    ],
    multiSelect: false,
  },
]

export function createEnterPlanModeToolHandler(userInput: UserInputManager): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'EnterPlanMode'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const mode = ctx.getReplMode?.() ?? ctx.replMode
        if (mode === 'plan') {
          return { tool_use_id: call.id, content: 'Already in plan mode.' }
        }

        const answers = await userInput.requestAnswers({
          toolUseId: call.id,
          questions: QUESTIONS,
          signal: ctx.signal,
        })

        const choice = String(answers.choice || '').toLowerCase()
        if (choice === 'enter') {
          ctx.setReplMode?.('plan')
          return {
            tool_use_id: call.id,
            content: 'Entered plan mode.\nClaude is now exploring and designing an implementation approach.',
          }
        }

        return {
          tool_use_id: call.id,
          content: 'User declined plan mode. Continue implementing now.',
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

