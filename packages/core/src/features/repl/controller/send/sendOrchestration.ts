import type { Dispatch, SetStateAction } from 'react'
import type { ChatEngine } from '../../../../chat/engine'
import type { ContextCollapseStoreSnapshot } from '../../../../chat/context/contextCollapseStore'
import type { RuntimeConfig } from '../../../../config/config'
import type { RuntimeFlags } from '../../../../config/runtimeFlags'
import type { StreamEvent } from '../../../../streaming/types'
import type { ToolDefinition } from '../../../../tools/types'
import type { ReplMode } from '../../mode'
import type { PlanSessionManager } from '../../planSession'
import type { ReminderService } from '../../reminders/ReminderService'
import type { LocalCommandRecord, SlashCommandRegistry } from '../../../commands/registry'
import type { OverlaySpec } from '../../../commands/contracts'
import type { CanonicalUiMessage } from './sendTypes'
import { applyProviderErrorToState } from '../shared'
import { resolvePreMainSendRouting } from './sendPreMainRouting'
import type { CompactLifecycleEvent } from './compactFlow'
import type { ContextCollapseMeta } from '../../../../chat/context/contextCollapse'
import type { RequestCollapseCommitState } from './contextCompressionService'
import type { ReactiveCompactErrorKind } from './reactiveCompact'
import { createMainTurnExecutionContext } from './sendMainTurnContext'
import { runMainSendTurn } from './sendMainTurn'
import type { ReplModeAccess, SendStateSetters, SendTurnSharedRefs } from './sendTypes'

type RunReplModelSendFlowArgs = {
  input: {
    text: string
    preferredSlashSpecId?: string
    provider: 'openai' | 'anthropic'
    providerError: string | null
  }
  deps: {
    engine: ChatEngine
    cfg: RuntimeConfig
    mode: ReplMode
    planSession?: PlanSessionManager
    commandRegistry?: SlashCommandRegistry
    tools: ToolDefinition[]
    runtimeFlags?: RuntimeFlags
    allowedSubagents: Array<{ name: string; description: string }>
  }
  sendContext: {
    sendStateSetters: SendStateSetters
    replModeAccess: ReplModeAccess
    sendTurnSharedRefs: SendTurnSharedRefs
  }
  turnRefs: {
    pendingExitPlanReminderRef: { current: boolean }
    deferredToolExposureSessionKeyRef?: { current: string }
    sendSeqRef: { current: number }
    autoCompactSeqRef: { current: number }
    reminderServiceRef: { current: ReminderService | null }
    getSessionFilePath?: () => string | null
    getContextCollapseStoreSnapshot?: () => ContextCollapseStoreSnapshot | null | Promise<ContextCollapseStoreSnapshot | null>
  }
  canonical: {
    turnIdRef: { current: string | null }
    setCanonicalTransientActive: Dispatch<SetStateAction<boolean>>
    nextCanonicalTurnSeq: () => number
    clearCanonicalTransientState: () => void
  }
  callbacks: {
    openOverlay: (spec: OverlaySpec) => void
    closeOverlay: () => void
    newSession: () => void | Promise<void>
    handleEvent: (ev: StreamEvent) => void
    onCompactLifecycle?: (event: CompactLifecycleEvent) => void
    onRequestCollapse?: (event: {
      phase: 'initial' | 'reactive_retry'
      collapsedHeadMessageCount: number
      estimatedTokensSaved: number
      metadata: ContextCollapseMeta | null
      commit: RequestCollapseCommitState | null
    }) => void | Promise<void>
    onReactiveCompact?: (event: {
      triggerKind: ReactiveCompactErrorKind
      triggerDetail: string
      strategy: 'session_memory' | 'model_summary'
    }) => void
    onCompactRequested: () => void
    onSlashLocalAsyncRecordForNextTurn: (record: LocalCommandRecord) => void
    onSlashLocalRecordForNextTurn: (record: LocalCommandRecord) => void
    emitCanonicalUiMessageForTurn: (args: { turnId: string; message: CanonicalUiMessage }) => void
    finalizeCanonicalTurn: (args: {
      userMessageId: string | null
      turnId: string
      turnOutcome: 'completed' | 'aborted' | 'failed'
    }) => void
  }
}

