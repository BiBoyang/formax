import type { ChatEngine } from '../../../../chat/engine'
import type { RuntimeConfig } from '../../../../config/config'
import type { RuntimeFlags } from '../../../../config/runtimeFlags'
import type { StreamEvent } from '../../../../streaming/types'
import type { ReplMode } from '../../mode'
import type { LocalCommandRecord, SlashCommandEffect, SlashCommandRegistry } from '../../../commands/registry'
import type { OverlaySpec } from '../../../commands/contracts'
import { resolveCommandRouting } from '../../../semantics/core/commandRouting'
import type { ReplModeAccess, SendStateSetters, SendTurnSharedRefs } from './sendTypes'
import type { CompactLifecycleEvent } from './compactFlow'
import { maybeBuildContextSlashEffect, maybeHandleClearCommand, maybeHandleCompactCommand, maybeHandleConsumedSlashCommand } from './send'
import { applyProviderErrorToState } from '../shared/providerError'

export async function resolvePreMainSendRouting(args: {
  text: string
  preferredSlashSpecId?: string
  isLoading: boolean
  provider: 'openai' | 'anthropic'
  providerError?: string | null
  engine: ChatEngine
  cfg: RuntimeConfig
  runtimeFlags?: RuntimeFlags
  allowedSubagents: Array<{ name: string; description: string }>
  mode: ReplMode
  getPlanPath: () => string | null
  commandRegistry?: SlashCommandRegistry
  openOverlay: (spec: OverlaySpec) => void
  closeOverlay: () => void
  newSession: () => void | Promise<void>
  handleEvent: (ev: StreamEvent) => void
  onCompactLifecycle?: (ev: CompactLifecycleEvent) => void
  onCompactRequested?: () => void
  onSlashLocalAsyncRecordForNextTurn?: (rec: LocalCommandRecord) => void
  onSlashLocalRecordForNextTurn?: (rec: LocalCommandRecord) => void
} & ReplModeAccess &
  SendTurnSharedRefs &
  SendStateSetters): Promise<{ slashEffect: SlashCommandEffect | null; shouldReturn: boolean }> {
  const commandRouting = resolveCommandRouting(args.text)
  if (
    commandRouting.isExactClear &&
    await maybeHandleClearCommand({
      text: args.text,
      isLoading: args.isLoading,
      setMessages: args.setMessages,
      newSession: args.newSession,
    })
  ) {
    return { slashEffect: null, shouldReturn: true }
  }

  if (commandRouting.isExactCompact) {
    if (args.providerError) {
      applyProviderErrorToState({
        providerError: args.providerError,
        setError: args.setError,
        setMessages: args.setMessages,
      })
      return { slashEffect: null, shouldReturn: true }
    }
    args.onCompactRequested?.()
    await maybeHandleCompactCommand({
      text: args.text,
      provider: args.provider,
      engine: args.engine,
      cfg: args.cfg,
      runtimeFlags: args.runtimeFlags,
      allowedSubagents: args.allowedSubagents,
      mode: args.mode,
      getReplMode: args.getReplMode,
      setReplMode: args.setReplMode,
      getPlanPath: args.getPlanPath,
      historyRef: args.historyRef,
      contextBudgetConfigRef: args.contextBudgetConfigRef,
      abortControllerRef: args.abortControllerRef,
      assistantBufferRef: args.assistantBufferRef,
      thinkingBufferRef: args.thinkingBufferRef,
      thinkingLastFlushAtRef: args.thinkingLastFlushAtRef,
      currentAssistantIdRef: args.currentAssistantIdRef,
      setMessages: args.setMessages,
      setIsLoading: args.setIsLoading,
      setLoadingText: args.setLoadingText,
      setThinkingText: args.setThinkingText,
      setError: args.setError,
      setContext: args.setContext,
      handleEvent: args.handleEvent,
      onCompactLifecycle: args.onCompactLifecycle,
    })
    return { slashEffect: null, shouldReturn: true }
  }

  const contextSlashEffect = maybeBuildContextSlashEffect({
      text: args.text,
      provider: args.provider,
      cfg: args.cfg,
      runtimeFlags: args.runtimeFlags,
      allowedSubagents: args.allowedSubagents,
      mode: args.mode,
      historyRef: args.historyRef,
    })
  if (contextSlashEffect) {
    return await maybeHandleConsumedSlashCommand({
      text: args.text,
      slashEffect: contextSlashEffect,
      preferredSlashSpecId: args.preferredSlashSpecId,
      commandRegistry: args.commandRegistry,
      openOverlay: args.openOverlay,
      closeOverlay: args.closeOverlay,
      pendingInjectedBlocksRef: args.pendingInjectedBlocksRef,
      onLocalCommandRecordForNextTurn: args.onSlashLocalAsyncRecordForNextTurn,
      thinkingBufferRef: args.thinkingBufferRef,
      thinkingLastFlushAtRef: args.thinkingLastFlushAtRef,
      currentAssistantIdRef: args.currentAssistantIdRef,
      setMessages: args.setMessages,
      setIsLoading: args.setIsLoading,
      setLoadingText: args.setLoadingText,
      setThinkingText: args.setThinkingText,
      setError: args.setError,
    })
  }

  let slashEffect: SlashCommandEffect | null = null
  if (commandRouting.isSlashCommand) {
    const res = await maybeHandleConsumedSlashCommand({
      text: args.text,
      preferredSlashSpecId: args.preferredSlashSpecId,
      commandRegistry: args.commandRegistry,
      openOverlay: args.openOverlay,
      closeOverlay: args.closeOverlay,
      pendingInjectedBlocksRef: args.pendingInjectedBlocksRef,
      onLocalCommandRecordForNextTurn: args.onSlashLocalAsyncRecordForNextTurn,
      thinkingBufferRef: args.thinkingBufferRef,
      thinkingLastFlushAtRef: args.thinkingLastFlushAtRef,
      currentAssistantIdRef: args.currentAssistantIdRef,
      setMessages: args.setMessages,
      setIsLoading: args.setIsLoading,
      setLoadingText: args.setLoadingText,
      setThinkingText: args.setThinkingText,
      setError: args.setError,
    })
    slashEffect = res.slashEffect
    if (slashEffect?.kind === 'local' && slashEffect.recordForNextTurn) {
      args.onSlashLocalRecordForNextTurn?.(slashEffect.recordForNextTurn)
    }
    if (res.shouldReturn) return { slashEffect, shouldReturn: true }
  }

  return { slashEffect, shouldReturn: false }
}
