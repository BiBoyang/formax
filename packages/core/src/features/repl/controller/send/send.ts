import type { Dispatch, SetStateAction } from 'react'
import type { ChatEngine, ChatHistory } from '../../../../chat/engine'
import type { ContextBudgetConfig } from '../../../../chat/context/budget'
import {
  buildContextDiagnosticsJson,
  buildContextDiagnosticsReport,
  resolveContextDiagnosticsOutputFormat,
} from '../../../../chat/context/contextDiagnostics'
import { getKnownContextWindowTokens } from '../../../../chat/context/modelWindow'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { PromptBlock } from '../../../../prompts'
import { buildSystemPrompt } from '../../../../prompts'
import { buildOutputStyleInjectedBlocks } from '../../../../prompts/reminders/outputStyle'
import type { RuntimeFlags } from '../../../../config/runtimeFlags'
import { resolveSystemPromptVariant } from '../../../../prompts/system'
import type { StreamEvent } from '../../../../streaming/types'
import type { RuntimeConfig } from '../../../../config/config'
import { resolveDeferredToolExposureForTurn } from '../../../../tools/runtime/deferredToolExposureResolver'
import { applyToolFilters, resolveToolFilters } from '../../../../tools/runtime/toolFilter'
import type { ToolDefinition } from '../../../../tools/types'
import type { ReplMode } from '../../mode'
import { ReminderService } from '../../reminders/ReminderService'
import { buildTurnInput } from '../../../semantics/adapters/turnInputBuilder'
import { slashEffectToCommandResult, isSlashCommandResultData } from '../../../commands/adapter'
import type { LocalCommandRecord, SlashCommandEffect, SlashCommandRegistry } from '../../../commands/registry'
import { isConsumedCommandResult, type OverlaySpec } from '../../../commands/contracts'
import { isAbortLikeError, isExactSlashCommand } from '../shared/utils'
import { buildLocalCommandInjectedBlocks } from '../../injectedBlocks'
import { makeMessageId } from '../shared/ids'
import type { CompactLifecycleEvent } from './compactFlow'
import { createContextCompressionService } from './contextCompressionService'
import { formatErrorSubline } from '../shared/errorSubline'
import { readLatestRequestCollapseEventFromSessionSync } from '../../sessionSave/requestCollapseEvents'
import { readLatestReactiveCompactEventFromSessionSync } from '../../sessionSave/reactiveCompactEvents'
import { readContextCollapseStoreSnapshotFromSessionSync } from '../../sessionRestore/contextCollapseStore'

const COMPACT_BANNER_TEXT = 'Conversation compacted · ctrl+o for history'
const COMPACT_SUBLINE_TEXT = 'Compacted (ctrl+o to see full summary)'
const MANUAL_COMPACT_KEEP_LAST_TURNS = 0

export async function maybeHandleClearCommand(args: {
  text: string
  isLoading: boolean
  setMessages: Dispatch<SetStateAction<Msg[]>>
  newSession: () => void | Promise<void>
}): Promise<boolean> {
  if (args.isLoading) return false
  if (!isExactSlashCommand(args.text, '/clear')) return false

  const extraArgs = args.text.replace(/^\/clear\b/i, '').trim()
  if (extraArgs) {
    args.setMessages((prev) => [
      ...prev,
      {
        id: makeMessageId('assistant'),
        role: 'assistant',
        content: 'Usage: /clear',
        timestamp: new Date(),
      },
    ])
    return true
  }

  await args.newSession()
  return true
}

