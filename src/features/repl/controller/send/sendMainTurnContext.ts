import type { ChatEngine } from '../../../../chat/engine'
import type { RuntimeConfig } from '../../../../config/config'
import type { RuntimeFlags } from '../../../../config/runtimeFlags'
import type { SystemPromptProfile } from '../../../../prompts/system'
import type { StreamEvent } from '../../../../streaming/types'
import type { ToolDefinition } from '../../../../tools/types'
import type { ReplMode } from '../../mode'
import type { PlanSessionManager } from '../../planSession'
import type { ReminderService } from '../../reminders/ReminderService'
import type { CompactLifecycleEvent } from './compactFlow'
import type { ReplModeAccess, SendTurnSharedRefs } from './sendTypes'

type MainTurnContextArgs = {
  engine: ChatEngine
  cfg: RuntimeConfig
  promptProfile?: SystemPromptProfile
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
}

export function createMainTurnExecutionContext(args: MainTurnContextArgs): {
  deps: {
    engine: ChatEngine
    cfg: RuntimeConfig
    promptProfile?: SystemPromptProfile
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
  }
} {
  return {
    deps: {
      engine: args.engine,
      cfg: args.cfg,
      promptProfile: args.promptProfile,
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
    },
  }
}
