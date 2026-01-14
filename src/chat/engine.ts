import type { PromptBlock, PromptMessage } from '../prompts'
import type { ToolCall, ToolDefinition, ToolResult } from '../tools/types'
import type { ExecutionContext, ToolExecutor } from '../tools/executor'
import type { LlmStreamClient, StreamSink } from '../streaming/types'

export type ChatHistory = PromptMessage[]

export interface ChatEngine {
  runTurn(args: {
    history: ChatHistory
    user: PromptMessage
    system: PromptBlock[]
    tools: ToolDefinition[]
    onEvent: StreamSink
    cwd: string
    signal?: AbortSignal
    exec?: Partial<
      Pick<
        ExecutionContext,
        | 'agentDepth'
        | 'allowTools'
        | 'denyTools'
        | 'replMode'
        | 'getReplMode'
        | 'setReplMode'
        | 'getPlanPath'
        | 'planPath'
        | 'interactive'
      >
    >
  }): Promise<ChatHistory>
}

function isToolUseBlock(
  block: PromptBlock,
): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } {
  if (!block || typeof block !== 'object') return false
  if ((block as any).type !== 'tool_use') return false
  return typeof (block as any).id === 'string' && typeof (block as any).name === 'string'
}

export function createChatEngine(deps: {
  client: LlmStreamClient
  executor: ToolExecutor
}): ChatEngine {
  return {
    async runTurn({
      history,
      user,
      system,
      tools,
      onEvent,
      cwd,
      signal,
      exec,
    }): Promise<ChatHistory> {
      const loopMessages: ChatHistory = [...history, user]

      const executorCtxBase: ExecutionContext = {
        cwd,
        signal,
        onEvent,
        agentDepth: exec?.agentDepth ?? 0,
        interactive: exec?.interactive,
        replMode: exec?.replMode,
        getReplMode: exec?.getReplMode,
        setReplMode: exec?.setReplMode,
        getPlanPath: exec?.getPlanPath,
        planPath: exec?.planPath,
        allowTools: exec?.allowTools,
        denyTools: exec?.denyTools,
      }

      const executeTool = async (call: ToolCall): Promise<ToolResult> => {
        return deps.executor(call, executorCtxBase)
      }

      try {
        let iteration = 0
        while (true) {
          const { assistantBlocks, stopReason, toolResults } =
            await deps.client.streamOnce({
              messages: loopMessages,
              system,
              tools,
              onEvent,
              executeTool,
              signal,
            })

          const toolUseBlocks = assistantBlocks.filter(isToolUseBlock)

          loopMessages.push({ role: 'assistant', content: assistantBlocks })

          if (toolUseBlocks.length === 0 || stopReason !== 'tool_use') {
            break
          }

          loopMessages.push(
            ...toolResults.map((r) => ({
              role: 'user' as const,
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: r.tool_use_id,
                  content: r.content,
                  ...(r.is_error ? { is_error: true } : {}),
                },
              ],
            })),
          )

          iteration++
          if (iteration > 50) {
            throw new Error('Tool loop exceeded iteration limit')
          }
        }

        onEvent({ type: 'complete' })
        return loopMessages
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        onEvent({ type: 'error', error: err })
        throw err
      }
    },
  }
}