export async function runReplModelSendFlow(args: RunReplModelSendFlowArgs): Promise<void> {
  const { sendStateSetters, replModeAccess, sendTurnSharedRefs } = args.sendContext
  const preMainRouting = await resolvePreMainSendRouting({
    text: args.input.text,
    preferredSlashSpecId: args.input.preferredSlashSpecId,
    isLoading: false,
    provider: args.input.provider,
    providerError: args.input.providerError,
    engine: args.deps.engine,
    cfg: args.deps.cfg,
    runtimeFlags: args.deps.runtimeFlags,
    allowedSubagents: args.deps.allowedSubagents,
    tools: args.deps.tools,
    mode: args.deps.mode,
    ...replModeAccess,
    getPlanPath: () => args.deps.planSession?.getPlanPath() ?? null,
    getSessionFilePath: args.turnRefs.getSessionFilePath,
    ...sendTurnSharedRefs,
    commandRegistry: args.deps.commandRegistry,
    openOverlay: args.callbacks.openOverlay,
    closeOverlay: args.callbacks.closeOverlay,
    newSession: args.callbacks.newSession,
    ...sendStateSetters,
    handleEvent: args.callbacks.handleEvent,
    onCompactLifecycle: args.callbacks.onCompactLifecycle,
    onCompactRequested: args.callbacks.onCompactRequested,
    onSlashLocalAsyncRecordForNextTurn: args.callbacks.onSlashLocalAsyncRecordForNextTurn,
    onSlashLocalRecordForNextTurn: args.callbacks.onSlashLocalRecordForNextTurn,
    reminderServiceRef: args.turnRefs.reminderServiceRef,
    pendingExitPlanReminderRef: args.turnRefs.pendingExitPlanReminderRef,
    deferredToolExposureSessionKeyRef: args.turnRefs.deferredToolExposureSessionKeyRef,
  })
  if (preMainRouting.shouldReturn) return
  const slashEffect = preMainRouting.slashEffect

  if (args.input.providerError) {
    applyProviderErrorToState({
      providerError: args.input.providerError,
      setError: sendStateSetters.setError,
      setMessages: sendStateSetters.setMessages,
    })
    return
  }

  const canonicalTurnId = `turn-${args.canonical.nextCanonicalTurnSeq()}`
  args.canonical.turnIdRef.current = canonicalTurnId
  args.canonical.setCanonicalTransientActive(false)
  let turnUserMessageId: string | null = null
  let turnOutcome: 'completed' | 'aborted' | 'failed' = 'completed'

  const mainTurnExecutionContext = createMainTurnExecutionContext({
    engine: args.deps.engine,
    cfg: args.deps.cfg,
    planSession: args.deps.planSession ?? null,
    reminderServiceRef: args.turnRefs.reminderServiceRef,
    tools: args.deps.tools,
    runtimeFlags: args.deps.runtimeFlags,
    allowedSubagents: args.deps.allowedSubagents,
    mode: args.deps.mode,
    replModeAccess,
    handleEvent: args.callbacks.handleEvent,
    sendTurnSharedRefs,
    pendingExitPlanReminderRef: args.turnRefs.pendingExitPlanReminderRef,
    deferredToolExposureSessionKeyRef: args.turnRefs.deferredToolExposureSessionKeyRef,
    sendSeqRef: args.turnRefs.sendSeqRef,
    lastAutoCompactSeqRef: args.turnRefs.autoCompactSeqRef,
    onCompactLifecycle: args.callbacks.onCompactLifecycle,
    onRequestCollapse: args.callbacks.onRequestCollapse,
    onReactiveCompact: args.callbacks.onReactiveCompact,
    getSessionFilePath: args.turnRefs.getSessionFilePath,
    getContextCollapseStoreSnapshot: args.turnRefs.getContextCollapseStoreSnapshot,
  })
  try {
    const runResult = await runMainSendTurn({
      input: { text: args.input.text, slashEffect, provider: args.input.provider },
      deps: mainTurnExecutionContext.deps,
      refs: mainTurnExecutionContext.refs,
      state: {
        ...sendStateSetters,
        emitCanonicalUiMessage: (message) =>
          args.callbacks.emitCanonicalUiMessageForTurn({
            turnId: canonicalTurnId,
            message,
          }),
      },
    })
    turnUserMessageId = runResult.userMessageId
    turnOutcome = runResult.turnOutcome
  } finally {
    args.callbacks.finalizeCanonicalTurn({
      userMessageId: turnUserMessageId,
      turnId: canonicalTurnId,
      turnOutcome,
    })
    args.canonical.turnIdRef.current = null
  }
}
