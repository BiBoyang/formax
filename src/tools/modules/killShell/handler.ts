import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { TaskManager } from '../../runtime/taskManager'

export function createKillShellToolHandler(taskManager: TaskManager): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'KillShell'
    },

    async execute(call: ToolCall, _ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const input = call.input || {}
        const shellId = (input as any).shell_id

        if (typeof shellId !== 'string' || !shellId.trim()) {
          return {
            tool_use_id: call.id,
            content: 'Error: Missing required field shell_id.',
            is_error: true,
          }
        }

        const snapshot = taskManager.get(shellId)
        if (!snapshot) {
          return {
            tool_use_id: call.id,
            content: `Error: Shell '${shellId}' not found.`,
            is_error: true,
          }
        }

        if (snapshot.kind !== 'shell') {
          return {
            tool_use_id: call.id,
            content: `Error: Task '${shellId}' is not a shell task.`,
            is_error: true,
          }
        }

        if (snapshot.status !== 'running') {
          return {
            tool_use_id: call.id,
            content: JSON.stringify({ shell_id: shellId, status: snapshot.status, ok: false }, null, 2),
            is_error: true,
          }
        }

        const ok = taskManager.cancel(shellId, { message: 'Killed' })
        return {
          tool_use_id: call.id,
          content: JSON.stringify({ shell_id: shellId, ok }, null, 2),
          ...(ok ? {} : { is_error: true }),
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

