import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { AskUserQuestion, UserInputManager } from '../../runtime/userInputManager'
import { buildExitedPlanModeSystemReminder } from '../../../utils/planMode'

const QUESTIONS: AskUserQuestion[] = [
  {
    header: 'Submit',
    question: 'Ready to code?',
    options: [
      { label: 'Yes, and auto-accept edits', description: 'Proceed and allow edits without per-edit prompts.' },
      { label: 'Yes, and manually approve edits', description: 'Proceed but confirm each edit.' },
      { label: 'Type here to tell Claude what to change', description: 'Request plan changes and stay in plan mode.' },
    ],
    multiSelect: false,
  },
]

export function createExitPlanModeToolHandler(userInput: UserInputManager): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'ExitPlanMode'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const mode = ctx.getReplMode?.() ?? ctx.replMode
        if (mode !== 'plan') {
          return { tool_use_id: call.id, content: 'Not in plan mode.' }
        }

        const planPath = ctx.getPlanPath?.() ?? ctx.planPath ?? null

        const answers = await userInput.requestAnswers({
          toolUseId: call.id,
          questions: QUESTIONS,
          signal: ctx.signal,
        })

        const choice = String(answers.choice || '').toLowerCase()
        const feedback = String(answers.feedback || '').trim()

        if (choice === 'auto') {
          ctx.setReplMode?.('acceptEdits')
          return {
            tool_use_id: call.id,
            content: buildApprovedResult({
              planPath,
              planMode: 'acceptEdits',
            }),
          }
        }

        if (choice === 'manual') {
          ctx.setReplMode?.('normal')
          return {
            tool_use_id: call.id,
            content: buildApprovedResult({
              planPath,
              planMode: 'normal',
            }),
          }
        }

        if (choice === 'feedback') {
          return {
            tool_use_id: call.id,
            content:
              'User requested plan changes. Stay in plan mode and update the plan accordingly.\n' +
              (feedback ? `User feedback: ${feedback}` : ''),
          }
        }

        return {
          tool_use_id: call.id,
          content: 'Exit plan mode cancelled. Stay in plan mode.',
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

function buildApprovedResult(args: {
  planPath: string | null
  planMode: 'normal' | 'acceptEdits'
}): string {
  const planPath = args.planPath

  const modeLine =
    args.planMode === 'acceptEdits'
      ? 'Approved. Exited plan mode with auto-accept edits.'
      : 'Approved. Exited plan mode with manual edit approvals.'

  return (
    `User has approved your plan. You can now start coding.\n\n` +
    (planPath ? `Your plan has been saved to: ${planPath}\nYou can refer back to it if needed during implementation.\n\n` : '') +
    modeLine +
    '\n\n' +
    buildExitedPlanModeSystemReminder(planPath)
  )
}
