import React, { useEffect, useState, useCallback, useMemo } from 'react'
import path from 'node:path'
import { Box, Text, useInput, Static } from 'ink'
import type { ChatEngine } from '../chat/engine'
import type { RuntimeConfig } from '../env/config'
import type { ToolDefinition } from '../tools/types'
import type { ToolRegistry } from '../tools/registry'
import { useReplController } from '../features/repl/useReplController'
import { ToolRouter } from '../components/tool/ToolRouter'
import type { Msg } from '../components/tool/ToolMessage'
import { HeaderBanner } from '../components/chat/HeaderBanner'
import pkg from '../../package.json'
import { InputBar } from '../components/chat/InputBar'
import { ModeIndicator } from '../components/chat/ModeIndicator'
import type { TaskManager } from '../tools/runtime/taskManager'
import { ReplUiProvider } from '../features/repl/replUiContext'
import { LoadingStatusLine } from '../components/ui/LoadingStatusLine'
import { ThinkingStatusLine } from '../components/ui/ThinkingStatusLine'
import { PulsingDot } from '../components/ui/PulsingDot'
import { nextReplMode, type ReplMode } from '../features/repl/mode'
import { useUserInputManager } from '../tools/runtime/userInputContext'
import { createPlanSessionManager } from '../features/repl/planSession'
import { PlanProvider } from '../features/repl/planContext'
import { getTheme } from '../utils/theme'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore'
import { detectWorkspaceRoots } from '../adapters/fs/workspaceRoots'
import { AgentsDialog } from '../ui/agents/AgentsDialog'
import { PermissionsDialog } from '../ui/permissions/PermissionsDialog'
import { HooksDialog } from '../ui/hooks/HooksDialog'
import { getConfigPaths } from '../adapters/fs/configPaths'
import { useScopedInput } from '../features/repl/inputScopeContext'
import type { TokenUsage } from '../streaming/types'
import { deriveMessageItemDescriptors, findLastContiguousExploreTaskGroup } from './repl/messageItems'
import { createReplCommandRegistry } from './repl/createReplCommandRegistry'
import { formatTokens } from './repl/format'
import { DetailedTranscriptPanel, ExploreAgentsPanel, formatTaskPanelTitle } from './repl/panels'
import { isPromptMode as computePromptMode } from './repl/promptMode'

type Props = {
  onExit?: () => void
  onClearTerminal?: () => void | Promise<void>
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  allowedSubagents?: Array<{ name: string; description: string }>
  reloadSubagents?: () => Promise<Array<{ name: string; description: string }>>
  toolRegistry?: ToolRegistry
  taskManager?: TaskManager
}

