import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import path from 'node:path'
import { computeContextStats, type ContextBudgetConfig } from '../../../chat/context/budget'
import type { StreamEvent, TokenUsage } from '../../../streaming/types'
import type { Msg } from '../../../components/tool/ToolMessage'
import type { ReminderService } from '../reminders/ReminderService'
import { makeMessageId } from './ids'
import { computeEditPatchStartLineNumber } from './patchStartLineNumber'
import type { CanonicalEvent } from '../../semantics/canonicalEvents'
import { forwardCanonicalStreamEvent, resolveCanonicalStreamWritePolicy } from './streamBridge'
import { buildCompletedToolMessage } from './streamingToolCompletion'
import {
  applyTaskStatsFromToolUpdate,
  finalizeExploreBatchOnTaskEnd,
  shouldApplyLegacyToolUpdate,
  updateTaskStateFromToolInput,
} from './streamingTaskState'
import type { ExploreTaskBatch } from './streamingTaskState'
import { isAbortLikeError, sumInputTokens } from './utils'

export type { ExploreTaskBatch }

function truncateLabel(text: string, max: number): string {
  const s = (text || '').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

function formatBasename(filePathRaw: unknown): string {
  const raw = String(filePathRaw || '').trim()
  if (!raw) return ''
  const normalized = raw.replace(/\\/g, '/')
  return path.basename(normalized)
}

function resolveEditPatchStartLineNumber(args: {
  cwd: string
  toolName: string | undefined
  isError: boolean
  toolInput: unknown
}): number | null {
  if (args.toolName !== 'Edit' || args.isError) return null
  return computeEditPatchStartLineNumber({
    cwd: args.cwd,
    input: args.toolInput ?? {},
  })
}

export function useReplStreaming(args: {
  assistantTextMode: string
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setThinkingText: Dispatch<SetStateAction<string>>
  setThinkingStartedAtMs: Dispatch<SetStateAction<number | null>>
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
  currentThinkingMessageIdRef: { current: string | null }
  thinkingLastFlushAtRef: { current: number }
  thinkingTimingRef: { current: { startedAtMs: number | null } }
  toolNameByIdRef: { current: Map<string, string> }
  toolInputByIdRef: { current: Map<string, unknown> }
  taskStatsByToolUseIdRef: {
    current: Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>
  }
  taskKindByToolUseIdRef: { current: Map<string, 'explore' | 'other'> }
  toolMessageIdByToolUseIdRef?: { current: Map<string, string> }
  cwd?: string
  exploreBatchRef: { current: ExploreTaskBatch | null }
  reminderServiceRef: { current: ReminderService | null }
  contextBudgetConfigRef: { current: ContextBudgetConfig | null }
  canonical?: {
    threadId: string
    getTurnId: () => string | null
    nextReplaySeq: () => number
    onEvent: (event: CanonicalEvent) => void
  }
}): { handleEvent: (ev: StreamEvent) => void } {
  const internalToolMessageIdByToolUseIdRef = useRef<Map<string, string>>(new Map())
  const toolMessageIdByToolUseIdRef = args.toolMessageIdByToolUseIdRef ?? internalToolMessageIdByToolUseIdRef
  const workingCwd = args.cwd ?? process.cwd()

  const flushAssistantBuffer = useCallback(() => {
    const text = args.assistantBufferRef.current
    if (!text) return
    args.assistantBufferRef.current = ''
    args.setMessages((prev) => [
      ...prev,
      {
        id: makeMessageId('assistant'),
        role: 'assistant',
        content: text,
        timestamp: new Date(),
      },
    ])
  }, [args])

  const startThinkingIfNeeded = useCallback(() => {
    if (args.thinkingTimingRef.current.startedAtMs !== null) return
    const now = Date.now()
    args.thinkingTimingRef.current.startedAtMs = now
    args.setThinkingStartedAtMs(now)
  }, [args])

  const finalizeThinkingSegment = useCallback(() => {
    const text = args.thinkingBufferRef.current
    const messageId = args.currentThinkingMessageIdRef.current
    // Ensure the latest buffered thinking is reflected in state even if the last delta
    // was throttled and we never flushed it.
    args.setThinkingText(text)
    if (messageId) {
      args.setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content: text } : m)))
    }

    args.currentThinkingMessageIdRef.current = null
    args.thinkingBufferRef.current = ''
    args.thinkingLastFlushAtRef.current = 0
  }, [args])

  const stopThinkingIfActive = useCallback(() => {
    const startedAt = args.thinkingTimingRef.current.startedAtMs
    if (startedAt === null) return
    args.thinkingTimingRef.current.startedAtMs = null
    args.setThinkingStartedAtMs(null)
    finalizeThinkingSegment()
  }, [args, finalizeThinkingSegment])

  const endActiveAssistantStreamIfAny = useCallback(() => {
    const activeAssistantId = args.currentAssistantIdRef.current
    if (!activeAssistantId) return
    args.setMessages((prev) => prev.map((m) => (m.id === activeAssistantId ? { ...m, isStreaming: false } : m)))
    args.currentAssistantIdRef.current = null
  }, [args])

  const handleEvent = useCallback(
    (ev: StreamEvent) => {
      const streamWritePolicy = resolveCanonicalStreamWritePolicy({
        canonical: args.canonical,
        event: ev,
      })
      const { canonicalTurnId, canonicalBridgeActive, canonicalOnly, canWriteLegacyTranscript, shouldForwardCanonical } =
        streamWritePolicy
      const updateLegacyMessages = (next: SetStateAction<Msg[]>) => {
        if (!canWriteLegacyTranscript) return
        args.setMessages(next)
      }
      if (shouldForwardCanonical) {
        forwardCanonicalStreamEvent({
          canonical: args.canonical,
          canonicalTurnId,
          event: ev,
          mapEvent:
            ev.type === 'tool_end'
              ? (event) => {
                  const toolName = args.toolNameByIdRef.current.get(ev.id)
                  const patchStartLineNumber = resolveEditPatchStartLineNumber({
                    cwd: workingCwd,
                    toolName,
                    isError: Boolean(ev.result.is_error),
                    toolInput: args.toolInputByIdRef.current.get(ev.id),
                  })
                  if (
                    patchStartLineNumber !== null &&
                    event.kind === 'tool_event' &&
                    event.phase === 'end' &&
                    event.toolUseId === ev.id
                  ) {
                    return { ...event, patchStartLineNumber }
                  }
                  return event
                }
              : undefined,
        })
      }

      switch (ev.type) {
        case 'assistant_delta': {
          stopThinkingIfActive()
          if (canonicalOnly) return
          if (args.assistantTextMode === 'buffered') {
            args.assistantBufferRef.current += ev.text
            return
          }

          const existingId = args.currentAssistantIdRef.current

          // NOTE: Avoid reading or mutating `currentAssistantIdRef` inside the state updater.
          // React may batch updates, and `complete`/`tool_start` can clear the ref before the
          // queued updater runs, causing later deltas to create a new assistant message.
          if (!existingId) {
            const assistantId = makeMessageId('assistant')
            args.currentAssistantIdRef.current = assistantId
            args.setMessages((prev) => [
              ...prev,
              {
                id: assistantId,
                role: 'assistant',
                content: ev.text,
                timestamp: new Date(),
                isStreaming: true,
              },
            ])
            return
          }

          args.setMessages((prev) =>
            prev.map((m) => (m.id === existingId ? { ...m, content: m.content + ev.text, isStreaming: true } : m)),
          )
          return
        }

        case 'thinking_delta': {
          startThinkingIfNeeded()
          if (canonicalBridgeActive) {
            args.thinkingBufferRef.current += ev.thinking
            const now = Date.now()
            if (args.thinkingLastFlushAtRef.current === 0 || now - args.thinkingLastFlushAtRef.current > 200) {
              args.thinkingLastFlushAtRef.current = now
              args.setThinkingText(args.thinkingBufferRef.current)
            }
            return
          }
          if (!args.currentThinkingMessageIdRef.current) {
            // Start a new thinking segment. This message is persisted in the transcript but
            // only rendered in the Expanded Transcript view (Ctrl+O).
            const thinkingId = `thinking-${Date.now()}`
            args.currentThinkingMessageIdRef.current = thinkingId
            args.thinkingBufferRef.current = ''
            // Seed the throttle window so an immediate second delta doesn't flush too early.
            args.thinkingLastFlushAtRef.current = Date.now()
            args.thinkingBufferRef.current += ev.thinking
            args.setThinkingText(args.thinkingBufferRef.current)
            args.setMessages((prev) => [
              ...prev,
              {
                id: thinkingId,
                role: 'assistant',
                ui: { kind: 'thinking_block' },
                content: args.thinkingBufferRef.current,
                timestamp: new Date(),
              },
            ])
            return
          }

          args.thinkingBufferRef.current += ev.thinking
          const now = Date.now()
          if (now - args.thinkingLastFlushAtRef.current > 200) {
            args.thinkingLastFlushAtRef.current = now
            args.setThinkingText(args.thinkingBufferRef.current)
            const id = args.currentThinkingMessageIdRef.current
            if (id) {
              const text = args.thinkingBufferRef.current
              args.setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: text } : m)))
            }
          }
          return
        }

        case 'thinking_stop': {
          stopThinkingIfActive()
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
          stopThinkingIfActive()
          if (args.assistantTextMode === 'buffered' && canWriteLegacyTranscript) {
            flushAssistantBuffer()
          } else if (canWriteLegacyTranscript) {
            endActiveAssistantStreamIfAny()
          }

          args.toolNameByIdRef.current.set(ev.id, ev.name)

          if (ev.name === 'Task') {
            args.taskStatsByToolUseIdRef.current.set(ev.id, { startedAt: Date.now(), toolUses: 0, usage: {} })
            args.taskKindByToolUseIdRef.current.set(ev.id, 'other')
          }

          args.setLoadingText(
            ev.name === 'AskUserQuestion'
              ? 'Waiting'
              : ev.name === 'Write'
                ? 'Preparing write'
                : ev.name === 'Edit'
                  ? 'Preparing edit'
                  : 'Working',
          )

          if (!canWriteLegacyTranscript) return

          const activeToolMsgId = toolMessageIdByToolUseIdRef.current.get(ev.id)
          if (activeToolMsgId) return

          const toolMsgId = makeMessageId(`tool-${ev.id}`)
          toolMessageIdByToolUseIdRef.current.set(ev.id, toolMsgId)
          updateLegacyMessages((prev) => [
            ...prev,
            {
              id: toolMsgId,
              role: 'tool' as const,
              content: '',
              timestamp: new Date(),
              toolInfo: {
                name: ev.name,
                toolUseId: ev.id,
                input: {},
                status: 'running' as const,
              },
            },
          ])
          return
        }

        case 'tool_input': {
          const toolMsgId = toolMessageIdByToolUseIdRef.current.get(ev.id) || `tool-${ev.id}`
          const toolName = args.toolNameByIdRef.current.get(ev.id)
          const nowMs = Date.now()

          args.toolInputByIdRef.current.set(ev.id, ev.input as any)

          if (toolName === 'Write' || toolName === 'Edit') {
            const filePathRaw = (ev.input as any)?.file_path ?? (ev.input as any)?.path
            const fileName = formatBasename(filePathRaw)
            if (fileName) {
              const verb = toolName === 'Write' ? 'Writing' : 'Editing'
              args.setLoadingText(`${verb} ${truncateLabel(fileName, 28)}`)
            }
          }

          args.exploreBatchRef.current = updateTaskStateFromToolInput({
            toolUseId: ev.id,
            toolName,
            input: ev.input,
            nowMs,
            taskKindByToolUseId: args.taskKindByToolUseIdRef.current,
            exploreBatch: args.exploreBatchRef.current,
          })

          if (!canWriteLegacyTranscript) return

          updateLegacyMessages((prev) =>
            prev.map((m) =>
              m.id === toolMsgId ? { ...m, toolInfo: { ...m.toolInfo!, input: ev.input as any } } : m,
            ),
          )
          return
        }

        case 'tool_update': {
          const toolMsgId = toolMessageIdByToolUseIdRef.current.get(ev.id) || `tool-${ev.id}`
          const toolName = args.toolNameByIdRef.current.get(ev.id)
          const nowMs = Date.now()
          applyTaskStatsFromToolUpdate({
            toolUseId: ev.id,
            toolUses: typeof ev.toolUses === 'number' ? ev.toolUses : undefined,
            usage: ev.usage,
            taskStatsByToolUseId: args.taskStatsByToolUseIdRef.current,
            nowMs,
          })

          if (!canWriteLegacyTranscript) return

          if (shouldApplyLegacyToolUpdate({ toolName, event: ev })) {
            updateLegacyMessages((prev) =>
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
          // If we previously set a more specific activity label (e.g. "Writing foo.txt"),
          // reset it to a generic value once the tool finishes so it doesn't linger.
          args.setLoadingText('Working')

          const toolMsgId = toolMessageIdByToolUseIdRef.current.get(ev.id) || `tool-${ev.id}`
          toolMessageIdByToolUseIdRef.current.delete(ev.id)
          const toolNameFromStart = args.toolNameByIdRef.current.get(ev.id)
          args.toolNameByIdRef.current.delete(ev.id)
          const toolInputFromStart = args.toolInputByIdRef.current.get(ev.id)
          args.toolInputByIdRef.current.delete(ev.id)
          const taskKind = args.taskKindByToolUseIdRef.current.get(ev.id)
          args.taskKindByToolUseIdRef.current.delete(ev.id)
          const taskStats = args.taskStatsByToolUseIdRef.current.get(ev.id)
          args.taskStatsByToolUseIdRef.current.delete(ev.id)

          if (canWriteLegacyTranscript) {
            updateLegacyMessages((prev) => {
              const toolMsg = prev.find((m) => m.id === toolMsgId)
              const toolInput = toolInputFromStart ?? toolMsg?.toolInfo?.input ?? null
              const editPatchStartLineNumber = resolveEditPatchStartLineNumber({
                cwd: workingCwd,
                toolName: toolNameFromStart || toolMsg?.toolInfo?.name,
                isError: Boolean(ev.result.is_error),
                toolInput,
              })
              const completedToolMessage = buildCompletedToolMessage({
                toolMessage: toolMsg,
                toolUseId: ev.id,
                toolNameFromStart,
                toolInputFromStart,
                result: ev.result,
                taskStats,
                editPatchStartLineNumber,
              })
              return prev.map((m) =>
                m.id === toolMsgId ? { ...completedToolMessage, id: m.id, timestamp: m.timestamp } : m,
              )
            })
          }

          const exploreBatchOutcome = finalizeExploreBatchOnTaskEnd({
            toolUseId: ev.id,
            taskKind,
            exploreBatch: args.exploreBatchRef.current,
            nowMs: Date.now(),
          })
          args.exploreBatchRef.current = exploreBatchOutcome.nextBatch
          if (exploreBatchOutcome.summaryCount !== null && canWriteLegacyTranscript) {
            const count = exploreBatchOutcome.summaryCount
            updateLegacyMessages((prev) => [
              ...prev,
              {
                id: makeMessageId('assistant'),
                role: 'assistant',
                content: `${count} Explore agents finished (ctrl+o to expand)`,
                timestamp: new Date(),
              },
            ])
          }

          args.reminderServiceRef.current?.recordToolResult({
            toolName: toolNameFromStart || 'Tool',
            ok: !ev.result.is_error,
          })

          if (canWriteLegacyTranscript) {
            endActiveAssistantStreamIfAny()
          }

          return
        }

        case 'error': {
          if (isAbortLikeError(ev.error)) {
            toolMessageIdByToolUseIdRef.current.clear()
            return
          }
          toolMessageIdByToolUseIdRef.current.clear()
          args.setError(ev.error.message)
          return
        }

        case 'complete': {
          toolMessageIdByToolUseIdRef.current.clear()
          stopThinkingIfActive()
          if (!canWriteLegacyTranscript) {
            args.currentAssistantIdRef.current = null
            args.assistantBufferRef.current = ''
            return
          }
          if (args.assistantTextMode === 'buffered') {
            flushAssistantBuffer()
          } else {
            endActiveAssistantStreamIfAny()
          }

          return
        }

        default:
          return
      }
    },
    [args, endActiveAssistantStreamIfAny, flushAssistantBuffer, startThinkingIfNeeded, stopThinkingIfActive],
  )

  return { handleEvent }
}