export async function maybeHandleCompactCommand(args: {
  text: string
  provider: 'openai' | 'anthropic'
  engine: ChatEngine
  cfg: RuntimeConfig
  runtimeFlags?: RuntimeFlags
  allowedSubagents: Array<{ name: string; description: string }>
  mode: ReplMode
  getReplMode: () => ReplMode
  setReplMode: (next: ReplMode) => void
  getPlanPath: () => string | null
  getSessionFilePath?: () => string | null
  historyRef: { current: ChatHistory }
  contextBudgetConfigRef: { current: ContextBudgetConfig | null }
  abortControllerRef: { current: AbortController | null }
  assistantBufferRef: { current: string }
  thinkingBufferRef: { current: string }
  thinkingLastFlushAtRef: { current: number }
  currentAssistantIdRef: { current: string | null }
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  setLoadingText: Dispatch<SetStateAction<string>>
  setThinkingText: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
  setContext: Dispatch<
    SetStateAction<
      | {
          usedTokens: number
          limitTokens: number
          percentRemaining: number
          source: 'estimate'
        }
      | null
    >
  >
  handleEvent: (ev: StreamEvent) => void
  onCompactLifecycle?: (ev: CompactLifecycleEvent) => void
}): Promise<boolean> {
  if (!isExactSlashCommand(args.text, '/compact')) return false

  const pendingCompactCommandMessageId = makeMessageId('user')
  args.setMessages((prev) => [
    ...prev,
    {
      id: pendingCompactCommandMessageId,
      role: 'user',
      content: args.text,
      timestamp: new Date(),
    },
  ])

  args.setIsLoading(true)
  args.setLoadingText('Compacting conversation')
  args.thinkingBufferRef.current = ''
  args.thinkingLastFlushAtRef.current = 0
  args.setThinkingText('')
  args.setError(null)
  args.currentAssistantIdRef.current = null

  const abortController = new AbortController()
  args.abortControllerRef.current = abortController
  args.assistantBufferRef.current = ''
  args.contextBudgetConfigRef.current = null

  try {
    const cwd = process.cwd()
    const previousHistory = args.historyRef.current

    const system = buildSystemPrompt({
      allowedSubagents: args.allowedSubagents,
      cwd,
      model: args.cfg.llm.model,
      variant: resolveSystemPromptVariant({
        deferredToolExposureEnabled: args.runtimeFlags?.deferredToolExposureEnabled,
      }),
    })

    const contextWindowTokens =
      args.cfg.llm.contextWindowTokens ??
      getKnownContextWindowTokens({ provider: args.provider, model: args.cfg.llm.model })

    args.contextBudgetConfigRef.current = contextWindowTokens
      ? {
          contextWindowTokens,
          effectiveContextWindowPercent: args.cfg.context.effectiveContextWindowPercent,
          autoCompactLimitPercent: args.cfg.context.autoCompactTokenLimitPercent,
          baselineTokens: args.cfg.context.baselineTokens,
        }
      : null

    const instructions = args.text.replace(/^\/compact\b/i, '').trim()
    const compression = createContextCompressionService({
      mode: args.mode,
      getReplMode: args.getReplMode,
      setReplMode: args.setReplMode,
      getPlanPath: args.getPlanPath,
      cfg: args.cfg,
      engine: args.engine,
      cwd,
      signal: abortController.signal,
      promptBudget: args.contextBudgetConfigRef.current,
      model: args.cfg.llm.model,
      thinkingEnabled: args.cfg.llm.thinkingMode,
      handleEvent: args.handleEvent,
      onCompactLifecycle: args.onCompactLifecycle,
      getSessionFilePath: args.getSessionFilePath,
    })
    const compactResult = await compression.runManualCompact({
      contextWindowTokens,
      previousHistory,
      keepLastTurns: MANUAL_COMPACT_KEEP_LAST_TURNS,
      instructions,
      system,
    })

    args.historyRef.current = compactResult.compactedHistory

    args.setMessages((prev) => {
      const withoutPendingCompactCommand = prev.filter((msg) => msg.id !== pendingCompactCommandMessageId)
      return [
        ...withoutPendingCompactCommand,
        {
          id: makeMessageId('assistant'),
          role: 'assistant',
          ui: { kind: 'compact_boundary' },
          content: '',
          timestamp: new Date(),
        },
        {
          id: makeMessageId('assistant'),
          role: 'assistant',
          ui: { kind: 'compact_banner' },
          content: COMPACT_BANNER_TEXT,
          timestamp: new Date(),
        },
        {
          id: makeMessageId('user'),
          role: 'user',
          ui: { kind: 'compact_summary' },
          content: compactResult.summary,
          timestamp: new Date(),
        },
        {
          id: makeMessageId('user'),
          role: 'user',
          content: args.text,
          timestamp: new Date(),
        },
        {
          id: makeMessageId('assistant'),
          role: 'assistant',
          ui: { kind: 'command_subline' },
          content: COMPACT_SUBLINE_TEXT,
          timestamp: new Date(),
        },
      ]
    })

    args.setContext(compactResult.context)
  } catch (e) {
    if (isAbortLikeError(e)) {
      return true
    }
    const msg = e instanceof Error ? e.message : 'Compact failed'
    args.setError(msg)
    args.setMessages((prev) => [
      ...prev,
      {
        id: `error-${Date.now()}`,
        role: 'assistant',
        ui: { kind: 'command_subline' as const },
        content: formatErrorSubline(msg),
        timestamp: new Date(),
      },
    ])
  } finally {
    args.setIsLoading(false)
    args.abortControllerRef.current = null
  }

  return true
}

