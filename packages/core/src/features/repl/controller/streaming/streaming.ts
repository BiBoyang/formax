import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { computeContextStats, type ContextBudgetConfig } from '../../../../chat/context/budget'
import type { StreamEvent, TokenUsage } from '../../../../streaming/types'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { ReminderService } from '../../reminders/ReminderService'
import { makeMessageId } from '../shared/ids'
import { computeEditPatchStartLineNumber } from './patchStartLineNumber'
import type { CanonicalEvent } from '../../../semantics/core/canonicalEvents'
import { forwardCanonicalStreamEvent, resolveCanonicalStreamWritePolicy } from './streamBridge'
import { resolveLoadingTextForToolInput, resolveLoadingTextForToolStart } from './streamingLoadingText'
import {
  finalizeAssistantStreamInMessages,
  updateThinkingBlockContent,
} from './streamingTextRows'
import {
  applyTaskStatsFromToolUpdate,
  finalizeExploreBatchOnTaskEnd,
  updateTaskStateFromToolInput,
} from './streamingTaskState'
import type { ExploreTaskBatch } from './streamingTaskState'
import { consumeToolEndState } from './streamingToolLifecycle'
import { isAbortLikeError, sumInputTokens } from '../shared/utils'
import { createLegacyTranscriptMutator } from './streamingLegacyTranscript'
import {
  writeLegacyAssistantDeltaFallback,
  writeLegacyExploreSummaryFallback,
  writeLegacyToolEndFallback,
  writeLegacyThinkingStartFallback,
  writeLegacyThinkingUpdateFallback,
  writeLegacyToolInputFallback,
  writeLegacyToolStartFallback,
  writeLegacyToolUpdateFallback,
} from './streamingLegacyCompat'

export type { ExploreTaskBatch }

type TurnStreamingRefs = {
  currentAssistantIdRef: { current: string | null }
  assistantBufferRef: { current: string }
  thinkingRefs: {
    bufferRef: { current: string }
    messageIdRef: { current: string | null }
    lastFlushAtRef: { current: number }
    timingRef: { current: { startedAtMs: number | null } }
  }
}

type ToolRuntimeRefs = {
  nameByIdRef: { current: Map<string, string> }
  inputByIdRef: { current: Map<string, unknown> }
  statsByToolUseIdRef: {
    current: Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>
  }
  kindByToolUseIdRef: { current: Map<string, 'explore' | 'other'> }
  messageIdByToolUseIdRef?: { current: Map<string, string> }
  exploreBatchRef: { current: ExploreTaskBatch | null }
}

