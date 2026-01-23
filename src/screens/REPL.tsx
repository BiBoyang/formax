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
import { getTheme } from '../utils/theme'
import { runDoctor } from '../core/diagnostics/doctor'
import { formatDoctorHuman } from '../core/diagnostics/format'
import { createStatusSnapshot } from '../core/diagnostics/status'
import { testSetupConnection } from '../adapters/setup/connectionTest'
import { checkWritableDir } from '../adapters/fs/checkWritableDir'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore'
import { detectWorkspaceRoots } from '../adapters/fs/workspaceRoots'
import { configShow } from '../core/config/show'
import { AgentsDialog } from '../ui/agents/AgentsDialog'
import { PermissionsDialog } from '../ui/permissions/PermissionsDialog'
import { getConfigPaths } from '../adapters/fs/configPaths'
import { useScopedInput } from '../features/repl/inputScopeContext'
import type { TokenUsage } from '../streaming/types'

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
    if (state.permissionsDialogOpen) return true
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
  }, [state.agentsDialogOpen, state.permissionsDialogOpen, state.transientMessages, toolRegistry, userInput])

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
        if (normalized !== selectedSlash.command && !normalized.startsWith(selectedSlash.command + ' ')) {
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
          <Box flexDirection="column" marginTop={0} marginBottom={0}>
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
            <Static items={staticItems}>
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

export type MessageItemDescriptor =
  | { kind: 'message'; key: string; message: Msg }
  | { kind: 'explore-group'; key: string; tasks: Msg[] }

export function deriveMessageItemDescriptors(
  messages: Msg[],
  opts: { groupExploreTasks: boolean },
): MessageItemDescriptor[] {
  if (!opts.groupExploreTasks) {
    return messages.map((message) => ({ kind: 'message', key: message.id, message }))
  }

  const items: MessageItemDescriptor[] = []

  let i = 0
  while (i < messages.length) {
    const group = findContiguousExploreTaskGroupFrom(messages, i)
    if (group && group.tasks.length >= 2) {
      const groupId = exploreGroupId(group.tasks[0]!.id)
      items.push({ kind: 'explore-group', key: groupId, tasks: group.tasks })
      i = group.end + 1
      continue
    }

    const message = messages[i]!
    items.push({ kind: 'message', key: message.id, message })
    i++
  }

  return items
}

function formatTokens(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  if (v < 1000) return String(v)
  if (v < 100000) return `${(v / 1000).toFixed(1).replace(/\\.0$/, '')}k`
  if (v < 1000000) return `${Math.round(v / 1000)}k`
  return `${(v / 1000000).toFixed(1).replace(/\\.0$/, '')}m`
}

function exploreGroupId(firstTaskMsgId: string): string {
  return `explore-group-${firstTaskMsgId}`
}

function isExploreTaskMessage(msg: Msg | undefined): msg is Msg {
  if (!msg) return false
  if (msg.role !== 'tool') return false
  if (msg.toolInfo?.name !== 'Task') return false
  if (msg.toolInfo?.status === 'running') return false
  const subagentType = (msg.toolInfo?.input as any)?.subagent_type
  return String(subagentType || '') === 'Explore'
}

function findContiguousExploreTaskGroupFrom(
  messages: Msg[],
  startIndex: number,
): { tasks: Msg[]; start: number; end: number } | null {
  if (!isExploreTaskMessage(messages[startIndex])) return null
  let end = startIndex
  while (end + 1 < messages.length && isExploreTaskMessage(messages[end + 1]!)) end++
  return { tasks: messages.slice(startIndex, end + 1), start: startIndex, end }
}

function findLastContiguousExploreTaskGroup(messages: Msg[]): { tasks: Msg[]; start: number; end: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!isExploreTaskMessage(messages[i])) continue
    let start = i
    while (start - 1 >= 0 && isExploreTaskMessage(messages[start - 1]!)) start--
    return { tasks: messages.slice(start, i + 1), start, end: i }
  }
  return null
}

