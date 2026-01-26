import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { computeContextStats, type ContextBudgetConfig } from '../../../chat/context/budget'
import type { StreamEvent, TokenUsage } from '../../../streaming/types'
import type { Msg } from '../../../components/tool/ToolMessage'
import { formatToolResult, stripTrailingSystemReminderBlock } from '../../../utils/toolFormatting'
import type { ReminderService } from '../reminders/ReminderService'
import {
  formatDuration,
  formatTokenTotal,
  formatToolUses,
  isAbortLikeError,
  sumInputTokens,
} from './utils'

export type ExploreTaskBatch = {
  toolUseIds: Set<string>
  completedToolUseIds: Set<string>
  lastSeenAtMs: number
}

function parseBackgroundTaskId(rawResult: string): string | null {
  const text = String(rawResult || '').trim()
  if (!text) return null

  try {
    const parsed = JSON.parse(text)
    const taskId = (parsed as any)?.task_id
    const status = (parsed as any)?.status
    if (typeof taskId === 'string' && taskId.trim() && status === 'running') {
      return taskId.trim()
    }
  } catch {
    // not JSON
  }

  return null
}

function parseTaskTranscript(rawResult: string): string[] | null {
  const text = stripTrailingSystemReminderBlock(String(rawResult || ''))
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    const transcript = (parsed as any)?.transcript
    if (!Array.isArray(transcript)) return null
    const lines = transcript.map((l: any) => String(l ?? ''))
    return lines.length ? lines : null
  } catch {
    return null
  }
}