export function maybeBuildContextSlashEffect(args: {
  text: string
  provider: 'openai' | 'anthropic'
  cfg: RuntimeConfig
  runtimeFlags?: RuntimeFlags
  allowedSubagents: Array<{ name: string; description: string }>
  tools: ToolDefinition[]
  mode: ReplMode
  getPlanPath: () => string | null
  historyRef: { current: ChatHistory }
  getSessionFilePath?: () => string | null
  pendingInjectedBlocksRef: { current: PromptBlock[] }
  reminderServiceRef?: { current: ReminderService | null }
  includeExitPlanReminder?: boolean
  deferredToolExposureSessionKey?: string
}): SlashCommandEffect | null {
  if (!isExactSlashCommand(args.text, '/context')) return null

  const outputFormat = resolveContextDiagnosticsOutputFormat(args.text.trimStart().replace(/^\/context\b/i, '').trim())
  if (!outputFormat) {
    return { kind: 'local', stdout: 'Usage: /context [--json]' }
  }

  const cwd = process.cwd()
  const { allowTools, disallowedTools } = resolveToolFilters({
    env: process.env,
    interactive: true,
  })
  const tools = applyToolFilters({
    tools: args.tools,
    allowTools,
    disallowedTools,
  })
  const deferredToolExposureEnabled = args.runtimeFlags?.deferredToolExposureEnabled === true
  const reminderService = args.reminderServiceRef?.current ?? new ReminderService()
  const toolExposure = resolveDeferredToolExposureForTurn({
    cwd,
    tools,
    deferredToolExposureEnabled,
    toolSearchEnabled: !disallowedTools?.includes('ToolSearch'),
    explicitSessionKey: args.deferredToolExposureSessionKey,
    toolSearchEngine: args.runtimeFlags?.toolSearchEngine,
  })
  const turnInput = buildTurnInput({
    rawText: '',
    mode: args.mode,
    planPath: args.getPlanPath(),
    includeExitPlanReminder: args.includeExitPlanReminder,
  })
  const reminderBlocks = reminderService.peekInjectedBlocks({
    cwd,
    includeAutoMemory: deferredToolExposureEnabled,
  })
  const outputStyleBlocks = buildOutputStyleInjectedBlocks(args.cfg.ui.outputStyle)
  const pendingInjectedBlocks = [...args.pendingInjectedBlocksRef.current]
  const sessionFilePath = args.getSessionFilePath?.() ?? null
  const latestRequestCollapse = sessionFilePath
    ? readLatestRequestCollapseEventFromSessionSync({ filePath: sessionFilePath })
    : null
  const latestReactiveCompact = sessionFilePath
    ? readLatestReactiveCompactEventFromSessionSync({ filePath: sessionFilePath })
    : null
  const contextCollapseStoreSnapshot = sessionFilePath
    ? readContextCollapseStoreSnapshotFromSessionSync({ filePath: sessionFilePath })
    : null

  return {
    kind: 'local',
    stdout:
      outputFormat === 'json'
        ? buildContextDiagnosticsJson({
            cwd,
            cfg: args.cfg,
            runtimeFlags: args.runtimeFlags,
            allowedSubagents: args.allowedSubagents,
            mode: args.mode,
            planPath: args.getPlanPath(),
            messages: args.historyRef.current,
            latestRequestCollapse,
            latestReactiveCompact,
            durableState: contextCollapseStoreSnapshot ? { collapse: contextCollapseStoreSnapshot } : undefined,
            nextTurnFixedGroups: [
              { label: 'Deferred tool exposure', blocks: toolExposure.injectedPromptBlocks },
              { label: 'Reminder blocks', blocks: reminderBlocks },
              { label: 'Output-style blocks', blocks: outputStyleBlocks },
              { label: 'Mode semantic blocks', blocks: turnInput.semanticBlocks },
              { label: 'Pending injected blocks', blocks: pendingInjectedBlocks },
            ],
          })
        : buildContextDiagnosticsReport({
            cwd,
            cfg: args.cfg,
            runtimeFlags: args.runtimeFlags,
            allowedSubagents: args.allowedSubagents,
            mode: args.mode,
            planPath: args.getPlanPath(),
            messages: args.historyRef.current,
            latestRequestCollapse,
            latestReactiveCompact,
            durableState: contextCollapseStoreSnapshot ? { collapse: contextCollapseStoreSnapshot } : undefined,
            nextTurnFixedGroups: [
              { label: 'Deferred tool exposure', blocks: toolExposure.injectedPromptBlocks },
              { label: 'Reminder blocks', blocks: reminderBlocks },
              { label: 'Output-style blocks', blocks: outputStyleBlocks },
              { label: 'Mode semantic blocks', blocks: turnInput.semanticBlocks },
              { label: 'Pending injected blocks', blocks: pendingInjectedBlocks },
            ],
          }),
  }
}