function sumTokens(usage: TokenUsage | undefined): number {
  const u = usage || {}
  return (
    (u.input_tokens ?? 0) +
    (u.output_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0)
  )
}

function getTaskShortLabel(msg: Msg): string {
  const input = (msg.toolInfo?.input || {}) as any
  const description = typeof input?.description === 'string' ? input.description.trim() : ''
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : ''
  return description || prompt || 'Task'
}

function truncate(s: string, max: number): string {
  const str = String(s || '')
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}

function ExploreAgentsPanel({ tasks }: { tasks: Msg[] | null }): React.ReactNode {
  const theme = getTheme()
  const safeTasks = Array.isArray(tasks) ? tasks : []

  if (safeTasks.length === 0) {
    return (
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>No Explore details available</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column">
        {safeTasks.map((t, idx) => {
          const last = idx === safeTasks.length - 1
          const branch = last ? '└─' : '├─'
          const pipe = last ? ' ' : '│'

          const toolUses = typeof t.toolInfo?.toolUses === 'number' ? t.toolInfo.toolUses : null
          const tokens = formatTokens(sumTokens(t.toolInfo?.usage))

          const statsParts: string[] = []
          if (toolUses !== null) statsParts.push(`${toolUses} tool use${toolUses === 1 ? '' : 's'}`)
          if (tokens !== '0') statsParts.push(`${tokens} tokens`)

          const stats = statsParts.length ? ` · ${statsParts.join(' · ')}` : ''

          const rawLabel = getTaskShortLabel(t)
          const baseLabel = /^Explore\b/i.test(rawLabel) ? rawLabel : `Explore ${rawLabel}`
          const label = truncate(baseLabel, 70)
          const line = `${label}${stats}`

          const doneWord =
            t.toolInfo?.status === 'running' ? 'Working' : t.toolInfo?.status === 'error' ? 'Error' : 'Done'

          return (
            <Box key={t.id} flexDirection="column">
              <Text>
                <Text color={theme.secondaryText}>  {branch} </Text>
                <Text>{line}</Text>
              </Text>
              <Text color={theme.secondaryText}>
                {'  '}
                {pipe}  ⎿  {doneWord}
              </Text>
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Showing Explore agents · ctrl+o to toggle</Text>
      </Box>
    </Box>
  )
}

function formatTaskPanelTitle(msg: Msg): string {
  if (msg.role !== 'tool' || msg.toolInfo?.name !== 'Task') return 'Task'
  const input = (msg.toolInfo.input || {}) as any
  const subagentType = typeof input?.subagent_type === 'string' ? input.subagent_type.trim() : ''
  const toolLabel = subagentType ? (subagentType === 'code-reviewer' ? 'Reviewer' : subagentType) : 'Task'
  const description = typeof input?.description === 'string' ? input.description.trim() : ''
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : ''
  const params = truncate(description || prompt || '', 60)
  return params ? `${toolLabel}(${params})` : toolLabel
}

function DetailedTranscriptPanel({
  title,
  lines,
}: {
  title: string | null
  lines: string[] | null
}): React.ReactNode {
  const theme = getTheme()
  const safeLines = Array.isArray(lines) ? lines : []

  return (
    <Box flexDirection="column" marginTop={1}>
      {title ? (
        <Box>
          <Text color={theme.secondaryText}>⎿  </Text>
          <Text>{title}</Text>
        </Box>
      ) : null}

      {safeLines.length > 0 ? (
        <Box flexDirection="column">
          {safeLines.map((line, idx) => {
            if (line === '') {
              return (
                <Box key={idx}>
                  <Text color={theme.secondaryText}>⎿  </Text>
                  <Text> </Text>
                </Box>
              )
            }
            return (
              <Box key={idx}>
                <Text color={theme.secondaryText}>⎿  </Text>
                <Text>{line}</Text>
              </Box>
            )
          })}
        </Box>
      ) : (
        <Box>
          <Text color={theme.secondaryText}>⎿  </Text>
          <Text color={theme.secondaryText}>No detailed transcript available</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Showing detailed transcript · ctrl+o to toggle</Text>
      </Box>
    </Box>
  )
}
