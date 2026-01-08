import type { PromptBlock, PromptMessage } from '../prompts'
import type { ToolCall, ToolDefinition, ToolResult } from '../tools/types'
import type { ExecutionContext, ToolExecutor } from '../tools/executor'
import type { StreamSink } from '../streaming/types'
import type { ContentBlock } from '../streaming/anthropic/sseParser'
import type { AnthropicStreamClient } from '../streaming/anthropic/StreamClient'

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
        'agentDepth' | 'allowTools' | 'denyTools' | 'replMode' | 'getReplMode' | 'setReplMode'
      >
    >
  }): Promise<ChatHistory>
}

export function createChatEngine(deps: {
  client: AnthropicStreamClient
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
        replMode: exec?.replMode,
        getReplMode: exec?.getReplMode,
        setReplMode: exec?.setReplMode,
        allowTools: exec?.allowTools,
        denyTools: exec?.denyTools,
      }

      const executeTool = async (call: ToolCall): Promise<ToolResult> => {
        return deps.executor(call, executorCtxBase)
      }

      try {
        let iteration = 0
        while (true) {
          const { contentBlocks, stopReason, toolResults } =
            await deps.client.streamOnce({
              messages: loopMessages,
              system,
              tools,
              onEvent,
              executeTool,
              signal,
            })

          const toolCalls = contentBlocks
            .filter((b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use')
            .map((b) => ({ id: b.id!, name: b.name!, input: b.input || {} }))

          const assistantContent = contentBlocks.map((block) => {
            if (block.type === 'text') {
              return { type: 'text', text: block.text || '' }
            }
            if (block.type === 'tool_use') {
              return {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input || {},
              }
            }
            if (block.type === 'thinking') {
              return { type: 'thinking', thinking: block.thinking || '' }
            }
            return block as any
          })

          loopMessages.push({ role: 'assistant', content: assistantContent })

          if (toolCalls.length === 0 || stopReason !== 'tool_use') {
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
