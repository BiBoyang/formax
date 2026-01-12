import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { AskUserQuestion, UserInputManager } from '../../runtime/userInputManager'
import { buildPlanModeSystemReminder, isSameFilePath } from '../../../utils/planMode'
import { hasReadFile } from '../../runtime/readLedger'
import { requireAbsolutePath } from '../../utils/paths'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'

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

export function createWriteToolHandler(userInput: UserInputManager): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'Write'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const mode = ctx.getReplMode?.() ?? ctx.replMode

        const input = requirePlainObject(call.input || {}, 'Write.input')
        assertNoExtraKeys(input, ['file_path', 'content'], 'Write.input')
        const cwd = ctx.cwd || process.cwd()

        const filePathRaw = (input as any).file_path
        const content = (input as any).content
        if (!filePathRaw) throw new Error('Missing file_path')
        if (typeof content !== 'string') throw new Error('Missing content')

        const { absolutePath: filePath } = requireAbsolutePath({
          cwd,
          rawPath: String(filePathRaw),
          fieldName: 'file_path',
        })
        const planPath = ctx.getPlanPath?.() ?? ctx.planPath ?? null
        const isPlanFile = Boolean(planPath && isSameFilePath(filePath, planPath, cwd))

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
            if (!feedback) {
              return { tool_use_id: call.id, content: 'Tool use rejected by user.', is_error: true }
            }
            return {
              tool_use_id: call.id,
              content: `Tool use rejected with user message: ${feedback}`,
              is_error: true,
            }
          } else {
            return { tool_use_id: call.id, content: 'Tool use rejected by user.', is_error: true }
          }
        }

        const dir = path.dirname(filePath)
        await fsp.mkdir(dir, { recursive: true })
        const existed = await fileExists(filePath)
        if (existed && !hasReadFile(filePath)) {
          return {
            tool_use_id: call.id,
            content: `Error: Write requires reading the existing file first: ${filePath}`,
            is_error: true,
          }
        }
        await fsp.writeFile(filePath, content, 'utf8')
        if (mode === 'plan' && isPlanFile) {
          const prefix = existed ? 'The file has been updated at:' : 'File created successfully at:'
          return {
            tool_use_id: call.id,
            content: `${prefix} ${filePath}\n\n${buildPlanModeSystemReminder(filePath)}`,
          }
        }

        return { tool_use_id: call.id, content: `Wrote ${filePath} (${content.length} bytes)` }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.stat(filePath)
    return true
  } catch {
    return false
  }
}
