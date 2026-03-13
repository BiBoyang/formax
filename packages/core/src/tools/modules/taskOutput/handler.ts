import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { TaskManager } from '../../runtime/taskManager'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'

const DEFAULT_TIMEOUT_MS = 30000
const MAX_TIMEOUT_MS = 600000

export function createTaskOutputToolHandler(taskManager: TaskManager): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'TaskOutput'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      const rawTaskId = (() => {
        const input = call.input
        const obj = input && typeof input === 'object' && !Array.isArray(input) ? (input as any) : null
        return typeof obj?.task_id === 'string' ? obj.task_id : ''
      })()

      try {
        const input = requirePlainObject(call.input || {}, 'TaskOutput.input')
        assertNoExtraKeys(input, ['task_id', 'block', 'timeout'], 'TaskOutput.input')
        const taskId = (input as any).task_id
        const block = typeof (input as any).block === 'boolean' ? (input as any).block : true
        const timeout = parseTimeout((input as any).timeout)

        if (typeof taskId !== 'string' || !taskId.trim()) {
          return {
            tool_use_id: call.id,
            content: buildErrorResult({ taskId: rawTaskId, error: 'Missing required field task_id.' }),
            is_error: true,
          }
        }

        const snapshot = taskManager.get(taskId)
        if (!snapshot) {
          return {
            tool_use_id: call.id,
            content: buildErrorResult({ taskId, error: `Task '${taskId}' not found.` }),
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
        return { tool_use_id: call.id, content: buildErrorResult({ taskId: rawTaskId, error: msg }), is_error: true }
      }
    },
  }
}

function buildErrorResult(args: { taskId?: string; error: string }): string {
  const taskId = String(args.taskId || '').trim()
  return JSON.stringify(
    {
      ...(taskId ? { task_id: taskId } : {}),
      status: 'error',
      output: `Error: ${args.error}`,
    },
    null,
    2,
  )
}

function parseTimeout(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_TIMEOUT_MS
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('timeout must be a number')
  }
  if (value < 0) throw new Error('timeout must be >= 0')
  if (value > MAX_TIMEOUT_MS) throw new Error(`timeout must be <= ${MAX_TIMEOUT_MS}`)
  return Math.floor(value)
}