export function REPL({
  onExit,
  onClearTerminal,
  engine,
  tools,
  cfg,
  allowedSubagents,
  reloadSubagents,
  toolRegistry,
  taskManager,
}: Props): React.ReactNode {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<ReplMode>('normal')
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashSelectionTouched, setSlashSelectionTouched] = useState(false)
  const [promptProfile, setPromptProfile] = useState(cfg.ui.promptProfile)
  const [workspaceRoots, setWorkspaceRoots] = useState<string[]>([process.cwd()])
  const [workspaceRootWarnings, setWorkspaceRootWarnings] = useState<string[]>([])
  const [loadingStartedAtMs, setLoadingStartedAtMs] = useState<number | null>(null)
  const [showThinking, setShowThinking] = useState(false)
  const [showDetailedTranscript, setShowDetailedTranscript] = useState(false)
  const [detailedTranscriptTargetId, setDetailedTranscriptTargetId] = useState<string | null>(null)
  const [showExploreAgentsPanel, setShowExploreAgentsPanel] = useState(false)
  const userInput = useUserInputManager()
  const planSession = useMemo(() => createPlanSessionManager({ planDir: cfg.paths.planDir }), [cfg.paths.planDir])
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
        cfg,
        taskManager,
        planSession,
        promptProfile,
        setPromptProfile,
        workspaceRoots,
        workspaceRootWarnings,
      }),
    [
      cfg.llm.apiKey,
      cfg.llm.baseUrl,
      cfg.llm.model,
      cfg.llm.provider,
      cfg.llm.timeoutMs,
      cfg.paths,
      cfg.ui.assistantTextMode,
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
    cfg,
    onClearTerminal,
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

  useEffect(() => {
    if (state.isLoading) {
      setLoadingStartedAtMs((prev) => prev ?? Date.now())
      return
    }
    setLoadingStartedAtMs(null)
    setShowThinking(false)
  }, [state.isLoading])

  const isPromptMode = useMemo(
    () => computePromptMode({ state, userInput, toolRegistry }),
    [state.agentsDialogOpen, state.permissionsDialogOpen, state.transientMessages, toolRegistry, userInput],
  )

  const allMessages = useMemo(
    () => [...state.staticMessages, ...state.transientMessages],
    [state.staticMessages, state.transientMessages],
  )

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

  useInput(
    (inputKey, key) => {
      if (key.ctrl && inputKey === 'c') {
        actions.abort()
        onExit ? onExit() : process.exit(0)
        return
      }
    },
    { isActive: true },
  )

  useScopedInput('repl', (inputKey, key) => {
    if (key.ctrl && inputKey === 'o') {
      if (state.agentsDialogOpen) return
      if (state.permissionsDialogOpen) return
      if (isPromptMode) return

      if (state.isLoading && state.thinkingText.trim()) {
        setShowThinking((v) => !v)
        return
      }

      if (showDetailedTranscript) {
        setShowDetailedTranscript(false)
        return
      }

      if (showExploreAgentsPanel) {
        setShowExploreAgentsPanel(false)
        return
      }

      const lastMsg = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null
      const wantsExplorePanel =
        lastMsg?.role === 'assistant' && /^\d+\s+Explore agents\s+finished\b/.test(lastMsg.content || '')

      if (wantsExplorePanel) {
        const lastExploreGroup = findLastContiguousExploreTaskGroup(allMessages)
        if (lastExploreGroup && lastExploreGroup.tasks.length >= 2) {
          setShowExploreAgentsPanel(true)
          return
        }
      }

      const lastTaskWithTranscript = [...allMessages].reverse().find((m) => {
        if (m.role !== 'tool') return false
        if (m.toolInfo?.name !== 'Task') return false
        return Array.isArray(m.toolInfo?.transcriptLines) && m.toolInfo.transcriptLines.length > 0
      })

      if (lastTaskWithTranscript) {
        setDetailedTranscriptTargetId(lastTaskWithTranscript.id)
        setShowDetailedTranscript(true)
      }
      return
    }

    if (key.escape) {
      if (state.agentsDialogOpen) return
      if (state.permissionsDialogOpen) return
      actions.abort()
      return
    }

    if (isPromptMode) return

    if (key.shift && key.tab) {
      setMode((m) => {
        const next = nextReplMode(m)
        if (next === 'plan') ensurePlanPath()
        return next
      })
      return
    }

    if (slashSuggestions.length > 0) {
      if (key.downArrow) {
        setSlashSelectionTouched(true)
        setSlashIndex((i) => Math.min(i + 1, slashSuggestions.length - 1))
      } else if (key.upArrow) {
        setSlashSelectionTouched(true)
        setSlashIndex((i) => Math.max(i - 1, 0))
      } else if (key.tab && selectedSlash?.command) {
        setInput(selectedSlash.command)
        setSlashIndex(0)
      }
    }
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
          return
        }
      }

      setInput('')
      if (state.isLoading) return
      await actions.send(
        text,
        text.startsWith('/') && slashSelectionTouched && selectedSlash?.id
          ? { preferredSlashSpecId: selectedSlash.id }
          : undefined,
      )
    },
    [actions, selectedSlash, slashSelectionTouched, slashSuggestions.length, state.isLoading],
  )

  const renderMessage = useCallback(
    (msg: Msg) => {
      if (msg.role === 'tool') {
        return (
          <Box flexDirection="column">
            <ToolRouter message={msg} registry={toolRegistry} />
          </Box>
        )
      }

      if (msg.role === 'assistant') {
        if (!msg.content) return null
        return (
          <Box flexDirection="column" marginTop={1} marginBottom={0}>
            <Box>
              <Text>⏺ </Text>
              <Text>{msg.content}</Text>
            </Box>
          </Box>
        )
      }

      return (
        <Box flexDirection="column" marginTop={1} marginBottom={0}>
          <Box>
            <Text bold>&gt; </Text>
            <Text>{msg.content}</Text>
          </Box>
        </Box>
      )
    },
    [toolRegistry],
  )

  const renderMessageItems = useCallback(
    (messages: Msg[]) => {
      return messages.map((message) => ({ key: message.id, jsx: renderMessage(message) }))
    },
    [renderMessage],
  )

  const modelLabel = useMemo(() => {
    const model = cfg.llm.model || process.env.ANTHROPIC_MODEL || 'Model not set'
    return `Model: ${model}`
  }, [cfg.llm.model])

  const contextLine = useMemo(() => {
    if (!cfg.ui.showContextMeter) return null
    if (!state.context) return null
    const pct = clampPct(state.context.percentRemaining)
    const used = formatTokens(state.context.usedTokens)
    const limit = formatTokens(state.context.limitTokens)
    const src = state.context.source === 'usage' ? 'usage' : 'est.'
    return `Context: ${pct}% free (${used}/${limit}, ${src})`
  }, [cfg.ui.showContextMeter, state.context])

  // Header 作为 Static 列表的第一项（避免 Static items 把消息刷到 header 上方）
  const staticItems = useMemo(() => {
    const header = {
      key: 'header',
      jsx: (
        <HeaderBanner
          version={(pkg as any).version || '0.0.0'}
          modelLabel={modelLabel}
          cwd={process.cwd()}
        />
      ),
    }
    const messages = renderMessageItems(state.staticMessages)
    return [header, ...messages]
  }, [modelLabel, renderMessageItems, state.staticMessages])

  const showLoadingBlock = useMemo(() => {
    if (!state.isLoading || isPromptMode) return false

    const hasStreamingAssistant = state.transientMessages.some(
      (m) => m.role === 'assistant' && Boolean(m.isStreaming),
    )
    if (hasStreamingAssistant) return false

    return true
  }, [isPromptMode, state.isLoading, state.transientMessages])

  const detailedTranscriptTarget = useMemo(() => {
    if (!showDetailedTranscript) return null
    if (!detailedTranscriptTargetId) return null
    return allMessages.find((m) => m.id === detailedTranscriptTargetId) ?? null
  }, [allMessages, detailedTranscriptTargetId, showDetailedTranscript])

  const lastExploreGroup = useMemo(() => {
    if (!showExploreAgentsPanel) return null
    const group = findLastContiguousExploreTaskGroup(allMessages)
    if (!group || group.tasks.length < 2) return null
    return group
  }, [allMessages, showExploreAgentsPanel])

  return (
    <PlanProvider planSession={planSession}>
      <ReplUiProvider abort={actions.abort}>
        <Box flexDirection="column" height="100%">
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {/* Header + 消息 Static */}
            <Static key={state.transcriptSeq} items={staticItems}>
              {(item) => <Box key={item.key}>{item.jsx}</Box>}
            </Static>

            {renderMessageItems(state.transientMessages).map((item) => (
              <Box key={item.key}>{item.jsx}</Box>
            ))}

            {showExploreAgentsPanel && !isPromptMode && (
              <ExploreAgentsPanel tasks={lastExploreGroup?.tasks ?? null} />
            )}

            {showDetailedTranscript && !isPromptMode && !showExploreAgentsPanel && (
              <DetailedTranscriptPanel
                title={detailedTranscriptTarget ? formatTaskPanelTitle(detailedTranscriptTarget) : null}
                lines={detailedTranscriptTarget?.toolInfo?.transcriptLines ?? null}
              />
            )}

            {state.agentsDialogOpen && (
              <AgentsDialog
                agents={state.allowedSubagents}
                toolNames={tools.map((t) => t.name)}
                userAgentsDir={userAgentsDir}
                projectAgentsDir={cfg.paths.subagentsDir}
                onGenerateDraft={actions.generateAgentDraft}
                onSaveAgent={actions.saveAgentFromDialog}
                onExit={actions.closeAgentsDialog}
              />
            )}

            {state.permissionsDialogOpen && <PermissionsDialog onExit={actions.closePermissionsDialog} />}
            {state.hooksDialogOpen && <HooksDialog onExit={actions.closeHooksDialog} />}

            {showLoadingBlock && (
              <Box marginTop={1} flexDirection="column">
                <Box marginBottom={1}>
                  <ThinkingStatusLine
                    startedAtMs={loadingStartedAtMs}
                    showThinkingHint={Boolean(state.thinkingText.trim())}
                  />
                </Box>
                {showThinking && state.thinkingText.trim() && (
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
                <Text color="red">Error: {state.error}</Text>
              </Box>
            )}
          </Box>

          {!isPromptMode && (
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
