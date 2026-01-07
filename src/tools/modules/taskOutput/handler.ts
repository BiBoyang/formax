import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { TaskManager } from '../../runtime/taskManager'

export function createTaskOutputToolHandler(taskManager: TaskManager): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'TaskOutput'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const input = call.input || {}
        const taskId = (input as any).task_id
        const block = typeof (input as any).block === 'boolean' ? (input as any).block : true
        const timeout = typeof (input as any).timeout === 'number' ? (input as any).timeout : 30000

        if (typeof taskId !== 'string' || !taskId.trim()) {
          return {
            tool_use_id: call.id,
            content: 'Error: Missing required field task_id.',
            is_error: true,
          }
        }

        const snapshot = taskManager.get(taskId)
        if (!snapshot) {
          return {
            tool_use_id: call.id,
            content: `Error: Task '${taskId}' not found.`,
            is_error: true,
          }
        }

        if (snapshot.status === 'running' && block) {
          const waited = await taskManager.wait(taskId, { signal: ctx.signal, timeoutMs: timeout })
          const next = waited.snapshot

          if (waited.timedOut && next.status === 'running') {
            return {
              tool_use_id: call.id,
              content: JSON.stringify(
                {
                  task_id: taskId,
                  status: 'running',
                  timed_out: true,
                  ...(typeof next.result?.content === 'string' ? { output: next.result.content } : {}),
                },
                null,
                2,
              ),
            }
          }

          return {
            tool_use_id: call.id,
            content: JSON.stringify(
              {
                task_id: taskId,
                status: next.status,
                output: next.result?.content ?? '(no output)',
              },
              null,
              2,
            ),
            ...(next.result?.is_error ? { is_error: true } : {}),
          }
        }

        if (snapshot.status === 'running') {
          return {
            tool_use_id: call.id,
            content: JSON.stringify(
              {
                task_id: taskId,
                status: 'running',
                ...(typeof snapshot.result?.content === 'string' ? { output: snapshot.result.content } : {}),
              },
              null,
              2,
            ),
          }
        }

        return {
          tool_use_id: call.id,
          content: JSON.stringify(
            {
              task_id: taskId,
              status: snapshot.status,
              output: snapshot.result?.content ?? '(no output)',
            },
            null,
            2,
          ),
          ...(snapshot.result?.is_error ? { is_error: true } : {}),
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}
