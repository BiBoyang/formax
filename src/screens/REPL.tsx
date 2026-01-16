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
import { createSlashCommandRegistry } from '../features/commands/registry'
import { ReplUiProvider } from '../features/repl/replUiContext'
import { LoadingStatusLine } from '../components/ui/LoadingStatusLine'
import { ThinkingStatusLine } from '../components/ui/ThinkingStatusLine'
import { PulsingDot } from '../components/ui/PulsingDot'
import { nextReplMode, type ReplMode } from '../features/repl/mode'
import { useUserInputManager } from '../tools/runtime/userInputContext'
import { createPlanSessionManager } from '../features/repl/planSession'
import { PlanProvider } from '../features/repl/planContext'
import { runDoctor } from '../core/diagnostics/doctor'
import { formatDoctorHuman } from '../core/diagnostics/format'
import { createStatusSnapshot } from '../core/diagnostics/status'
import { testSetupConnection } from '../adapters/setup/connectionTest'
import { checkWritableDir } from '../adapters/fs/checkWritableDir'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore'
import { detectWorkspaceRoots } from '../adapters/fs/workspaceRoots'
import { configShow } from '../core/config/show'
import { AgentsDialog } from '../ui/AgentsDialog'
import { getConfigPaths } from '../adapters/fs/configPaths'

type Props = {
  onExit?: () => void
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
  const [promptProfile, setPromptProfile] = useState(cfg.ui.promptProfile)
  const [workspaceRoots, setWorkspaceRoots] = useState<string[]>([process.cwd()])
  const [workspaceRootWarnings, setWorkspaceRootWarnings] = useState<string[]>([])
  const [loadingStartedAtMs, setLoadingStartedAtMs] = useState<number | null>(null)
  const [showThinking, setShowThinking] = useState(false)
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
      createSlashCommandRegistry({
        cwd: process.cwd(),
        taskManager,
        plan: planSession,
        promptProfile: { get: () => promptProfile, set: setPromptProfile },
        status: {
          get: () =>
            (() => {
              const base = createStatusSnapshot({
                version: String((pkg as any)?.version || 'unknown'),
                cwd: process.cwd(),
                runtime: {
                  llm: {
                    provider: cfg.llm.provider,
                    baseUrl: cfg.llm.baseUrl,
                    model: cfg.llm.model,
                    timeoutMs: cfg.llm.timeoutMs,
                    apiKey: cfg.llm.apiKey,
                  },
                  paths: cfg.paths,
                  ui: { promptProfile, assistantTextMode: cfg.ui.assistantTextMode },
                },
                workspaceRoots,
              })

              if (!workspaceRootWarnings.length) return base
              return { ...base, warnings: [...base.warnings, ...workspaceRootWarnings] }
            })(),
        },
        doctor: {
          run: async () => {
            const store = createNodeFileStore()
            const shown = await configShow({
              fileStore: store,
              cwd: process.cwd(),
              env: process.env,
              platform: process.platform,
            })
            const report = await runDoctor({
              version: String((pkg as any)?.version || 'unknown'),
              cwd: process.cwd(),
              provider: shown.config.llm.provider,
              runtime: {
                llm: { apiKey: cfg.llm.apiKey, baseUrl: cfg.llm.baseUrl, model: cfg.llm.model },
                paths: cfg.paths,
              },
              config: { paths: shown.paths, files: shown.files },
              warnings: shown.warnings,
              testConnection: testSetupConnection,
              checkWritableDir,
            })
            return formatDoctorHuman({
              version: report.version,
              cwd: report.cwd,
              checks: report.checks,
              warnings: report.warnings,
            }) + '\n'
          },
        },
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

  const isPromptMode = useMemo(() => {
    if (state.agentsDialogOpen) return true
    if (!userInput) return false
    const alwaysInteractive = new Set(['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'])
    return state.transientMessages.some((m) => {
      if (m.role !== 'tool' || m.toolInfo?.status !== 'running') return false
      const toolUseId = m.toolInfo.toolUseId || (m.id.startsWith('tool-') ? m.id.slice('tool-'.length) : m.id)
      const interactive = toolRegistry?.getMeta(m.toolInfo.name)?.interactive ?? alwaysInteractive.has(m.toolInfo.name)
      if (m.toolInfo.name === 'Task' && Array.isArray(m.toolInfo.nestedTools)) {
        return m.toolInfo.nestedTools.some((t) => Boolean(t?.id) && userInput.isPending(String(t.id)))
      }
      return interactive || userInput.isPending(toolUseId)
    })
  }, [state.agentsDialogOpen, state.transientMessages, toolRegistry, userInput])

  const slashSuggestions = useMemo(() => {
    if (isPromptMode) return []
    return commandRegistry.suggest(input).slice(0, 10)
  }, [commandRegistry, input, isPromptMode])

  const selectedSlash = slashSuggestions[slashIndex]?.command

  const handleInputChange = useCallback((v: string) => {
    setInput(v)
    setSlashIndex(0)
  }, [])

  useInput((inputKey, key) => {
    if (key.ctrl && inputKey === 'c') {
      actions.abort()
      onExit ? onExit() : process.exit(0)
    }

    if (key.ctrl && inputKey === 'o') {
      if (!state.isLoading) return
      if (!state.thinkingText.trim()) return
      setShowThinking((v) => !v)
      return
    }

    if (key.escape) {
      if (state.agentsDialogOpen) return
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
        setSlashIndex((i) => Math.min(i + 1, slashSuggestions.length - 1))
      } else if (key.upArrow) {
        setSlashIndex((i) => Math.max(i - 1, 0))
      } else if (key.tab && selectedSlash) {
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
    const messages = state.staticMessages.map((m) => ({ key: m.id, jsx: renderMessage(m) }))
    return [header, ...messages]
  }, [modelLabel, renderMessage, state.staticMessages])

  const showLoadingBlock = useMemo(() => {
    if (!state.isLoading || isPromptMode) return false

    const hasStreamingAssistant = state.transientMessages.some(
      (m) => m.role === 'assistant' && Boolean(m.isStreaming),
    )
    if (hasStreamingAssistant) return false

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

function formatTokens(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  if (v < 1000) return String(v)
  if (v < 100000) return `${(v / 1000).toFixed(1).replace(/\\.0$/, '')}k`
  if (v < 1000000) return `${Math.round(v / 1000)}k`
  return `${(v / 1000000).toFixed(1).replace(/\\.0$/, '')}m`
}
