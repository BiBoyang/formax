import React, { useEffect, useState, useCallback, useMemo } from 'react'
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
import { createSlashCommandRegistry } from '../features/commands/registry'
import { ReplUiProvider } from '../features/repl/replUiContext'
import { ClaudeCodeLoading } from '../components/ui/ClaudeCodeLoading'
import { ClaudeCodeThinkingStatus } from '../components/ui/ClaudeCodeThinkingStatus'
import { PulsingDot } from '../components/ui/PulsingDot'
import { nextReplMode, type ReplMode } from '../features/repl/mode'
import { useUserInputManager } from '../tools/runtime/userInputContext'
import { createPlanSessionManager } from '../features/repl/planSession'
import { PlanProvider } from '../features/repl/planContext'

type Props = {
  onExit?: () => void
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  allowedSubagents?: Array<{ name: string; description: string }>
  toolRegistry?: ToolRegistry
  taskManager?: TaskManager
}

export function REPL({
  onExit,
  engine,
  tools,
  cfg,
  allowedSubagents,
  toolRegistry,
  taskManager,
}: Props): React.ReactNode {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<ReplMode>('normal')
  const [slashIndex, setSlashIndex] = useState(0)
  const [promptProfile, setPromptProfile] = useState(cfg.ui.promptProfile)
  const [loadingStartedAtMs, setLoadingStartedAtMs] = useState<number | null>(null)
  const [showThinking, setShowThinking] = useState(false)
  const userInput = useUserInputManager()
  const planSession = useMemo(() => createPlanSessionManager({ planDir: cfg.paths.planDir }), [cfg.paths.planDir])
  const ensurePlanPath = useCallback(
    () => planSession.getPlanPath() ?? planSession.startNewPlan(),
    [planSession],
  )
  const commandRegistry = useMemo(
    () =>
      createSlashCommandRegistry({
        cwd: process.cwd(),
        taskManager,
        plan: planSession,
        promptProfile: { get: () => promptProfile, set: setPromptProfile },
      }),
    [planSession, promptProfile, taskManager],
  )
  const { state, actions } = useReplController({
    engine,
    tools,
    cfg,
    allowedSubagents,
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

  const isPromptMode = useMemo(() => {
    if (!userInput) return false
    const alwaysInteractive = new Set(['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'])
    return state.transientMessages.some((m) => {
      if (m.role !== 'tool' || m.toolInfo?.status !== 'running') return false
      const toolUseId = m.toolInfo.toolUseId || (m.id.startsWith('tool-') ? m.id.slice('tool-'.length) : m.id)
      const interactive = toolRegistry?.getMeta(m.toolInfo.name)?.interactive ?? alwaysInteractive.has(m.toolInfo.name)
      return interactive || userInput.isPending(toolUseId)
    })
  }, [state.transientMessages, toolRegistry, userInput])

  const slashSuggestions = useMemo(() => {
    if (isPromptMode) return []
    return commandRegistry.suggest(input).slice(0, 10)
  }, [commandRegistry, input, isPromptMode])

  const selectedSlash = slashSuggestions[slashIndex]?.command

  const handleInputChange = useCallback((v: string) => {
    setInput(v)
    setSlashIndex(0)
  }, [])

  useInput((key, meta) => {
    if (meta.ctrl && key === 'c') {
      actions.abort()
      onExit ? onExit() : process.exit(0)
    }

    if (meta.ctrl && key === 'o') {
      if (!state.isLoading) return
      if (!state.thinkingText.trim()) return
      setShowThinking((v) => !v)
      return
    }

    if (meta.shift && meta.tab) {
      setMode((m) => {
        const next = nextReplMode(m)
        if (next === 'plan') ensurePlanPath()
        return next
      })
      return
    }

    if (isPromptMode) return

    if (meta.escape) {
      actions.abort()
    }

    if (slashSuggestions.length > 0) {
      if (meta.downArrow) {
        setSlashIndex((i) => Math.min(i + 1, slashSuggestions.length - 1))
      } else if (meta.upArrow) {
        setSlashIndex((i) => Math.max(i - 1, 0))
      } else if (meta.tab && selectedSlash) {
        setInput(selectedSlash)
        setSlashIndex(0)
      }
    }
  })

  const handleSend = useCallback(
    async (value: string) => {
      const text = value.trim()
      if (!text) return

      if (slashSuggestions.length > 0 && selectedSlash) {
        const normalized = text.replace(/\s+$/, '')
        if (normalized !== selectedSlash && !normalized.startsWith(selectedSlash + ' ')) {
          setInput(selectedSlash)
          setSlashIndex(0)
          return
        }
      }

      setInput('')
      if (state.isLoading) return
      await actions.send(text)
    },
    [actions, selectedSlash, slashSuggestions.length, state.isLoading],
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

  const modelLabel = useMemo(() => {
    const model = cfg.llm.model || process.env.ANTHROPIC_MODEL || 'Model not set'
    return `Model: ${model}`
  }, [cfg.llm.model])

  // Header 作为 Static 列表的第一项
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
    const items = state.staticMessages.map((m) => ({ key: m.id, jsx: renderMessage(m) }))
    return [header, ...items]
  }, [modelLabel, renderMessage, state.staticMessages])

  const showLoadingBlock = useMemo(() => {
    if (!state.isLoading || isPromptMode) return false

    const hasStreamingAssistant = state.transientMessages.some(
      (m) => m.role === 'assistant' && Boolean(m.isStreaming),
    )
    if (hasStreamingAssistant) return false

    const hasRunningTool = state.transientMessages.some(
      (m) => m.role === 'tool' && m.toolInfo?.status === 'running',
    )
    if (hasRunningTool) return false

    return true
  }, [isPromptMode, state.isLoading, state.transientMessages])

  return (
    <PlanProvider planSession={planSession}>
      <ReplUiProvider abort={actions.abort}>
        <Box flexDirection="column" height="100%">
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {/* Header + 消息 Static */}
            <Static items={staticItems}>
              {(item) => <Box key={item.key}>{item.jsx}</Box>}
            </Static>

            {state.transientMessages.map((msg) => (
              <Box key={msg.id}>{renderMessage(msg)}</Box>
            ))}

            {showLoadingBlock && (
              <Box marginTop={1} flexDirection="column">
                <Box marginBottom={1}>
                  <ClaudeCodeThinkingStatus
                    startedAtMs={loadingStartedAtMs}
                    showThinkingHint={Boolean(state.thinkingText.trim())}
                  />
                </Box>
                {showThinking && state.thinkingText.trim() && (
                  <Box marginBottom={1}>
                    <Text dimColor>{state.thinkingText.trimEnd()}</Text>
                  </Box>
                )}
                <ClaudeCodeLoading cycleWords />
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
                  command: s.command,
                  description: s.description,
                  selected: i === slashIndex,
                  dim: s.implemented === false,
                }))}
              />
              {slashSuggestions.length === 0 && (
                <Box>
                  {mode === 'normal' ? <Text dimColor>? for shortcuts</Text> : <ModeIndicator mode={mode} />}
                </Box>
              )}
            </Box>
          )}
        </Box>
      </ReplUiProvider>
    </PlanProvider>
  )
}
