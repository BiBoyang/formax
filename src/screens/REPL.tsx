import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import path from 'node:path'
import { Box, Text } from 'ink'
import type { ChatEngine, ChatHistory } from '../chat/engine'
import { loadRuntimeConfig, type RuntimeConfig } from '../env/config'
import type { ToolDefinition } from '../tools/types'
import type { ToolRegistry } from '../tools/registry'
import { useReplController } from '../features/repl/useReplController'
import { ToolRouter } from '../components/tool/ToolRouter'
import type { Msg } from '../components/tool/ToolMessage'
import pkg from '../../package.json'
import { InputBar } from '../components/chat/InputBar'
import { ReplFooterHint } from '../components/chat/ReplFooterHint'
import type { TaskManager } from '../tools/runtime/taskManager'
import { ReplUiProvider } from '../features/repl/replUiContext'
import { LoadingStatusLine } from '../components/ui/LoadingStatusLine'
import { ThinkingStatusLine } from '../components/ui/ThinkingStatusLine'
import { PulsingDot } from '../components/ui/PulsingDot'
import type { ReplMode } from '../features/repl/mode'
import { useUserInputManager } from '../tools/runtime/userInputContext'
import { createPlanSessionManager } from '../features/repl/planSession'
import { PlanProvider } from '../features/repl/planContext'
import { getTheme } from '../utils/theme'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore'
import { detectWorkspaceRoots } from '../adapters/fs/workspaceRoots'
import { AgentsDialog } from '../ui/agents/AgentsDialog'
import { PermissionsDialog } from '../ui/permissions/PermissionsDialog'
import { HooksDialog } from '../ui/hooks/HooksDialog'
import { ConfigDialog, type ConfigDialogExit } from '../ui/config/ConfigDialog'
import { ModelDialog } from '../ui/model/ModelDialog'
import { ResumeDialog } from '../ui/resume/ResumeDialog'
import { getConfigPaths } from '../adapters/fs/configPaths'
import type { TokenUsage } from '../streaming/types'
import { findLastContiguousExploreTaskGroup } from './repl/messageItems'
import { createReplCommandRegistry } from './repl/createReplCommandRegistry'
import { formatTokens } from './repl/format'
import { DetailedTranscriptPanel, ExploreAgentsPanel, formatTaskPanelTitle } from './repl/panels'
import { useReplHotkeys } from './repl/hotkeys'
import { isPromptMode as computePromptMode } from './repl/promptMode'
import { ExpandedReplTranscript, ReplTranscript } from './repl/transcript'
import { renderThinkingBlock, shouldRenderThinkingBlock } from './repl/thinkingBlock'
import { useSurfaceTransitionManager } from './repl/useSurfaceTransitionManager'
import { createSlashCommandSpecMap, resolveSlashCommandInputHint } from './repl/inputHint'
import { projectCompactPrimaryTranscript } from './repl/compactProjection'
import { createRuntimeFlags } from '../env/runtimeFlags'
import { partitionMessages } from '../features/repl/controller/ui/ui'
import { isErrorLikeSubline, shouldSuppressGlobalError } from '../features/repl/controller/shared/shared'
import { parseModelTier, resolveModelForTier, type ModelTier } from '../env/modelTier'
import { updateConfigPatchFile } from '../core/config/persist'

type Props = {
  onExit?: () => void
  onClearTerminal?: () => void | Promise<void>
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  initialSession?: { filePath: string; messages: Msg[]; history: ChatHistory } | null
  allowedSubagents?: Array<{ name: string; description: string }>
  reloadSubagents?: () => Promise<Array<{ name: string; description: string }>>
  toolRegistry?: ToolRegistry
  taskManager?: TaskManager
}

function usePromptLine(args: {
  commandRegistry: ReturnType<typeof createReplCommandRegistry>
  isPromptMode: boolean
}) {
  const { commandRegistry, isPromptMode } = args
  const [input, setInput] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashSelectionTouched, setSlashSelectionTouched] = useState(false)

  const slashSuggestions = useMemo(() => {
    if (isPromptMode) return []
    return commandRegistry.suggest(input).slice(0, 10)
  }, [commandRegistry, input, isPromptMode])

  const selectedSlash = slashSuggestions[slashIndex] ?? null

  const handleInputChange = useCallback((v: string) => {
    setInput(v)
    setSlashIndex(0)
    setSlashSelectionTouched(false)
  }, [])

  const clearPrompt = useCallback(() => {
    setInput('')
    setSlashIndex(0)
    setSlashSelectionTouched(false)
  }, [])

  return {
    input,
    setInput,
    slashIndex,
    setSlashIndex,
    slashSelectionTouched,
    setSlashSelectionTouched,
    slashSuggestions,
    selectedSlash,
    handleInputChange,
    clearPrompt,
  }
}

