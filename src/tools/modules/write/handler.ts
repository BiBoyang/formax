import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { AskUserQuestion, UserInputManager } from '../../runtime/userInputManager'

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
        if (mode === 'plan') {
          return {
            tool_use_id: call.id,
            content: 'Error: Plan mode is active. Use ExitPlanMode after the user approves your plan.',
            is_error: true,
          }
        }

        const input = call.input || {}
        const cwd = ctx.cwd || process.cwd()

        const filePathRaw = (input as any).file_path || (input as any).path
        let content = (input as any).content
        if (!filePathRaw) throw new Error('Missing file_path')

        const filePath = path.isAbsolute(filePathRaw) ? filePathRaw : path.resolve(cwd, filePathRaw)

        if (mode !== 'acceptEdits') {
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

        if (Array.isArray(content)) {
          content = content
            .map((c: any) =>
              typeof c === 'string' ? c : c?.text || (typeof c === 'object' ? JSON.stringify(c) : ''),
            )
            .join('')
        }

        if (content === undefined || content === null) content = ''

        const dir = path.dirname(filePath)
        await fsp.mkdir(dir, { recursive: true })
        await fsp.writeFile(filePath, String(content), 'utf8')
        return { tool_use_id: call.id, content: `Wrote ${filePath} (${String(content).length} bytes)` }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}
