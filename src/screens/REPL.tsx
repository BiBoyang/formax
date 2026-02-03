import React, { useEffect, useState, useCallback, useMemo } from 'react'
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
import { ModeIndicator } from '../components/chat/ModeIndicator'
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
  const userInput = useUserInputManager()
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
        workspaceRoots,
        workspaceRootWarnings,
      }),
    [
      runtimeCfg.llm.apiKey,
      runtimeCfg.llm.baseUrl,
      runtimeCfg.llm.model,
      runtimeCfg.llm.provider,
      runtimeCfg.llm.timeoutMs,
      runtimeCfg.paths,
      runtimeCfg.ui.assistantTextMode,
      planSession,
      promptProfile,
      workspaceRoots,
      workspaceRootWarnings,
      taskManager,
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
  })

  const reloadCfg = useCallback(async () => {
    const next = await loadRuntimeConfig(process.env, process.cwd())
    setRuntimeCfg(next)
    setPromptProfile(next.ui.promptProfile)
  }, [])

  const handleConfigExit = useCallback(
    (exit: ConfigDialogExit) => {
      actions.closeConfigDialog(exit)
      if (exit.kind === 'changed') void reloadCfg()
    },
    [actions, reloadCfg],
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
      state.resumeDialogOpen,
      state.transientMessages,
      toolRegistry,
      userInput,
    ],
  )

  const allMessages = useMemo(
    () => [...state.staticMessages, ...state.transientMessages],
    [state.staticMessages, state.transientMessages],
  )

  const expandedViewActive = expandedTranscriptOpen && !isPromptMode

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
    setExpandedTranscriptOpen,
    state: {
      agentsDialogOpen: state.agentsDialogOpen,
      permissionsDialogOpen: state.permissionsDialogOpen,
      hooksDialogOpen: state.hooksDialogOpen,
      configDialogOpen: state.configDialogOpen,
      isLoading: state.isLoading,
      thinkingText: state.thinkingText,
      transientMessages: state.transientMessages,
    },
    slashSuggestions,
    selectedSlash,
    setSlashSelectionTouched,
    setSlashIndex,
    setInput,
  })

  const handleSend = useCallback(
    async (value: string) => {
      const text = value.trim()
      if (!text) return

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
      if (state.isLoading) return
      await actions.send(
        text,
        text.startsWith('/') && slashSelectionTouched && selectedSlash?.id
          ? { preferredSlashSpecId: selectedSlash.id }
          : undefined,
      )
    },
    [actions, clearPrompt, selectedSlash, slashSelectionTouched, slashSuggestions.length, state.isLoading],
  )

  type TranscriptRenderMode = 'primary' | 'expanded'

  const renderReplMessage = useCallback(
    (msg: Msg, mode: TranscriptRenderMode) => {
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
          return (
            <Box flexDirection="column" marginTop={0} marginBottom={0}>
              <Box>
                <Text>{`  ⎿  ${msg.content}`}</Text>
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
    [runtimeCfg.ui.verboseOutput, theme.replUserPromptBg, theme.replUserPromptFg, theme.secondaryText, toolRegistry],
  )

  const renderMessage = useCallback((msg: Msg) => renderReplMessage(msg, 'primary'), [renderReplMessage])

  const renderExpandedMessage = useCallback((msg: Msg) => renderReplMessage(msg, 'expanded'), [renderReplMessage])

  const modelLabel = useMemo(() => {
    const model = runtimeCfg.llm.model || process.env.FORMAX_MODEL || 'Model not set'
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

    const hasStreamingAssistant = state.transientMessages.some(
      (m) => m.role === 'assistant' && Boolean(m.isStreaming),
    )
    if (hasStreamingAssistant) return false

    return true
  }, [isPromptMode, state.isLoading, state.transientMessages])

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

  return (
    <PlanProvider planSession={planSession}>
      <ReplUiProvider abort={actions.abort}>
        <Box flexDirection="column" height="100%">
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {expandedViewActive ? (
              <ExpandedReplTranscript
                version={(pkg as any).version || '0.0.0'}
                modelLabel={modelLabel}
                cwd={replCwd}
                messages={allMessages}
                renderMessage={renderExpandedMessage}
              />
            ) : (
              <ReplTranscript
                transcriptSeq={state.transcriptSeq}
                version={(pkg as any).version || '0.0.0'}
                modelLabel={modelLabel}
                cwd={replCwd}
                staticMessages={state.staticMessages}
                transientMessages={state.transientMessages}
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
            {state.resumeDialogOpen && (
              <ResumeDialog
                onExit={actions.closeResumeDialog}
                onResume={actions.resumeSession}
                onRename={actions.renameSession}
              />
            )}

            {showLoadingBlock && (
              <Box marginTop={1} flexDirection="column">
                {(state.thinkingStartedAtMs !== null || state.thinkingTotalMs > 0) && (
                  <Box marginBottom={1}>
                    <ThinkingStatusLine
                      startedAtMs={state.thinkingStartedAtMs}
                      accumulatedMs={state.thinkingTotalMs}
                      showThinkingHint={Boolean(state.thinkingText.trim())}
                    />
                  </Box>
                )}
                {expandedTranscriptOpen && state.thinkingText.trim() && (
                  <Box marginBottom={1}>
                    <Text dimColor>{state.thinkingText.trimEnd()}</Text>
                  </Box>
                )}
                <LoadingStatusLine cycleWords />
              </Box>
            )}

            {state.error && !state.isLoading && (
              <Box marginTop={1}>
                <PulsingDot color="red" />
                <Text color="red"> Error: {state.error}</Text>
              </Box>
            )}
          </Box>

          {expandedViewActive && (
            <Box flexDirection="column" flexShrink={0} marginTop={1}>
              <Text color={theme.secondaryText}>{'─'.repeat(Math.max((process.stdout.columns || 80), 40))}</Text>
              <Text color={theme.secondaryText}>{'  Showing detailed transcript · ctrl+o to toggle'}</Text>
            </Box>
          )}

          {!isPromptMode && !expandedViewActive && (
            <Box flexDirection="column" flexShrink={0} marginTop={1}>
              <InputBar
                value={input}
                onChange={handleInputChange}
                onSubmit={handleSend}
                placeholder={`Try \"fix typecheck errors\"`}
                disabled={state.isLoading}
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
                  {contextLine ? <Text dimColor>{contextLine}</Text> : null}
                  <Box>
                    {mode === 'normal' ? <Text dimColor>? for shortcuts</Text> : <ModeIndicator mode={mode} />}
                  </Box>
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