export function REPL({
  onExit,
  onClearTerminal,
  engine,
  tools,
  cfg,
  initialSession,
  allowedSubagents,
  reloadSubagents,
  toolRegistry,
  taskManager,
}: Props): React.ReactNode {
  const theme = useMemo(() => getTheme(), [])
  const [runtimeCfg, setRuntimeCfg] = useState(cfg)
  const [mode, setMode] = useState<ReplMode>('normal')
  const [promptProfile, setPromptProfile] = useState(cfg.ui.promptProfile)
  const [workspaceRoots, setWorkspaceRoots] = useState<string[]>([process.cwd()])
  const [workspaceRootWarnings, setWorkspaceRootWarnings] = useState<string[]>([])
  const [loadingStartedAtMs, setLoadingStartedAtMs] = useState<number | null>(null)
  const [expandedTranscriptOpen, setExpandedTranscriptOpen] = useState(false)
  const [expandedTranscriptHideHistory, setExpandedTranscriptHideHistory] = useState(false)
  const [ctrlCArmedUntilMs, setCtrlCArmedUntilMs] = useState<number | null>(null)
  const [bashModeActive, setBashModeActive] = useState(false)
  const [queuedDuringLoading, setQueuedDuringLoading] = useState<string[]>([])
  const queuedDuringLoadingRef = useRef<string[]>([])
  const wasLoadingRef = useRef(false)
  const isAutoFlushingQueueRef = useRef(false)
  const userInput = useUserInputManager()
  const runtimeFlags = useMemo(() => createRuntimeFlags(process.env), [])
  const planSession = useMemo(
    () => createPlanSessionManager({ planDir: runtimeCfg.paths.planDir }),
    [runtimeCfg.paths.planDir],
  )
  const ensurePlanPath = useCallback(
    () => planSession.getPlanPath() ?? planSession.startNewPlan(),
    [planSession],
  )
  const userAgentsDir = useMemo(() => {
    const configPaths = getConfigPaths({ cwd: process.cwd(), env: process.env })
    const globalConfigDir = path.resolve(process.cwd(), configPaths.globalConfigDir)
    return path.join(globalConfigDir, 'agents')
  }, [])

  const modelByTier = useMemo(
    () => ({
      haiku: resolveModelForTier({
        tier: 'haiku',
        env: process.env,
        configuredModel: runtimeCfg.llm.configuredModel,
        configuredTierModels: runtimeCfg.llm.tierModels,
      }),
      sonnet: resolveModelForTier({
        tier: 'sonnet',
        env: process.env,
        configuredModel: runtimeCfg.llm.configuredModel,
        configuredTierModels: runtimeCfg.llm.tierModels,
      }),
      opus: resolveModelForTier({
        tier: 'opus',
        env: process.env,
        configuredModel: runtimeCfg.llm.configuredModel,
        configuredTierModels: runtimeCfg.llm.tierModels,
      }),
    }),
    [runtimeCfg.llm.configuredModel, runtimeCfg.llm.tierModels],
  )

  const reloadCfg = useCallback(async (opts?: { syncPromptProfile?: boolean }) => {
    const next = await loadRuntimeConfig(process.env, process.cwd())
    setRuntimeCfg(next)
    if (opts?.syncPromptProfile) setPromptProfile(next.ui.promptProfile)
    return next
  }, [])

  const applyDefaultModelTier = useCallback(
    async (nextTier: ModelTier) => {
      const store = createNodeFileStore()
      const paths = getConfigPaths({ cwd: process.cwd(), env: process.env })
      await updateConfigPatchFile({
        fileStore: store,
        filePath: paths.globalConfigPath,
        nextPatch: { llm: { defaultTier: nextTier } },
        label: 'llm.defaultTier',
      })
      const nextCfg = await reloadCfg()
      return {
        effectiveTier: parseModelTier(nextCfg.llm.defaultTier) ?? 'sonnet',
      }
    },
    [reloadCfg],
  )

  const setDefaultModelTier = useCallback(
    async (nextTier: ModelTier) => {
      const out = await applyDefaultModelTier(nextTier)
      return out.effectiveTier
    },
    [applyDefaultModelTier],
  )

  useEffect(() => {
    let cancelled = false
    const store = createNodeFileStore()
    detectWorkspaceRoots({ fileStore: store, cwd: process.cwd() }).then((res) => {
      if (cancelled) return
      setWorkspaceRoots(res.workspaceRoots)
      setWorkspaceRootWarnings(res.warnings)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const commandRegistry = useMemo(
    () =>
      createReplCommandRegistry({
        cfg: runtimeCfg,
        taskManager,
        planSession,
        promptProfile,
        setPromptProfile,
        setDefaultModelTier,
        workspaceRoots,
        workspaceRootWarnings,
      }),
    [
      runtimeCfg.llm.apiKey,
      runtimeCfg.llm.baseUrl,
      runtimeCfg.llm.model,
      runtimeCfg.llm.defaultTier,
      runtimeCfg.llm.provider,
      runtimeCfg.llm.timeoutMs,
      runtimeCfg.paths,
      runtimeCfg.ui.assistantTextMode,
      planSession,
      promptProfile,
      workspaceRoots,
      workspaceRootWarnings,
      taskManager,
      setDefaultModelTier,
    ],
  )
  const { state, actions } = useReplController({
    engine,
    tools,
    cfg: runtimeCfg,
    onClearTerminal,
    initialSession: initialSession ?? undefined,
    allowedSubagents,
    reloadSubagents,
    mode,
    promptProfile,
    onModeChange: (nextMode) => {
      if (nextMode === 'plan') ensurePlanPath()
      setMode(nextMode)
    },
    commandRegistry,
    planSession,
    env: process.env,
    cwd: process.cwd(),
    runtimeFlags,
  })

  const handleConfigExit = useCallback(
    (exit: ConfigDialogExit) => {
      actions.closeConfigDialog(exit)
      if (exit.kind === 'changed') void reloadCfg({ syncPromptProfile: true })
    },
    [actions, reloadCfg],
  )

  const handleModelExit = useCallback(
    (exit: { kind: 'dismissed' } | { kind: 'changed'; message: string }) => {
      actions.closeModelDialog(exit)
    },
    [actions],
  )

  useEffect(() => {
    if (state.isLoading) {
      setLoadingStartedAtMs((prev) => prev ?? Date.now())
      return
    }
    setLoadingStartedAtMs(null)
  }, [state.isLoading])

  const isPromptMode = useMemo(
    () => computePromptMode({ state, userInput, toolRegistry }),
    [
      state.agentsDialogOpen,
      state.permissionsDialogOpen,
      state.hooksDialogOpen,
      state.configDialogOpen,
      state.modelDialogOpen,
      state.resumeDialogOpen,
      state.transientMessages,
      toolRegistry,
      userInput,
    ],
  )

  const allMessages = useMemo(() => [...state.staticMessages, ...state.transientMessages], [state.staticMessages, state.transientMessages])
  const suppressGlobalError = useMemo(
    () => shouldSuppressGlobalError({ messages: allMessages, currentError: state.error }),
    [allMessages, state.error],
  )

  const { lastCompactBoundaryIndex, primaryTranscriptStartIndex, primaryTranscriptMessages } = useMemo(
    () => projectCompactPrimaryTranscript(allMessages),
    [allMessages],
  )

  const primaryPartition = useMemo(() => partitionMessages(primaryTranscriptMessages), [primaryTranscriptMessages])

  const primaryTranscriptSeq = useMemo(
    () => state.transcriptSeq + Math.max(0, primaryTranscriptStartIndex),
    [primaryTranscriptStartIndex, state.transcriptSeq],
  )

  const expandedViewActive = expandedTranscriptOpen && !isPromptMode

  useEffect(() => {
    if (ctrlCArmedUntilMs === null) return

    const delayMs = ctrlCArmedUntilMs - Date.now()
    if (delayMs <= 0) {
      setCtrlCArmedUntilMs(null)
      return
    }

    const timer = setTimeout(() => setCtrlCArmedUntilMs(null), delayMs)
    return () => clearTimeout(timer)
  }, [ctrlCArmedUntilMs])

  const {
    input,
    setInput,
    slashIndex,
    setSlashIndex,
    slashSelectionTouched,
    setSlashSelectionTouched,
    slashSuggestions,
    selectedSlash,
    handleInputChange,
    clearPrompt,
  } = usePromptLine({ commandRegistry, isPromptMode })

  const slashSpecByCommand = useMemo(() => {
    return createSlashCommandSpecMap(commandRegistry.list())
  }, [commandRegistry])

  const inputSuffixHint = useMemo(() => {
    if (isPromptMode || bashModeActive) return null
    return resolveSlashCommandInputHint({ input, slashSpecByCommand })
  }, [bashModeActive, input, isPromptMode, slashSpecByCommand])

  useEffect(() => {
    queuedDuringLoadingRef.current = queuedDuringLoading
  }, [queuedDuringLoading])

  const recallQueuedMessage = useCallback(() => {
    const queue = queuedDuringLoadingRef.current
    if (queue.length === 0) return
    const recalled = queue[queue.length - 1] ?? ''
    const nextQueue = queue.slice(0, -1)
    queuedDuringLoadingRef.current = nextQueue
    setQueuedDuringLoading(nextQueue)
    setInput(recalled)
    setSlashIndex(0)
    setSlashSelectionTouched(false)
  }, [setInput, setSlashIndex, setSlashSelectionTouched])

  useEffect(() => {
    const wasLoading = wasLoadingRef.current
    wasLoadingRef.current = state.isLoading
    if (!wasLoading || state.isLoading) return
    if (isAutoFlushingQueueRef.current) return
    const queueSnapshot = queuedDuringLoadingRef.current
    if (queueSnapshot.length === 0) return

    const merged = queueSnapshot.join('\n')
    queuedDuringLoadingRef.current = []
    setQueuedDuringLoading([])
    isAutoFlushingQueueRef.current = true
    void (async () => {
      try {
        await actions.send(merged)
      } finally {
        isAutoFlushingQueueRef.current = false
      }
    })()
  }, [actions, queuedDuringLoading, state.isLoading])

  const { handleToggleExpandedTranscript } = useSurfaceTransitionManager({
    actions,
    isPromptMode,
    expandedTranscriptOpen,
    setExpandedTranscriptOpen,
    expandedTranscriptHideHistory,
    setExpandedTranscriptHideHistory,
    expandedViewActive,
    lastCompactBoundaryIndex,
  })

  useReplHotkeys({
    onExit,
    actions,
    ensurePlanPath,
    setMode,
    isPromptMode,
    userInput,
    toolRegistry,
    allMessages,
    expandedTranscriptOpen,
    onToggleExpandedTranscript: handleToggleExpandedTranscript,
    setExpandedTranscriptOpen,
    expandedTranscriptHideHistory,
    setExpandedTranscriptHideHistory,
    state: {
      agentsDialogOpen: state.agentsDialogOpen,
      permissionsDialogOpen: state.permissionsDialogOpen,
      hooksDialogOpen: state.hooksDialogOpen,
      modelDialogOpen: state.modelDialogOpen,
      configDialogOpen: state.configDialogOpen,
      isLoading: state.isLoading,
      thinkingText: state.thinkingText,
      transientMessages: state.transientMessages,
    },
    slashSuggestions,
    selectedSlash,
    setSlashSelectionTouched,
    setSlashIndex,
    input,
    setInput,
    queuedMessageCount: queuedDuringLoading.length,
    onRecallQueuedMessage: recallQueuedMessage,
    bashModeActive,
    setBashModeActive,
    ctrlCArmedUntilMs,
    setCtrlCArmedUntilMs,
  })

  const handleSend = useCallback(
    async (value: string) => {
      const text = value.trim()
      if (!text) return

      if (state.isLoading) {
        if (text.startsWith('/') || text.startsWith('!') || bashModeActive) return
        setQueuedDuringLoading((prev) => {
          const nextQueue = [...prev, text]
          queuedDuringLoadingRef.current = nextQueue
          return nextQueue
        })
        clearPrompt()
        return
      }

      if (slashSuggestions.length > 0 && selectedSlash?.command) {
        const normalized = text.replace(/\s+$/, '')
        const normalizedLower = normalized.toLowerCase()
        const selectedLower = selectedSlash.command.toLowerCase()
        if (normalizedLower !== selectedLower && !normalizedLower.startsWith(selectedLower + ' ')) {
          setInput(selectedSlash.command)
          setSlashIndex(0)
          setSlashSelectionTouched(false)
          return
        }
      }

      clearPrompt()
      if (bashModeActive) setBashModeActive(false)
      const sendText = bashModeActive ? `! ${text}` : text
      await actions.send(
        sendText,
        text.startsWith('/') && slashSelectionTouched && selectedSlash?.id
          ? { preferredSlashSpecId: selectedSlash.id }
          : undefined,
      )
    },
    [
      actions,
      bashModeActive,
      clearPrompt,
      selectedSlash,
      slashSelectionTouched,
      slashSuggestions.length,
      state.isLoading,
    ],
  )

  type TranscriptRenderMode = 'primary' | 'expanded'

  const renderReplMessage = useCallback(
    (msg: Msg, mode: TranscriptRenderMode) => {
      if (msg.ui?.kind === 'compact_summary' && mode !== 'expanded') {
        return null
      }

      if (msg.role === 'tool') {
        const toolMsg =
          mode === 'expanded' && msg.toolInfo ? { ...msg, toolInfo: { ...msg.toolInfo, expanded: true } } : msg
        return (
          <Box flexDirection="column">
            <ToolRouter message={toolMsg} registry={toolRegistry} />
          </Box>
        )
      }

      if (msg.role === 'assistant') {
        if (!msg.content) return null
        if (msg.ui?.kind === 'command_subline') {
          const errorLike = isErrorLikeSubline(msg.content)
          return (
            <Box flexDirection="column" marginTop={0} marginBottom={0}>
              <Box>
                <Text color={errorLike ? theme.error : undefined}>{`  ⎿  ${msg.content}`}</Text>
              </Box>
            </Box>
          )
        }
        if (msg.ui?.kind === 'compact_banner') {
          const label = String(msg.content || '').trim()
          const totalCols = Math.max(process.stdout.columns || 80, 40)
          const inner = ` ${label} `
          const sideTotal = Math.max(0, totalCols - inner.length)
          const left = '═'.repeat(Math.floor(sideTotal / 2))
          const right = '═'.repeat(Math.ceil(sideTotal / 2))

          return (
            <Box flexDirection="column" marginTop={0} marginBottom={0}>
              <Box>
                <Text dimColor>{left}</Text>
                <Text color={theme.secondaryText}>{inner}</Text>
                <Text dimColor>{right}</Text>
              </Box>
            </Box>
          )
        }
        if (msg.ui?.kind === 'thinking_block') {
          if (!shouldRenderThinkingBlock({ mode, verboseOutput: runtimeCfg.ui.verboseOutput })) {
            return null
          }
          return renderThinkingBlock({ content: msg.content, theme })
        }
        if (msg.ui?.kind === 'compact_boundary') {
          return null
        }
        return (
          <Box flexDirection="column" marginTop={1} marginBottom={0}>
            <Box>
              <Text>{`⏺ ${msg.content}`}</Text>
            </Box>
          </Box>
        )
      }

      return (
        <Box flexDirection="column" marginTop={1} marginBottom={0}>
          <Box>
            <Text
              color={theme.replUserPromptFg}
              backgroundColor={theme.replUserPromptBg}
            >{`> ${msg.content} `}</Text>
          </Box>
        </Box>
      )
    },
    [
      runtimeCfg.ui.verboseOutput,
      theme.error,
      theme.replUserPromptBg,
      theme.replUserPromptFg,
      theme.secondaryText,
      toolRegistry,
    ],
  )

  const renderMessage = useCallback((msg: Msg) => renderReplMessage(msg, 'primary'), [renderReplMessage])

  const renderExpandedMessage = useCallback((msg: Msg) => renderReplMessage(msg, 'expanded'), [renderReplMessage])

  const modelLabel = useMemo(() => {
    const model = runtimeCfg.llm.model || 'Model not set'
    return `Model: ${model}`
  }, [runtimeCfg.llm.model])

  const contextLine = useMemo(() => {
    if (!runtimeCfg.ui.showContextMeter) return null
    if (!state.context) return null
    const pct = clampPct(state.context.percentRemaining)
    const used = formatTokens(state.context.usedTokens)
    const limit = formatTokens(state.context.limitTokens)
    const src = state.context.source === 'usage' ? 'usage' : 'est.'
    return `Context: ${pct}% free (${used}/${limit}, ${src})`
  }, [runtimeCfg.ui.showContextMeter, state.context])

  const replCwd = useMemo(() => process.cwd(), [])

  const showLoadingBlock = useMemo(() => {
    if (!state.isLoading || isPromptMode) return false
    return true
  }, [isPromptMode, state.isLoading])

  const expandedTranscriptTask = useMemo(() => {
    if (!expandedViewActive) return null
    return (
      [...allMessages].reverse().find((m) => {
        if (m.role !== 'tool') return false
        if (m.toolInfo?.name !== 'Task') return false
        return Array.isArray(m.toolInfo?.transcriptLines) && m.toolInfo.transcriptLines.length > 0
      }) ?? null
    )
  }, [allMessages, expandedViewActive])

  const lastExploreGroup = useMemo(() => {
    if (!expandedViewActive) return null
    // Persisted assistant "thinking_block" messages should not break Explore-task grouping
    // in the Expanded Transcript panels. Grouping is about tool messages, so filter to tools.
    const group = findLastContiguousExploreTaskGroup(allMessages.filter((m) => m.role === 'tool'))
    if (!group || group.tasks.length < 2) return null
    return group
  }, [allMessages, expandedViewActive])

  const expandedTranscriptHiddenCount = useMemo(() => {
    if (!expandedViewActive) return 0
    return Math.max(0, allMessages.length - 20)
  }, [allMessages.length, expandedViewActive])

  const expandedTranscriptMessages = useMemo(() => {
    if (!expandedViewActive) return allMessages
    if (!expandedTranscriptHideHistory) return allMessages
    return allMessages.slice(-20)
  }, [allMessages, expandedTranscriptHideHistory, expandedViewActive])

  const loadingOverrideText = useMemo(() => {
    const t = String(state.loadingText || '').trim()
    if (!t) return null
    // Keep the fun random loading words for generic states; only override when we
    // have a more specific, user-facing activity label (e.g. "Preparing write").
    if (t === 'Thinking' || t === 'Working' || t === 'Waiting') return null
    return t
  }, [state.loadingText])

  const isCompactLoading = useMemo(() => {
    const text = String(state.loadingText || '').toLowerCase()
    return text.startsWith('compacting conversation')
  }, [state.loadingText])

  const showFooterContext = Boolean(contextLine && ctrlCArmedUntilMs === null)

  return (
    <PlanProvider planSession={planSession}>
      <ReplUiProvider abort={actions.abort}>
        <Box flexDirection="column" height="100%">
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {expandedViewActive ? (
              <ExpandedReplTranscript
                transcriptSeq={state.transcriptSeq}
                version={(pkg as any).version || '0.0.0'}
                modelLabel={modelLabel}
                cwd={replCwd}
                messages={expandedTranscriptMessages}
                renderMessage={renderExpandedMessage}
              />
            ) : (
              <ReplTranscript
                transcriptSeq={primaryTranscriptSeq}
                version={(pkg as any).version || '0.0.0'}
                modelLabel={modelLabel}
                cwd={replCwd}
                staticMessages={primaryPartition.staticMessages}
                transientMessages={primaryPartition.transientMessages}
                renderMessage={renderMessage}
              />
            )}

            {expandedViewActive && lastExploreGroup?.tasks?.length ? (
              <ExploreAgentsPanel tasks={lastExploreGroup?.tasks ?? null} />
            ) : null}

            {expandedViewActive && expandedTranscriptTask?.toolInfo?.transcriptLines?.length ? (
              <DetailedTranscriptPanel
                title={expandedTranscriptTask ? formatTaskPanelTitle(expandedTranscriptTask) : null}
                lines={expandedTranscriptTask?.toolInfo?.transcriptLines ?? null}
              />
            ) : null}

            {state.agentsDialogOpen && (
              <AgentsDialog
                agents={state.allowedSubagents}
                toolNames={tools.map((t) => t.name)}
                userAgentsDir={userAgentsDir}
                projectAgentsDir={runtimeCfg.paths.subagentsDir}
                onGenerateDraft={actions.generateAgentDraft}
                onSaveAgent={actions.saveAgentFromDialog}
                onExit={actions.closeAgentsDialog}
              />
            )}

            {state.permissionsDialogOpen && <PermissionsDialog onExit={actions.closePermissionsDialog} />}
            {state.hooksDialogOpen && <HooksDialog onExit={actions.closeHooksDialog} />}
            {state.configDialogOpen && <ConfigDialog onExit={handleConfigExit} />}
            {state.modelDialogOpen && (
              <ModelDialog
                currentTier={parseModelTier(runtimeCfg.llm.defaultTier) ?? 'sonnet'}
                modelByTier={modelByTier}
                onApplyTier={applyDefaultModelTier}
                onExit={handleModelExit}
              />
            )}
            {state.resumeDialogOpen && (
              <ResumeDialog
                onExit={actions.closeResumeDialog}
                onResume={actions.resumeSession}
                onRename={actions.renameSession}
              />
            )}

            {showLoadingBlock && (
              <Box marginTop={1} flexDirection="column">
                {state.thinkingStartedAtMs !== null && (
                  <Box marginBottom={1}>
                    <ThinkingStatusLine
                      startedAtMs={state.thinkingStartedAtMs}
                      showThinkingHint={Boolean(state.thinkingText.trim())}
                    />
                  </Box>
                )}
                {expandedTranscriptOpen && state.thinkingText.trim() && (
                  <Box marginBottom={1}>
                    <Text dimColor>{state.thinkingText.trimEnd()}</Text>
                  </Box>
                )}
                <LoadingStatusLine
                  text={loadingOverrideText ?? undefined}
                  cycleWords={!loadingOverrideText}
                  baseColor={isCompactLoading ? '#d6b15d' : undefined}
                  highlightColor={isCompactLoading ? '#f2cf84' : undefined}
                />
              </Box>
            )}

            {state.error && !state.isLoading && !suppressGlobalError && (
              <Box marginTop={1}>
                <PulsingDot color="red" />
                <Text color="red">Error: {state.error}</Text>
              </Box>
            )}
          </Box>

          {expandedViewActive && (
            <Box flexDirection="column" flexShrink={0} marginTop={1}>
              <Text color={theme.secondaryText}>{'─'.repeat(Math.max((process.stdout.columns || 80), 40))}</Text>
              <Text color={theme.secondaryText}>{'  Showing detailed transcript · ctrl+o to toggle'}</Text>
              {expandedTranscriptHiddenCount > 0 && (
                <Text color={theme.secondaryText}>
                  {expandedTranscriptHideHistory
                    ? `  Ctrl+E to show ${expandedTranscriptHiddenCount} previous messages`
                    : `  Ctrl+E to hide ${expandedTranscriptHiddenCount} previous messages`}
                </Text>
              )}
            </Box>
          )}

          {!isPromptMode && !expandedViewActive && (
            <Box flexDirection="column" flexShrink={0} marginTop={1}>
              {queuedDuringLoading.length > 0 && (
                <Box flexDirection="column">
                  {queuedDuringLoading.map((queued, idx) => (
                    <Box key={`queued-${idx}`}>
                      <Text
                        color={theme.replUserPromptFg}
                        backgroundColor={theme.replUserPromptBg}
                      >{`> ${queued} `}</Text>
                    </Box>
                  ))}
                </Box>
              )}
              <InputBar
                value={input}
                onChange={handleInputChange}
                onSubmit={handleSend}
                placeholder={`Try \"fix typecheck errors\"`}
                inputSuffixHint={inputSuffixHint}
                inputMode={bashModeActive ? 'bash' : 'normal'}
                onBackspaceAtStart={
                  bashModeActive
                    ? () => {
                        setInput('')
                        setBashModeActive(false)
                      }
                    : undefined
                }
                suggestions={slashSuggestions.map((s, i) => ({
                  id: s.id,
                  command: s.command,
                  description: s.description,
                  selected: i === slashIndex,
                  dim: s.implemented === false,
                }))}
              />
              {slashSuggestions.length === 0 && (
                <Box flexDirection="column">
                  {state.isLoading && queuedDuringLoading.length > 0 ? (
                    <Box>
                      <Text dimColor>{'> Press up to edit queued messages'}</Text>
                      {showFooterContext ? <Text dimColor>{`   [${contextLine}]`}</Text> : null}
                    </Box>
                  ) : (
                    <Box>
                      <ReplFooterHint
                        mode={mode}
                        ctrlCArmed={ctrlCArmedUntilMs !== null}
                        isBashInput={bashModeActive}
                      />
                      {showFooterContext ? <Text dimColor>{`   [${contextLine}]`}</Text> : null}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          )}
        </Box>
      </ReplUiProvider>
    </PlanProvider>
  )
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

export type { MessageItemDescriptor } from './repl/messageItems'
export { deriveMessageItemDescriptors } from './repl/messageItems'
