import type { ChatEngine } from '../../../../chat/engine'
import type { ContextCollapseStoreSnapshot } from '../../../../chat/context/contextCollapseStore'
import type { RuntimeConfig } from '../../../../config/config'
import type { RuntimeFlags } from '../../../../config/runtimeFlags'
import type { StreamEvent } from '../../../../streaming/types'
import type { ToolDefinition } from '../../../../tools/types'
import type { ReplMode } from '../../mode'
import type { PlanSessionManager } from '../../planSession'
import type { ReminderService } from '../../reminders/ReminderService'
import type { CompactLifecycleEvent } from './compactFlow'
import type { ContextCollapseMeta } from '../../../../chat/context/contextCollapse'
import type { RequestCollapseCommitState, RequestSnipState } from './contextCompressionService'
import type { ReactiveCompactErrorKind } from './reactiveCompact'
import type { ReplModeAccess, SendTurnSharedRefs } from './sendTypes'

type MainTurnContextArgs = {
  engine: ChatEngine
  cfg: RuntimeConfig
  planSession?: PlanSessionManager | null
  reminderServiceRef: { current: ReminderService | null }
  tools: ToolDefinition[]
  runtimeFlags?: RuntimeFlags
  allowedSubagents: Array<{ name: string; description: string }>
  mode: ReplMode
  replModeAccess: ReplModeAccess
  handleEvent: (ev: StreamEvent) => void
  sendTurnSharedRefs: SendTurnSharedRefs
  pendingExitPlanReminderRef: { current: boolean }
  deferredToolExposureSessionKeyRef?: { current: string }
  sendSeqRef: { current: number }
  lastAutoCompactSeqRef: { current: number }
  onCompactLifecycle: ((ev: CompactLifecycleEvent) => void) | undefined
  onRequestCollapse?: ((event: {
    phase: 'initial' | 'reactive_retry'
    collapsedHeadMessageCount: number
    estimatedTokensSaved: number
    metadata: ContextCollapseMeta | null
    commit: RequestCollapseCommitState | null
  }) => void | Promise<void>) | undefined
  onRequestSnip?: ((event: {
    phase: 'initial' | 'reactive_retry'
    state: RequestSnipState | null
  }) => void | Promise<void>) | undefined
  onReactiveCompact?: ((event: {
    triggerKind: ReactiveCompactErrorKind
    triggerDetail: string
    strategy: 'session_memory' | 'model_summary'
  }) => void) | undefined
  getSessionFilePath?: () => string | null
  getContextCollapseStoreSnapshot?: () => ContextCollapseStoreSnapshot | null | Promise<ContextCollapseStoreSnapshot | null>
}

export function createMainTurnExecutionContext(args: MainTurnContextArgs): {
  deps: {
    engine: ChatEngine
    cfg: RuntimeConfig
    planSession?: PlanSessionManager | null
    reminderServiceRef: { current: ReminderService | null }
    tools: ToolDefinition[]
    runtimeFlags?: RuntimeFlags
    allowedSubagents: Array<{ name: string; description: string }>
    mode: ReplMode
    getReplMode: () => ReplMode
    setReplMode: (next: ReplMode) => void
    handleEvent: (ev: StreamEvent) => void
  }
  refs: SendTurnSharedRefs & {
    pendingExitPlanReminderRef: { current: boolean }
    deferredToolExposureSessionKeyRef?: { current: string }
    sendSeqRef: { current: number }
    lastAutoCompactSeqRef: { current: number }
    onCompactLifecycle?: (ev: CompactLifecycleEvent) => void
    onRequestCollapse?: (event: {
      phase: 'initial' | 'reactive_retry'
      collapsedHeadMessageCount: number
      estimatedTokensSaved: number
      metadata: ContextCollapseMeta | null
      commit: RequestCollapseCommitState | null
    }) => void | Promise<void>
    onRequestSnip?: (event: {
      phase: 'initial' | 'reactive_retry'
      state: RequestSnipState | null
    }) => void | Promise<void>
    onReactiveCompact?: (event: {
      triggerKind: ReactiveCompactErrorKind
      triggerDetail: string
      strategy: 'session_memory' | 'model_summary'
    }) => void
    getSessionFilePath?: () => string | null
    getContextCollapseStoreSnapshot?: () => ContextCollapseStoreSnapshot | null | Promise<ContextCollapseStoreSnapshot | null>
  }
} {
  return {
    deps: {
      engine: args.engine,
      cfg: args.cfg,
      planSession: args.planSession ?? null,
      reminderServiceRef: args.reminderServiceRef,
      tools: args.tools,
      runtimeFlags: args.runtimeFlags,
      allowedSubagents: args.allowedSubagents,
      mode: args.mode,
      ...args.replModeAccess,
      handleEvent: args.handleEvent,
    },
    refs: {
      ...args.sendTurnSharedRefs,
      pendingExitPlanReminderRef: args.pendingExitPlanReminderRef,
      deferredToolExposureSessionKeyRef: args.deferredToolExposureSessionKeyRef,
      sendSeqRef: args.sendSeqRef,
      lastAutoCompactSeqRef: args.lastAutoCompactSeqRef,
      onCompactLifecycle: args.onCompactLifecycle,
      onRequestCollapse: args.onRequestCollapse,
      onRequestSnip: args.onRequestSnip,
      onReactiveCompact: args.onReactiveCompact,
      getSessionFilePath: args.getSessionFilePath,
      getContextCollapseStoreSnapshot: args.getContextCollapseStoreSnapshot,
    },
  }
}