export async function maybeHandleConsumedSlashCommand(args: {
  text: string
  preferredSlashSpecId?: string
  slashEffect?: SlashCommandEffect | null
  commandRegistry?: SlashCommandRegistry
  openOverlay: (spec: OverlaySpec) => void
  closeOverlay: () => void
  pendingInjectedBlocksRef: { current: PromptBlock[] }
  onLocalCommandRecordForNextTurn?: (rec: LocalCommandRecord) => void
  thinkingBufferRef: { current: string }
  thinkingLastFlushAtRef: { current: number }
  currentAssistantIdRef: { current: string | null }
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  setLoadingText: Dispatch<SetStateAction<string>>
  setThinkingText: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
}): Promise<{ slashEffect: SlashCommandEffect | null; shouldReturn: boolean }> {
  const slashEffect =
    args.slashEffect ??
    (args.text.startsWith('/')
      ? args.commandRegistry?.dispatch(args.text, { preferredSpecId: args.preferredSlashSpecId }) ?? null
      : null)
  const slashResult = slashEffectToCommandResult(slashEffect)
  if (!isConsumedCommandResult(slashResult)) return { slashEffect, shouldReturn: false }

  const userMsg: Msg = {
    id: makeMessageId('user'),
    role: 'user',
    content: args.text,
    timestamp: new Date(),
  }

  const appended: Msg[] = []
  for (const eff of slashResult.ui ?? []) {
    if (eff.type === 'appendMessages') {
      for (const m of eff.messages) {
        appended.push({
          id: m.id ?? makeMessageId('assistant'),
          role: 'assistant',
          content: m.content,
          ui: m.ui,
          timestamp: m.timestamp ?? new Date(),
        })
      }
    } else if (eff.type === 'openOverlay') {
      args.openOverlay(eff.overlay)
    } else if (eff.type === 'closeOverlay') {
      args.closeOverlay()
    } else if (eff.type === 'toast') {
      appended.push({
        id: makeMessageId('assistant'),
        role: 'assistant',
        content: eff.message,
        timestamp: new Date(),
      })
    }
  }

  for (const eff of slashResult.model ?? []) {
    if (eff.type === 'injectNextTurn') args.pendingInjectedBlocksRef.current.push(...eff.blocks)
  }

  const data = isSlashCommandResultData(slashResult.data) ? slashResult.data : null
  const shouldAppendUserCommandRow =
    data?.kind !== 'llm' &&
    (appended.length > 0 || (slashResult.model?.length ?? 0) > 0 || slashEffect?.kind !== 'open_resume_dialog')
  if (shouldAppendUserCommandRow) {
    args.setMessages((prev) => [...prev, userMsg, ...appended])
  }

  if (data?.kind === 'local_async') {
    await runLocalAsyncSlashCommand({
      loadingText: data.loadingText,
      run: data.run,
      pendingInjectedBlocksRef: args.pendingInjectedBlocksRef,
      onLocalCommandRecordForNextTurn: args.onLocalCommandRecordForNextTurn,
      thinkingBufferRef: args.thinkingBufferRef,
      thinkingLastFlushAtRef: args.thinkingLastFlushAtRef,
      currentAssistantIdRef: args.currentAssistantIdRef,
      setMessages: args.setMessages,
      setIsLoading: args.setIsLoading,
      setLoadingText: args.setLoadingText,
      setThinkingText: args.setThinkingText,
      setError: args.setError,
    })

    return { slashEffect, shouldReturn: true }
  }

  if (data?.kind === 'llm') {
    return { slashEffect, shouldReturn: false }
  }

  return { slashEffect, shouldReturn: true }
}

