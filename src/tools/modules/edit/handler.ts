import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { AskUserQuestion, UserInputManager } from '../../runtime/userInputManager'
import { buildPlanModeSystemReminder } from '../../../utils/planMode'
import { requireAbsolutePath } from '../../utils/paths'

const APPROVAL_QUESTIONS: AskUserQuestion[] = [
  {
    header: 'Edit',
    question: 'Approve this edit?',
    options: [
      { label: 'Yes', description: 'Apply this change.' },
      { label: 'Yes, allow all edits during this session', description: 'Enable auto-accept edits for this session.' },
      { label: 'Type here to tell Claude what to do differently', description: 'Reject and provide guidance.' },
    ],
    multiSelect: false,
  },
]

export function createEditToolHandler(userInput: UserInputManager): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'Edit'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const mode = ctx.getReplMode?.() ?? ctx.replMode

        const input = call.input || {}
        const cwd = ctx.cwd || process.cwd()

        const filePathRaw = (input as any).file_path || (input as any).path
        const oldString = (input as any).old_string
        const newString = (input as any).new_string
        const replaceAll = Boolean((input as any).replace_all)

        if (!filePathRaw) throw new Error('Missing file_path')
        if (oldString === undefined) throw new Error('Missing old_string')
        if (newString === undefined) throw new Error('Missing new_string')

        const { absolutePath: filePath } = requireAbsolutePath({
          cwd,
          rawPath: String(filePathRaw),
          fieldName: 'file_path',
        })
        const planPath = ctx.getPlanPath?.() ?? ctx.planPath ?? null
        const isPlanFile = Boolean(planPath && path.resolve(planPath) === path.resolve(filePath))

        if (mode === 'plan' && !isPlanFile) {
          return {
            tool_use_id: call.id,
            content: 'Error: Plan mode is active. Only the plan file may be edited until you exit plan mode.',
            is_error: true,
          }
        }

        if (mode !== 'acceptEdits' && !(mode === 'plan' && isPlanFile)) {
          const answersPromise = userInput.requestAnswers({
            toolUseId: call.id,
            questions: APPROVAL_QUESTIONS,
            signal: ctx.signal,
          })
          ctx.onEvent?.({ type: 'tool_update', id: call.id, middleLines: [] })
          const answers = await answersPromise

          const decision = String(answers.decision || '').toLowerCase()
          const feedback = String(answers.feedback || '').trim()

          if (decision === 'approve_all') {
            ctx.setReplMode?.('acceptEdits')
          } else if (decision === 'approve') {
            // ok
          } else if (decision === 'feedback') {
            return {
              tool_use_id: call.id,
              content: `Error: User requested changes. ${feedback ? `Feedback: ${feedback}` : ''}`.trim(),
              is_error: true,
            }
          } else {
            return { tool_use_id: call.id, content: 'Error: User rejected this edit.', is_error: true }
          }
        }

        const content = await fsp.readFile(filePath, 'utf8')
        if (!content.includes(oldString)) {
          const strippedOld = stripCatNPrefixes(String(oldString))
          const strippedNew = stripCatNPrefixes(String(newString))
          if (strippedOld !== oldString && content.includes(strippedOld)) {
            const newContent = replaceAll
              ? content.split(strippedOld).join(strippedNew)
              : content.replace(strippedOld, strippedNew)
            await fsp.writeFile(filePath, newContent, 'utf8')
            if (mode === 'plan' && isPlanFile) {
              return {
                tool_use_id: call.id,
                content:
                  `The file ${filePath} has been updated. Here's the result of running \`cat -n\` on a snippet of the edited file:\n` +
                  formatPlanSnippet(newContent) +
                  '\n\n' +
                  buildPlanModeSystemReminder(filePath),
              }
            }

            return { tool_use_id: call.id, content: `Edited ${filePath}` }
          }

          throw new Error(`old_string not found in file: ${String(oldString).slice(0, 50)}...`)
        }

        const newContent = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)

        await fsp.writeFile(filePath, newContent, 'utf8')
        if (mode === 'plan' && isPlanFile) {
          return {
            tool_use_id: call.id,
            content:
              `The file ${filePath} has been updated. Here's the result of running \`cat -n\` on a snippet of the edited file:\n` +
              formatPlanSnippet(newContent) +
              '\n\n' +
              buildPlanModeSystemReminder(filePath),
          }
        }

        return { tool_use_id: call.id, content: `Edited ${filePath}` }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

function stripCatNPrefixes(text: string): string {
  const raw = String(text ?? '')
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\t/, ''))
    .join('\n')
}

function formatPlanSnippet(contents: string): string {
  const lines = String(contents || '').split(/\r?\n/)
  const maxLines = 24
  const start = Math.max(0, lines.length - maxLines)
  const slice = lines.slice(start)
  const rendered = slice
    .map((line, i) => formatCatNArrowLine(start + i + 1, line))
    .join('\n')
  return rendered ? `\n${rendered}` : '\n(no content)'
}

function formatCatNArrowLine(lineNo: number, content: string): string {
  const num = String(lineNo).padStart(6, ' ')
  return `${num}→${content}`
}
