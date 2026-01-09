import fsp from 'node:fs/promises'
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
            content: await buildApprovedResult({
              planPath,
              planMode: 'acceptEdits',
            }),
          }
        }

        if (choice === 'manual') {
          ctx.setReplMode?.('normal')
          return {
            tool_use_id: call.id,
            content: await buildApprovedResult({
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

const MAX_PLAN_CHARS = 20000

async function buildApprovedResult(args: {
  planPath: string | null
  planMode: 'normal' | 'acceptEdits'
}): Promise<string> {
  const planPath = args.planPath
  const planText = planPath ? await safeReadFile(planPath) : null
  const planBody = planText ? truncate(planText.trimEnd(), MAX_PLAN_CHARS) : null

  const modeLine =
    args.planMode === 'acceptEdits'
      ? 'Approved. Exited plan mode with auto-accept edits.'
      : 'Approved. Exited plan mode with manual edit approvals.'

  return (
    `User has approved your plan. You can now start coding.\n\n` +
    (planPath ? `Your plan has been saved to: ${planPath}\nYou can refer back to it if needed during implementation.\n\n` : '') +
    (planBody ? `## Approved Plan:\n${planBody}\n\n` : '') +
    modeLine +
    '\n\n' +
    buildExitedPlanModeSystemReminder(planPath)
  )
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await fsp.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

function truncate(text: string, maxChars: number): string {
  const raw = String(text || '')
  if (raw.length <= maxChars) return raw
  return raw.slice(0, Math.max(0, maxChars - 1)) + '…'
}