type TurnFlowRefs = {
  reminderServiceRef: { current: ReminderService | null }
  contextBudgetConfigRef: { current: ContextBudgetConfig | null }
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
  turnStreamingRefs: TurnStreamingRefs
  toolRuntimeRefs: ToolRuntimeRefs
  turnFlowRefs: TurnFlowRefs
  cwd?: string
  canonical?: {
    // Local TUI path is runtime-authoritative for canonical envelope generation.
    // These fields must remain contract-equivalent to app-server notifications.
    threadId: string
    getTurnId: () => string | null
    nextReplaySeq: () => number
    onEvent: (event: CanonicalEvent) => void
  }
}): { handleEvent: (ev: StreamEvent) => void } {
  const {
    currentAssistantIdRef,
    assistantBufferRef,
    thinkingRefs,
  } = args.turnStreamingRefs
  const {
    bufferRef: thinkingBufferRef,
    messageIdRef: currentThinkingMessageIdRef,
    lastFlushAtRef: thinkingLastFlushAtRef,
    timingRef: thinkingTimingRef,
  } = thinkingRefs
  const {
    nameByIdRef: toolNameByIdRef,
    inputByIdRef: toolInputByIdRef,
    statsByToolUseIdRef: taskStatsByToolUseIdRef,
    kindByToolUseIdRef: taskKindByToolUseIdRef,
    messageIdByToolUseIdRef,
    exploreBatchRef,
  } = args.toolRuntimeRefs
  const { reminderServiceRef, contextBudgetConfigRef } = args.turnFlowRefs
  const internalToolMessageIdByToolUseIdRef = useRef<Map<string, string>>(new Map())
  const resolvedToolMessageIdByToolUseIdRef = messageIdByToolUseIdRef ?? internalToolMessageIdByToolUseIdRef
  const workingCwd = args.cwd ?? process.cwd()

  const flushAssistantBuffer = useCallback(() => {
    const text = assistantBufferRef.current
    if (!text) return
    assistantBufferRef.current = ''
    args.setMessages((prev) => [
      ...prev,
      {
        id: makeMessageId('assistant'),
        role: 'assistant',
        content: text,
        timestamp: new Date(),
      },
    ])
  }, [args, assistantBufferRef])

  const startThinkingIfNeeded = useCallback(() => {
    if (thinkingTimingRef.current.startedAtMs !== null) return
    const now = Date.now()
    thinkingTimingRef.current.startedAtMs = now
    args.setThinkingStartedAtMs(now)
  }, [args, thinkingTimingRef])

  const finalizeThinkingSegment = useCallback(() => {
    const text = thinkingBufferRef.current
    const messageId = currentThinkingMessageIdRef.current
    // Ensure the latest buffered thinking is reflected in state even if the last delta
    // was throttled and we never flushed it.
    args.setThinkingText(text)
    if (messageId) {
      args.setMessages((prev) =>
        updateThinkingBlockContent({
          previous: prev,
          thinkingId: messageId,
          text,
        }),
      )
    }

    currentThinkingMessageIdRef.current = null
    thinkingBufferRef.current = ''
    thinkingLastFlushAtRef.current = 0
  }, [args, currentThinkingMessageIdRef, thinkingBufferRef, thinkingLastFlushAtRef])

  const stopThinkingIfActive = useCallback(() => {
    const startedAt = thinkingTimingRef.current.startedAtMs
    if (startedAt === null) return
    thinkingTimingRef.current.startedAtMs = null
    args.setThinkingStartedAtMs(null)
    finalizeThinkingSegment()
  }, [args, finalizeThinkingSegment, thinkingTimingRef])

  const endActiveAssistantStreamIfAny = useCallback(() => {
    const activeAssistantId = currentAssistantIdRef.current
    if (!activeAssistantId) return
    args.setMessages((prev) =>
      finalizeAssistantStreamInMessages({
        previous: prev,
        assistantId: activeAssistantId,
      }),
    )
    currentAssistantIdRef.current = null
  }, [args, currentAssistantIdRef])

  const handleEvent = useCallback(
    (ev: StreamEvent) => {
      const streamWritePolicy = resolveCanonicalStreamWritePolicy({
        canonical: args.canonical,
        event: ev,
      })
      const { canonicalTurnId, canonicalBridgeActive, canonicalOnly, canWriteLegacyTranscript, shouldForwardCanonical } =
        streamWritePolicy
      const legacyTranscript = createLegacyTranscriptMutator({
        canWriteLegacyTranscript,
        setMessages: args.setMessages,
      })
      if (shouldForwardCanonical) {
        forwardCanonicalStreamEvent({
          canonical: args.canonical,
          canonicalTurnId,
          event: ev,
          mapEvent:
            ev.type === 'tool_end'
              ? (event) => {
                  const toolName = toolNameByIdRef.current.get(ev.id)
                  const patchStartLineNumber = resolveEditPatchStartLineNumber({
                    cwd: workingCwd,
                    toolName,
                    isError: Boolean(ev.result.is_error),
                    toolInput: toolInputByIdRef.current.get(ev.id),
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
            assistantBufferRef.current += ev.text
            return
          }

          // NOTE: Avoid reading or mutating `currentAssistantIdRef` inside a state updater.
          // React may batch updates, and `complete`/`tool_start` can clear the ref before the
          // queued updater runs, causing later deltas to create a new assistant message.
          currentAssistantIdRef.current = writeLegacyAssistantDeltaFallback({
            legacyTranscript,
            assistantId: currentAssistantIdRef.current,
            text: ev.text,
            createAssistantId: () => makeMessageId('assistant'),
          })
          return
        }

        case 'thinking_delta': {
          startThinkingIfNeeded()
          if (canonicalBridgeActive) {
            thinkingBufferRef.current += ev.thinking
            const now = Date.now()
            if (thinkingLastFlushAtRef.current === 0 || now - thinkingLastFlushAtRef.current > 200) {
              thinkingLastFlushAtRef.current = now
              args.setThinkingText(thinkingBufferRef.current)
            }
            return
          }
          if (!currentThinkingMessageIdRef.current) {
            // Start a new thinking segment. This message is persisted in the transcript but
            // only rendered in the Expanded Transcript view (Ctrl+O).
            const thinkingId = `thinking-${Date.now()}`
            currentThinkingMessageIdRef.current = thinkingId
            thinkingBufferRef.current = ''
            // Seed the throttle window so an immediate second delta doesn't flush too early.
            thinkingLastFlushAtRef.current = Date.now()
            thinkingBufferRef.current += ev.thinking
            args.setThinkingText(thinkingBufferRef.current)
            writeLegacyThinkingStartFallback({
              legacyTranscript,
              thinkingId,
              text: thinkingBufferRef.current,
            })
            return
          }

          thinkingBufferRef.current += ev.thinking
          const now = Date.now()
          if (now - thinkingLastFlushAtRef.current > 200) {
            thinkingLastFlushAtRef.current = now
            args.setThinkingText(thinkingBufferRef.current)
            const text = thinkingBufferRef.current
            const thinkingId = currentThinkingMessageIdRef.current as string
            writeLegacyThinkingUpdateFallback({
              legacyTranscript,
              thinkingId,
              text,
            })
          }
          return
        }

        case 'thinking_stop': {
          stopThinkingIfActive()
          return
        }

        case 'usage': {
          const cfg = contextBudgetConfigRef.current
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
          if (args.assistantTextMode === 'buffered' && legacyTranscript.canWrite) {
            flushAssistantBuffer()
          } else if (legacyTranscript.canWrite) {
            endActiveAssistantStreamIfAny()
          }

          toolNameByIdRef.current.set(ev.id, ev.name)

          if (ev.name === 'Task') {
            taskStatsByToolUseIdRef.current.set(ev.id, { startedAt: Date.now(), toolUses: 0, usage: {} })
            taskKindByToolUseIdRef.current.set(ev.id, 'other')
          }

          args.setLoadingText(resolveLoadingTextForToolStart(ev.name))

          writeLegacyToolStartFallback({
            legacyTranscript,
            toolUseId: ev.id,
            toolName: ev.name,
            toolMessageIdByToolUseId: resolvedToolMessageIdByToolUseIdRef.current,
            createToolMessageId: (toolUseId) => makeMessageId(`tool-${toolUseId}`),
          })
          return
        }

        case 'tool_input': {
          const toolName = toolNameByIdRef.current.get(ev.id)
          const nowMs = Date.now()

          toolInputByIdRef.current.set(ev.id, ev.input as any)

          const loadingTextFromInput = resolveLoadingTextForToolInput({
            toolName,
            input: ev.input,
          })
          if (loadingTextFromInput) {
            args.setLoadingText(loadingTextFromInput)
          }

          exploreBatchRef.current = updateTaskStateFromToolInput({
            toolUseId: ev.id,
            toolName,
            input: ev.input,
            nowMs,
            taskKindByToolUseId: taskKindByToolUseIdRef.current,
            exploreBatch: exploreBatchRef.current,
          })

          writeLegacyToolInputFallback({
            legacyTranscript,
            toolUseId: ev.id,
            input: ev.input,
            toolMessageIdByToolUseId: resolvedToolMessageIdByToolUseIdRef.current,
          })
          return
        }

        case 'tool_update': {
          const toolName = toolNameByIdRef.current.get(ev.id)
          const nowMs = Date.now()
          applyTaskStatsFromToolUpdate({
            toolUseId: ev.id,
            toolUses: typeof ev.toolUses === 'number' ? ev.toolUses : undefined,
            usage: ev.usage,
            taskStatsByToolUseId: taskStatsByToolUseIdRef.current,
            nowMs,
          })

          writeLegacyToolUpdateFallback({
            legacyTranscript,
            toolUseId: ev.id,
            toolName,
            event: ev,
            toolMessageIdByToolUseId: resolvedToolMessageIdByToolUseIdRef.current,
          })

          return
        }

        case 'tool_end': {
          // If we previously set a more specific activity label (e.g. "Writing foo.txt"),
          // reset it to a generic value once the tool finishes so it doesn't linger.
          args.setLoadingText('Working')

          const { toolMsgId, toolNameFromStart, toolInputFromStart, taskKind, taskStats } = consumeToolEndState({
            toolUseId: ev.id,
            toolMessageIdByToolUseId: resolvedToolMessageIdByToolUseIdRef.current,
            toolNameById: toolNameByIdRef.current,
            toolInputById: toolInputByIdRef.current,
            taskKindByToolUseId: taskKindByToolUseIdRef.current,
            taskStatsByToolUseId: taskStatsByToolUseIdRef.current,
          })

          writeLegacyToolEndFallback({
            legacyTranscript,
            toolUseId: ev.id,
            toolMsgId,
            toolNameFromStart,
            toolInputFromStart,
            result: ev.result,
            taskStats,
            workingCwd,
            resolveEditPatchStartLineNumber,
          })

          const exploreBatchOutcome = finalizeExploreBatchOnTaskEnd({
            toolUseId: ev.id,
            taskKind,
            exploreBatch: exploreBatchRef.current,
            nowMs: Date.now(),
          })
          exploreBatchRef.current = exploreBatchOutcome.nextBatch
          if (exploreBatchOutcome.summaryCount !== null) {
            writeLegacyExploreSummaryFallback({
              legacyTranscript,
              count: exploreBatchOutcome.summaryCount,
              createAssistantId: () => makeMessageId('assistant'),
            })
          }

          reminderServiceRef.current?.recordToolResult({
            toolName: toolNameFromStart || 'Tool',
            ok: !ev.result.is_error,
          })

          if (legacyTranscript.canWrite) {
            endActiveAssistantStreamIfAny()
          }

          return
        }

        case 'error': {
          if (isAbortLikeError(ev.error)) {
            resolvedToolMessageIdByToolUseIdRef.current.clear()
            return
          }
          resolvedToolMessageIdByToolUseIdRef.current.clear()
          args.setError(ev.error.message)
          return
        }

        case 'complete': {
          resolvedToolMessageIdByToolUseIdRef.current.clear()
          stopThinkingIfActive()
          if (!legacyTranscript.canWrite) {
            currentAssistantIdRef.current = null
            assistantBufferRef.current = ''
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