export function useReplStreaming(args: {
  assistantTextMode: string
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setThinkingText: Dispatch<SetStateAction<string>>
  setLoadingText: Dispatch<SetStateAction<string>>
  setContext: Dispatch<
    SetStateAction<
      | {
          usedTokens: number
          limitTokens: number
          percentRemaining: number
          source: 'usage'
        }
      | null
    >
  >
  setError: Dispatch<SetStateAction<string | null>>
  currentAssistantIdRef: { current: string | null }
  assistantBufferRef: { current: string }
  thinkingBufferRef: { current: string }
  thinkingLastFlushAtRef: { current: number }
  toolNameByIdRef: { current: Map<string, string> }
  taskStatsByToolUseIdRef: {
    current: Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>
  }
  taskKindByToolUseIdRef: { current: Map<string, 'explore' | 'other'> }
  exploreBatchRef: { current: ExploreTaskBatch | null }
  reminderServiceRef: { current: ReminderService | null }
  contextBudgetConfigRef: { current: ContextBudgetConfig | null }
}): {
  flushAssistantBuffer: () => void
  handleEvent: (ev: StreamEvent) => void
} {
  const flushAssistantBuffer = useCallback(() => {
    const text = args.assistantBufferRef.current
    if (!text) return
    args.assistantBufferRef.current = ''
    args.setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: text,
        timestamp: new Date(),
      },
    ])
  }, [args])

  const handleEvent = useCallback(
    (ev: StreamEvent) => {
      switch (ev.type) {
        case 'assistant_delta': {
          if (args.assistantTextMode === 'buffered') {
            args.assistantBufferRef.current += ev.text
            return
          }

          args.setMessages((prev) => {
            const existingId = args.currentAssistantIdRef.current

            if (!existingId) {
              const assistantId = `assistant-${Date.now()}`
              args.currentAssistantIdRef.current = assistantId
              return [
                ...prev,
                {
                  id: assistantId,
                  role: 'assistant',
                  content: ev.text,
                  timestamp: new Date(),
                  isStreaming: true,
                },
              ]
            }

            return prev.map((m) =>
              m.id === existingId
                ? { ...m, content: m.content + ev.text, isStreaming: true }
                : m,
            )
          })
          return
        }

        case 'thinking_delta': {
          args.thinkingBufferRef.current += ev.thinking
          const now = Date.now()
          if (now - args.thinkingLastFlushAtRef.current > 200) {
            args.thinkingLastFlushAtRef.current = now
            args.setThinkingText(args.thinkingBufferRef.current)
          }
          return
        }

        case 'usage': {
          const cfg = args.contextBudgetConfigRef.current
          if (!cfg) return

          const usedTokens = sumInputTokens(ev.usage)
          const stats = computeContextStats({ config: cfg, usedTokens })
          args.setContext({
            usedTokens: stats.usedTokens,
            limitTokens: stats.effectiveLimitTokens,
            percentRemaining: stats.percentRemaining,
            source: 'usage',
          })
          return
        }

        case 'tool_start': {
          if (args.assistantTextMode === 'buffered') {
            flushAssistantBuffer()
          } else {
            if (args.currentAssistantIdRef.current) {
              const id = args.currentAssistantIdRef.current
              args.setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)))
              args.currentAssistantIdRef.current = null
            }
          }

          args.toolNameByIdRef.current.set(ev.id, ev.name)

          if (ev.name === 'Task') {
            args.taskStatsByToolUseIdRef.current.set(ev.id, { startedAt: Date.now(), toolUses: 0, usage: {} })
            args.taskKindByToolUseIdRef.current.set(ev.id, 'other')
          }

          args.setLoadingText(ev.name === 'AskUserQuestion' ? 'Waiting' : 'Working')

          const toolMsgId = `tool-${ev.id}`
          args.setMessages((prev) => [
            ...prev,
            {
              id: toolMsgId,
              role: 'tool',
              content: '',
              timestamp: new Date(),
              toolInfo: {
                name: ev.name,
                toolUseId: ev.id,
                input: {},
                status: 'running',
              },
            },
          ])
          return
        }

        case 'tool_input': {
          const toolMsgId = `tool-${ev.id}`
          const toolName = args.toolNameByIdRef.current.get(ev.id)

          if (toolName === 'Task') {
            const subagentType = (ev.input as any)?.subagent_type
            const isExplore = String(subagentType || '') === 'Explore'
            args.taskKindByToolUseIdRef.current.set(ev.id, isExplore ? 'explore' : 'other')

            if (isExplore) {
              const now = Date.now()
              const prevBatch = args.exploreBatchRef.current
              const withinWindow = prevBatch && now - prevBatch.lastSeenAtMs < 1500
              const batch: ExploreTaskBatch =
                withinWindow && prevBatch
                  ? prevBatch
                  : { toolUseIds: new Set(), completedToolUseIds: new Set(), lastSeenAtMs: now }
              batch.toolUseIds.add(ev.id)
              batch.lastSeenAtMs = now
              args.exploreBatchRef.current = batch
            }
          }

          args.setMessages((prev) =>
            prev.map((m) =>
              m.id === toolMsgId ? { ...m, toolInfo: { ...m.toolInfo!, input: ev.input as any } } : m,
            ),
          )
          return
        }

        case 'tool_update': {
          const toolMsgId = `tool-${ev.id}`
          const toolName = args.toolNameByIdRef.current.get(ev.id)

          if (typeof ev.toolUses === 'number') {
            const existing = args.taskStatsByToolUseIdRef.current.get(ev.id)
            if (existing) {
              existing.toolUses = ev.toolUses
            } else {
              args.taskStatsByToolUseIdRef.current.set(ev.id, { startedAt: Date.now(), toolUses: ev.toolUses, usage: {} })
            }
          }

          if (ev.usage) {
            const existing = args.taskStatsByToolUseIdRef.current.get(ev.id)
            if (existing) {
              existing.usage = ev.usage
            } else {
              args.taskStatsByToolUseIdRef.current.set(ev.id, { startedAt: Date.now(), toolUses: 0, usage: ev.usage })
            }
          }

          if (
            ev.middleLines ||
            ev.nestedTools ||
            ev.transcriptLines ||
            (toolName === 'Task' && (typeof ev.toolUses === 'number' || ev.usage))
          ) {
            args.setMessages((prev) =>
              prev.map((m) =>
                m.id === toolMsgId
                  ? {
                      ...m,
                      toolInfo: {
                        ...m.toolInfo!,
                        ...(ev.middleLines ? { middleLines: ev.middleLines } : {}),
                        ...(ev.transcriptLines ? { transcriptLines: ev.transcriptLines } : {}),
                        ...(ev.nestedTools ? { nestedTools: ev.nestedTools } : {}),
                        ...(toolName === 'Task' && typeof ev.toolUses === 'number' ? { toolUses: ev.toolUses } : {}),
                        ...(toolName === 'Task' && ev.usage ? { usage: ev.usage } : {}),
                      },
                    }
                  : m,
              ),
            )
          }

          return
        }

        case 'tool_end': {
          const toolMsgId = `tool-${ev.id}`
          const toolNameFromStart = args.toolNameByIdRef.current.get(ev.id)
          args.toolNameByIdRef.current.delete(ev.id)
          const taskKind = args.taskKindByToolUseIdRef.current.get(ev.id)
          args.taskKindByToolUseIdRef.current.delete(ev.id)

          args.setMessages((prev) => {
            const toolMsg = prev.find((m) => m.id === toolMsgId)
            const toolName = toolNameFromStart || toolMsg?.toolInfo?.name || 'Tool'

            const rawResult = ev.result.content
            const displayResult =
              ev.result.is_error && rawResult.startsWith('Error: ')
                ? rawResult.slice('Error: '.length)
                : rawResult

            if (toolName === 'Task') {
              const stats = args.taskStatsByToolUseIdRef.current.get(ev.id)
              args.taskStatsByToolUseIdRef.current.delete(ev.id)
              const startedAt = stats?.startedAt ?? Date.now()
              const durationMs = Date.now() - startedAt

              const tokens = formatTokenTotal(stats?.usage)
              const backgroundTaskId = parseBackgroundTaskId(rawResult)
              const parsedTranscript = parseTaskTranscript(rawResult)
              const doneText = ev.result.is_error
                ? displayResult || 'Error'
                : backgroundTaskId
                  ? `Started (task_id: ${backgroundTaskId})`
                  : `Done (${formatToolUses(stats?.toolUses ?? 0)}${tokens ? ` · ${tokens} tokens` : ''} · ${formatDuration(
                      durationMs,
                    )})`

              return prev.map((m) =>
                m.id === toolMsgId
                  ? {
                      ...m,
                      content: doneText,
                      toolInfo: {
                        ...m.toolInfo!,
                        status: ev.result.is_error ? 'error' : 'completed',
                        result: rawResult,
                        ...(parsedTranscript ? { transcriptLines: parsedTranscript } : {}),
                        ...(stats ? { toolUses: stats.toolUses, usage: stats.usage, durationMs } : { durationMs }),
                      },
                    }
                  : m,
              )
            }

            if (toolName === 'Skill' && !ev.result.is_error) {
              return prev.map((m) =>
                m.id === toolMsgId
                  ? {
                      ...m,
                      content: '',
                      toolInfo: {
                        ...m.toolInfo!,
                        status: 'completed',
                        result: rawResult,
                      },
                    }
                  : m,
              )
            }

            const { summary, middleLines, expandInfo, lines } = formatToolResult(
              toolName,
              displayResult,
              Boolean(ev.result.is_error),
            )

            return prev.map((m) =>
              m.id === toolMsgId
                ? {
                    ...m,
                    content: summary,
                    toolInfo: {
                      ...m.toolInfo!,
                      status: ev.result.is_error ? 'error' : 'completed',
                      result: rawResult,
                      resultLines: lines,
                      expandInfo,
                      middleLines,
                    },
                  }
                : m,
            )
          })

          if (toolNameFromStart === 'Task' && taskKind === 'explore') {
            const batch = args.exploreBatchRef.current
            if (batch && batch.toolUseIds.has(ev.id)) {
              batch.completedToolUseIds.add(ev.id)
              batch.lastSeenAtMs = Date.now()

              if (batch.toolUseIds.size >= 2 && batch.completedToolUseIds.size === batch.toolUseIds.size) {
                args.exploreBatchRef.current = null
                const count = batch.toolUseIds.size
                args.setMessages((prev) => [
                  ...prev,
                  {
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    content: `${count} Explore agents finished (ctrl+o to expand)`,
                    timestamp: new Date(),
                  },
                ])
              }
            }
          }

          args.reminderServiceRef.current?.recordToolResult({
            toolName: toolNameFromStart || 'Tool',
            ok: !ev.result.is_error,
          })

          args.currentAssistantIdRef.current = null

          return
        }

        case 'error': {
          if (isAbortLikeError(ev.error)) {
            return
          }
          args.setError(ev.error.message)
          return
        }

        case 'complete': {
          if (args.assistantTextMode === 'buffered') {
            flushAssistantBuffer()
          } else {
            if (args.currentAssistantIdRef.current) {
              const id = args.currentAssistantIdRef.current
              args.setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)))
              args.currentAssistantIdRef.current = null
            }
          }

          args.setThinkingText(args.thinkingBufferRef.current)
          return
        }

        default:
          return
      }
    },
    [args, flushAssistantBuffer],
  )

  return { flushAssistantBuffer, handleEvent }
}
