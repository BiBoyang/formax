import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'
import { getDeferredToolExposureStore, resolveToolExposureSessionKey } from '../../runtime/deferredToolExposure'

export function createToolSearchToolHandler(): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'ToolSearch'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const input = requirePlainObject(call.input || {}, 'ToolSearch.input')
        assertNoExtraKeys(input, ['query'], 'ToolSearch.input')

        const query = typeof (input as any).query === 'string' ? String((input as any).query).trim() : ''
        if (!query) {
          return {
            tool_use_id: call.id,
            content: 'Error: query is required',
            is_error: true,
          }
        }

        const sessionKey = resolveToolExposureSessionKey({
          explicitSessionKey: ctx.toolExposureSessionKey,
          cwd: ctx.cwd,
        })
        const result = getDeferredToolExposureStore().searchAndLoad({
          sessionKey,
          query,
        })

        return {
          tool_use_id: call.id,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        return {
          tool_use_id: call.id,
          content: `Error: ${msg}`,
          is_error: true,
        }
      }
    },
  }
}