async function runLocalAsyncSlashCommand(args: {
  loadingText?: string
  run: () => Promise<{ stdout: string; recordForNextTurn?: LocalCommandRecord }>
  pendingInjectedBlocksRef: { current: PromptBlock[] }
  onLocalCommandRecordForNextTurn?: (rec: LocalCommandRecord) => void
  thinkingBufferRef: { current: string }
  thinkingLastFlushAtRef: { current: number }
  currentAssistantIdRef: { current: string | null }
  setMessages: Dispatch<SetStateAction<Msg[]>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  setLoadingText: Dispatch<SetStateAction<string>>
  setThinkingText: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
}): Promise<void> {
  args.setIsLoading(true)
  args.setLoadingText(args.loadingText || 'Working')
  args.thinkingBufferRef.current = ''
  args.thinkingLastFlushAtRef.current = 0
  args.setThinkingText('')
  args.setError(null)
  args.currentAssistantIdRef.current = null

  try {
    const out = await args.run()
    if (out.recordForNextTurn) {
      args.pendingInjectedBlocksRef.current.push(...buildLocalCommandInjectedBlocks(out.recordForNextTurn))
      args.onLocalCommandRecordForNextTurn?.(out.recordForNextTurn)
    }
    const lines = String(out.stdout ?? '').split('\n')
    const now = Date.now()
    const timestamp = new Date()
    args.setMessages((prev) => [
      ...prev,
      ...lines.map((content, idx) => ({
        id: `assistant-${now}-${idx}`,
        role: 'assistant' as const,
        ui: { kind: 'command_subline' as const },
        content,
        timestamp,
      })),
    ])
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Command failed'
    const now = Date.now()
    args.setMessages((prev) => [
      ...prev,
      {
        id: `error-${now}`,
        role: 'assistant',
        ui: { kind: 'command_subline' as const },
        content: `Error: ${msg}`,
        timestamp: new Date(),
      },
    ])
  } finally {
    args.setIsLoading(false)
  }
}
