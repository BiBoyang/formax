import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { AskUserQuestion, UserInputManager } from '../../runtime/userInputManager'
import { buildExitedPlanModeSystemReminder } from '../../../utils/planMode'
import { EXIT_PLAN_MODE_QUESTIONS } from '../../../features/tools/presentation/planModeQuestions'

const QUESTIONS: AskUserQuestion[] = EXIT_PLAN_MODE_QUESTIONS

export function createExitPlanModeToolHandler(userInput: UserInputManager): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'ExitPlanMode'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        if ((ctx.agentDepth ?? 0) > 0) {
          return {
            tool_use_id: call.id,
            content: 'Error: ExitPlanMode is interactive and cannot be used in this context.',
            is_error: true,
          }
        }

        const mode = ctx.getReplMode?.() ?? ctx.replMode
        if (mode !== 'plan') {
          return { tool_use_id: call.id, content: 'Not in plan mode.' }
        }

        const planPath = ctx.getPlanPath?.() ?? ctx.planPath ?? null

        ctx.onEvent?.({
          type: 'ask_user_question',
          toolUseId: call.id,
          questions: QUESTIONS,
        })

        const answers = await userInput.requestAnswers({
          toolUseId: call.id,
          questions: QUESTIONS,
          signal: ctx.signal,
        })

        const resolved = resolveExitPlanChoice(answers)
        const choice = resolved.choice
        const feedback = resolved.feedback

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

function resolveExitPlanChoice(answers: Record<string, string>): {
  choice: 'auto' | 'manual' | 'feedback' | 'cancel' | null
  feedback: string
} {
  const rawChoice = String(answers.choice || '').trim()
  const direct = rawChoice.toLowerCase()
  const directFeedback = String(answers.feedback || '').trim()
  const normalizedOptionLabels = new Set(QUESTIONS[0]?.options.map((option) => option.label.toLowerCase()) ?? [])

  if (direct === 'auto' || direct === 'manual' || direct === 'feedback' || direct === 'cancel') {
    return {
      choice: direct,
      feedback: direct === 'feedback' ? directFeedback : '',
    }
  }

  const values = Object.values(answers)
    .map((value) => String(value).trim().toLowerCase())
    .filter((value) => value.length > 0)
  const merged = values.join(' ')
  if (!merged) return { choice: null, feedback: '' }

  if (merged.includes('auto-accept') || merged.includes('auto accept')) return { choice: 'auto', feedback: '' }
  if (merged.includes('manual')) return { choice: 'manual', feedback: '' }
  if (merged.includes('cancel')) return { choice: 'cancel', feedback: '' }
  if (merged.includes('tell claude') || merged.includes('tell codex') || merged.includes('change')) {
    const fallbackFeedback = normalizedOptionLabels.has(direct) ? directFeedback : rawChoice
    return { choice: 'feedback', feedback: directFeedback || fallbackFeedback }
  }

  // Web ask panel may return free-text directly in `choice`.
  if (rawChoice) {
    const fallbackFeedback = normalizedOptionLabels.has(direct) ? directFeedback : rawChoice
    return { choice: 'feedback', feedback: fallbackFeedback }
  }

  return { choice: null, feedback: '' }
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
