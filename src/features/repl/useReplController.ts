import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEngine, ChatHistory } from '../../chat/engine'
import { buildSystemPrompt, buildUserContent } from '../../prompts'
import type { ToolDefinition } from '../../tools/types'
import type { RuntimeConfig } from '../../env/config'
import type { StreamEvent, TokenUsage } from '../../streaming/types'
import type { Msg } from '../../components/tool/ToolMessage'
import { formatToolResult } from '../../utils/toolFormatting'
import type { PromptBlock } from '../../prompts'
import type { ReplMode } from './mode'
import type { SlashCommandRegistry } from '../commands/registry'
import type { PlanSessionManager } from './planSession'
import { buildExitedPlanModeSystemReminder, buildPlanModeSystemReminder } from '../../utils/planMode'
import type { SystemPromptProfile } from '../../prompts/system'
import { ReminderService } from './reminders/ReminderService'
import { computeContextStats, type ContextBudgetConfig } from '../../chat/context/budget'
import { estimatePromptTokens } from '../../chat/context/estimate'
import { getKnownContextWindowTokens } from '../../chat/context/modelWindow'
import { pruneForPromptBudget } from '../../chat/context/prune'
import { rebuildHistoryAfterCompaction } from '../../chat/context/compact'
import { useUserInputManager } from '../../tools/runtime/userInputContext'
import { createAgentFromWizardAnswers, generateAgentDraftWithClaude } from '../../subagents/agentsWizard'
import { slashEffectToCommandResult, isSlashCommandResultData } from '../commands/adapter'
import { isConsumedCommandResult } from '../commands/contracts'
import { createOverlayManager } from './overlays/OverlayManager'
import { buildLocalCommandInjectedBlocks } from './injectedBlocks'
import type {
  AgentsDialogGenerateDraft,
  AgentsDialogSaveArgs,
  AgentsDialogSaveResult,
} from '../../ui/AgentsDialog'
import { buildSkillToolSpecForCwd } from '../../tools/modules/skill'

export type ReplControllerState = {
  messages: Msg[]
  staticMessages: Msg[]
  transientMessages: Msg[]
  isLoading: boolean
  loadingText: string
  thinkingText: string
  error: string | null
  allowedSubagents: Array<{ name: string; description: string }>
  agentsDialogOpen: boolean
  context: null | {
    usedTokens: number
    limitTokens: number
    percentRemaining: number
    source: 'estimate' | 'usage'
  }
}

export type ReplController = {
  state: ReplControllerState
  actions: {
    send: (text: string, opts?: { preferredSlashSpecId?: string }) => Promise<void>
    abort: () => void
    closeAgentsDialog: (args: { createdAgents: string[] }) => void
    generateAgentDraft: (description: string, signal?: AbortSignal) => Promise<AgentsDialogGenerateDraft>
    saveAgentFromDialog: (args: AgentsDialogSaveArgs) => Promise<AgentsDialogSaveResult>
  }
}

type ExploreTaskBatch = {
  toolUseIds: Set<string>
  completedToolUseIds: Set<string>
  lastSeenAtMs: number
}

function isAbortLikeError(err: unknown): boolean {
  if (!err) return false
  const e = err as { name?: unknown; message?: unknown }
  const name = typeof e.name === 'string' ? e.name : ''
  const message = typeof e.message === 'string' ? e.message : ''
  if (name === 'AbortError') return true
  if (message === 'Stream aborted' || message === 'Request aborted') return true
  return /aborted/i.test(message)
}

export function useReplController(deps: {
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  allowedSubagents?: Array<{ name: string; description: string }>
  reloadSubagents?: () => Promise<Array<{ name: string; description: string }>>
  mode: ReplMode
  promptProfile?: SystemPromptProfile
  onModeChange?: (mode: ReplMode) => void
  commandRegistry?: SlashCommandRegistry
  planSession?: PlanSessionManager
}): ReplController {
  const [messages, setMessages] = useState<Msg[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('Thinking')
  const [thinkingText, setThinkingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<ReplControllerState['context']>(null)
  const [allowedSubagents, setAllowedSubagents] = useState(deps.allowedSubagents ?? [])
  const overlayManagerRef = useRef(
    createOverlayManager(process.env.FORMAX_START_AGENTS_DIALOG === '1' ? { kind: 'agents' } : null),
  )
  const [overlay, setOverlay] = useState(overlayManagerRef.current.current())

  const assistantTextMode = deps.cfg.ui.assistantTextMode
  const historyRef = useRef<ChatHistory>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentAssistantIdRef = useRef<string | null>(null)
  const assistantBufferRef = useRef<string>('')
  const thinkingBufferRef = useRef<string>('')
  const thinkingLastFlushAtRef = useRef(0)
  const toolNameByIdRef = useRef<Map<string, string>>(new Map())
  const taskStatsByToolUseIdRef = useRef<
    Map<string, { startedAt: number; toolUses: number; usage?: TokenUsage }>
  >(new Map())
  const taskKindByToolUseIdRef = useRef<Map<string, 'explore' | 'other'>>(new Map())
  const exploreBatchRef = useRef<ExploreTaskBatch | null>(null)
  const modeRef = useRef<ReplMode>(deps.mode)
  const prevModeRef = useRef<ReplMode>(deps.mode)
  const pendingExitPlanReminderRef = useRef(false)
  const reminderServiceRef = useRef<ReminderService | null>(null)
  const contextBudgetConfigRef = useRef<ContextBudgetConfig | null>(null)
  const sendSeqRef = useRef(0)
  const lastAutoCompactSeqRef = useRef(-1_000_000)
  const userInput = useUserInputManager()
  const pendingInjectedBlocksRef = useRef<PromptBlock[]>([])

  useEffect(() => overlayManagerRef.current.subscribe(setOverlay), [])

  const closeAgentsDialog = useCallback(({ createdAgents }: { createdAgents: string[] }) => {
    overlayManagerRef.current.close()
    const lines =
      createdAgents.length === 0
        ? ['Agents dialog dismissed']
        : ['Agent changes:', ...createdAgents.map((a) => `Created agent: ${a}`)]
    setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: lines.map((l) => `  ⎿  ${l}`).join('\n'),
        timestamp: new Date(),
      },
    ])
  }, [])

  const generateAgentDraft = useCallback(
    async (description: string, signal?: AbortSignal): Promise<AgentsDialogGenerateDraft> => {
      return generateAgentDraftWithClaude({
        engine: deps.engine,
        description,
        cwd: process.cwd(),
        signal,
      })
    },
    [deps.engine],
  )

  const saveAgentFromDialog = useCallback(
    async (args: AgentsDialogSaveArgs): Promise<AgentsDialogSaveResult> => {
      const out = await createAgentFromWizardAnswers({
        answers: {
          scope:
            args.scope === 'user'
              ? 'User-level (~/.formax/agents)'
              : 'Project-level (.formax/agents)',
          name: args.name,
          description: args.description,
          systemPrompt: args.systemPrompt,
          tools: args.tools,
          model: args.model,
          color: args.color,
        },
        cwd: process.cwd(),
        projectAgentsDir: deps.cfg.paths.subagentsDir,
      })

      try {
        const next = await deps.reloadSubagents?.()
        if (next) setAllowedSubagents(next)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: `Note: agent created but reload failed: ${msg}`,
            timestamp: new Date(),
          },
        ])
      }

      if (args.openInEditor) {
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: `Saved agent: ${out.name} (${out.filePath}). Open this file in your editor to make edits.`,
            timestamp: new Date(),
          },
        ])
      }

      return out
    },
    [deps.cfg.paths.subagentsDir, deps.reloadSubagents],
  )

  useEffect(() => {
    setAllowedSubagents(deps.allowedSubagents ?? [])
  }, [deps.allowedSubagents])

  useEffect(() => {
    modeRef.current = deps.mode
    const prev = prevModeRef.current
    if (prev === 'plan' && deps.mode !== 'plan') {
      pendingExitPlanReminderRef.current = true
    }
    prevModeRef.current = deps.mode
  }, [deps.mode])

  const setReplMode = useCallback(
    (nextMode: ReplMode) => {
      modeRef.current = nextMode
      deps.onModeChange?.(nextMode)
    },
    [deps.onModeChange],
  )

  const { staticMessages, transientMessages } = useMemo(() => {
    const isTransient = (m: Msg) =>
      (m.role === 'tool' && m.toolInfo?.status === 'running') || Boolean(m.isStreaming)

    return {
      staticMessages: messages.filter((m) => !isTransient(m)),
      transientMessages: messages.filter((m) => isTransient(m)),
    }
  }, [messages])

  const flushAssistantBuffer = useCallback(() => {
    const text = assistantBufferRef.current
    if (!text) return
    assistantBufferRef.current = ''
    setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: text,
        timestamp: new Date(),
      },
    ])
  }, [])

  const handleEvent = useCallback((ev: StreamEvent) => {
    switch (ev.type) {
      case 'assistant_delta': {
        if (assistantTextMode === 'buffered') {
          assistantBufferRef.current += ev.text
          return
        }

        setMessages((prev) => {
          const existingId = currentAssistantIdRef.current

          if (!existingId) {
            const assistantId = `assistant-${Date.now()}`
            currentAssistantIdRef.current = assistantId
            return [
              ...prev,
              {
                id: assistantId,
                role: 'assistant',
                content: ev.text,
                timestamp: new Date(),
                isStreaming: true,
              },
            ]
          }

          return prev.map((m) =>
            m.id === existingId
              ? { ...m, content: m.content + ev.text, isStreaming: true }
              : m,
          )
        })
        return
      }

      case 'thinking_delta': {
        thinkingBufferRef.current += ev.thinking
        const now = Date.now()
        if (now - thinkingLastFlushAtRef.current > 200) {
          thinkingLastFlushAtRef.current = now
          setThinkingText(thinkingBufferRef.current)
        }
        return
      }

      case 'usage': {
        const cfg = contextBudgetConfigRef.current
        if (!cfg) return

        const usedTokens = sumInputTokens(ev.usage)
        const stats = computeContextStats({ config: cfg, usedTokens })
        setContext({
          usedTokens: stats.usedTokens,
          limitTokens: stats.effectiveLimitTokens,
          percentRemaining: stats.percentRemaining,
          source: 'usage',
        })
        return
      }

      case 'tool_start': {
        if (assistantTextMode === 'buffered') {
          flushAssistantBuffer()
        } else {
          // Freeze any currently-streaming assistant message before tool
          if (currentAssistantIdRef.current) {
            const id = currentAssistantIdRef.current
            setMessages((prev) =>
              prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)),
            )
            currentAssistantIdRef.current = null
          }
        }

        toolNameByIdRef.current.set(ev.id, ev.name)
        if (ev.name === 'Task') {
          taskStatsByToolUseIdRef.current.set(ev.id, { startedAt: Date.now(), toolUses: 0, usage: {} })
          taskKindByToolUseIdRef.current.set(ev.id, 'other')
        }
        setLoadingText(ev.name === 'AskUserQuestion' ? 'Waiting' : 'Working')

        const toolMsgId = `tool-${ev.id}`
        setMessages((prev) => [
          ...prev,
          {
            id: toolMsgId,
            role: 'tool',
            content: '',
            timestamp: new Date(),
            toolInfo: {
              name: ev.name,
              toolUseId: ev.id,
              input: {},
              status: 'running',
            },
          },
        ])
        return
      }

      case 'tool_input': {
        const toolMsgId = `tool-${ev.id}`
        const toolName = toolNameByIdRef.current.get(ev.id)

        if (toolName === 'Task') {
          const subagentType = (ev.input as any)?.subagent_type
          const isExplore = String(subagentType || '') === 'Explore'
          taskKindByToolUseIdRef.current.set(ev.id, isExplore ? 'explore' : 'other')

          if (isExplore) {
            const now = Date.now()
            const prevBatch = exploreBatchRef.current
            const withinWindow = prevBatch && now - prevBatch.lastSeenAtMs < 1500
            const batch: ExploreTaskBatch =
              withinWindow && prevBatch
                ? prevBatch
                : { toolUseIds: new Set(), completedToolUseIds: new Set(), lastSeenAtMs: now }
            batch.toolUseIds.add(ev.id)
            batch.lastSeenAtMs = now
            exploreBatchRef.current = batch
          }
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === toolMsgId ? { ...m, toolInfo: { ...m.toolInfo!, input: ev.input as any } } : m,
          ),
        )
        return
      }

      case 'tool_update': {
        const toolMsgId = `tool-${ev.id}`
        const toolName = toolNameByIdRef.current.get(ev.id)

        if (typeof ev.toolUses === 'number') {
          const existing = taskStatsByToolUseIdRef.current.get(ev.id)
          if (existing) {
            existing.toolUses = ev.toolUses
          } else {
            taskStatsByToolUseIdRef.current.set(ev.id, { startedAt: Date.now(), toolUses: ev.toolUses, usage: {} })
          }
        }

        if (ev.usage) {
          const existing = taskStatsByToolUseIdRef.current.get(ev.id)
          if (existing) {
            existing.usage = ev.usage
          } else {
            taskStatsByToolUseIdRef.current.set(ev.id, { startedAt: Date.now(), toolUses: 0, usage: ev.usage })
          }
        }

        if (
          ev.middleLines ||
          ev.nestedTools ||
          ev.transcriptLines ||
          (toolName === 'Task' && (typeof ev.toolUses === 'number' || ev.usage))
        ) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === toolMsgId
                ? {
                    ...m,
                    toolInfo: {
                      ...m.toolInfo!,
                      ...(ev.middleLines ? { middleLines: ev.middleLines } : {}),
                      ...(ev.transcriptLines ? { transcriptLines: ev.transcriptLines } : {}),
                      ...(ev.nestedTools ? { nestedTools: ev.nestedTools } : {}),
                      ...(toolName === 'Task' && typeof ev.toolUses === 'number' ? { toolUses: ev.toolUses } : {}),
                      ...(toolName === 'Task' && ev.usage ? { usage: ev.usage } : {}),
                    },
                  }
                : m,
            ),
          )
        }

        return
      }

      case 'tool_end': {
        const toolMsgId = `tool-${ev.id}`
        const toolNameFromStart = toolNameByIdRef.current.get(ev.id)
        toolNameByIdRef.current.delete(ev.id)
        const taskKind = taskKindByToolUseIdRef.current.get(ev.id)
        taskKindByToolUseIdRef.current.delete(ev.id)

        setMessages((prev) => {
          const toolMsg = prev.find((m) => m.id === toolMsgId)
          const toolName = toolNameFromStart || toolMsg?.toolInfo?.name || 'Tool'

          const rawResult = ev.result.content
          const displayResult =
            ev.result.is_error && rawResult.startsWith('Error: ')
              ? rawResult.slice('Error: '.length)
              : rawResult

          if (toolName === 'Task') {
            const stats = taskStatsByToolUseIdRef.current.get(ev.id)
            taskStatsByToolUseIdRef.current.delete(ev.id)
            const startedAt = stats?.startedAt ?? Date.now()
            const durationMs = Date.now() - startedAt

            const tokens = formatTokenTotal(stats?.usage)
            const backgroundTaskId = parseBackgroundTaskId(rawResult)
            const parsedTranscript = parseTaskTranscript(rawResult)
            const doneText = ev.result.is_error
              ? displayResult || 'Error'
              : backgroundTaskId
                ? `Started (task_id: ${backgroundTaskId})`
                : `Done (${formatToolUses(stats?.toolUses ?? 0)}${tokens ? ` · ${tokens} tokens` : ''} · ${formatDuration(
                    durationMs,
                  )})`

            return prev.map((m) =>
              m.id === toolMsgId
                ? {
                    ...m,
                    content: doneText,
                    toolInfo: {
                      ...m.toolInfo!,
                      status: ev.result.is_error ? 'error' : 'completed',
                      result: rawResult,
                      ...(parsedTranscript ? { transcriptLines: parsedTranscript } : {}),
                      ...(stats ? { toolUses: stats.toolUses, usage: stats.usage, durationMs } : { durationMs }),
                    },
                  }
                : m,
            )
          }

          const { summary, middleLines, expandInfo, lines } = formatToolResult(
            toolName,
            displayResult,
            Boolean(ev.result.is_error),
          )

          return prev.map((m) =>
            m.id === toolMsgId
              ? {
                  ...m,
                  content: summary,
                  toolInfo: {
                    ...m.toolInfo!,
                    status: ev.result.is_error ? 'error' : 'completed',
                    result: rawResult,
                    resultLines: lines,
                    expandInfo,
                    middleLines,
                  },
                }
              : m,
          )
        })

        if (toolNameFromStart === 'Task' && taskKind === 'explore') {
          const batch = exploreBatchRef.current
          if (batch && batch.toolUseIds.has(ev.id)) {
            batch.completedToolUseIds.add(ev.id)
            batch.lastSeenAtMs = Date.now()

            if (batch.toolUseIds.size >= 2 && batch.completedToolUseIds.size === batch.toolUseIds.size) {
              exploreBatchRef.current = null
              const count = batch.toolUseIds.size
              setMessages((prev) => [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: `${count} Explore agents finished (ctrl+o to expand)`,
                  timestamp: new Date(),
                },
              ])
            }
          }
        }

        reminderServiceRef.current?.recordToolResult({
          toolName: toolNameFromStart || 'Tool',
          ok: !ev.result.is_error,
        })

        // After tool, start a new assistant message for subsequent text
        currentAssistantIdRef.current = null

        return
      }

      case 'error': {
        if (isAbortLikeError(ev.error)) {
          return
        }
        setError(ev.error.message)
        return
      }

      case 'complete': {
        if (assistantTextMode === 'buffered') {
          flushAssistantBuffer()
        } else {
          if (currentAssistantIdRef.current) {
            const id = currentAssistantIdRef.current
            setMessages((prev) =>
              prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)),
            )
            currentAssistantIdRef.current = null
          }
        }

        setThinkingText(thinkingBufferRef.current)
        return
      }

      default:
        return
    }
  }, [assistantTextMode, flushAssistantBuffer])

  const abort = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null

    assistantBufferRef.current = ''
    thinkingBufferRef.current = ''
    thinkingLastFlushAtRef.current = 0
    setThinkingText('')
    setIsLoading(false)
    setError(null)

    if (currentAssistantIdRef.current) {
      const id = currentAssistantIdRef.current
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)))
      currentAssistantIdRef.current = null
    }

    setMessages((prev) => {
      const isAskRunning = (m: Msg) =>
        m.role === 'tool' && m.toolInfo?.name === 'AskUserQuestion' && m.toolInfo?.status === 'running'

      const hadAsk = prev.some(isAskRunning)
      const next = prev.filter((m) => !isAskRunning(m))

      if (hadAsk) {
        next.push({
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'User declined to answer questions',
          timestamp: new Date(),
        })
      }

      return next
    })
  }, [])

  const send = useCallback(
    async (value: string, opts?: { preferredSlashSpecId?: string }) => {
      const text = value.trim()
      if (!text || isLoading) return

      const provider = (deps.cfg.llm as any).provider === 'openai' ? 'openai' : 'anthropic'

      if (isExactSlashCommand(text, '/compact')) {
        const userMsg: Msg = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, userMsg])

        setIsLoading(true)
        setLoadingText('Compacting')
        thinkingBufferRef.current = ''
        thinkingLastFlushAtRef.current = 0
        setThinkingText('')
        setError(null)
        currentAssistantIdRef.current = null

        const abortController = new AbortController()
        abortControllerRef.current = abortController
        assistantBufferRef.current = ''
        contextBudgetConfigRef.current = null

        try {
          const promptProfile = deps.promptProfile ?? deps.cfg.ui.promptProfile
          const cwd = process.cwd()
          const previousHistory = historyRef.current

          const system = buildSystemPrompt({
            allowedSubagents,
            cwd,
            model: deps.cfg.llm.model,
            profile: promptProfile,
          })

          const contextWindowTokens =
            deps.cfg.llm.contextWindowTokens ??
            getKnownContextWindowTokens({ provider, model: deps.cfg.llm.model })

          contextBudgetConfigRef.current = contextWindowTokens
            ? {
                contextWindowTokens,
                effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
                autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
                baselineTokens: deps.cfg.context.baselineTokens,
              }
            : null

          const instructions = text.replace(/^\/compact\b/i, '').trim()
          const compactUser: ChatHistory[number] = {
            role: 'user',
            content: [
              {
                type: 'text',
                text: buildCompactRequest(instructions),
              },
            ],
          }

          const compactSink = (ev: StreamEvent) => {
            if (
              ev.type === 'thinking_delta' ||
              ev.type === 'usage' ||
              ev.type === 'error' ||
              ev.type === 'complete'
            ) {
              handleEvent(ev)
            }
          }

          const nextHistory = await deps.engine.runTurn({
            history: previousHistory,
            user: compactUser,
            system,
            tools: [],
            onEvent: compactSink,
            cwd,
            signal: abortController.signal,
            promptBudget: contextBudgetConfigRef.current,
            exec: {
              replMode: deps.mode,
              getReplMode: () => modeRef.current,
              setReplMode,
              getPlanPath: () => deps.planSession?.getPlanPath() ?? null,
            },
          })

          const summary = extractAssistantText(nextHistory).trim()
          if (!summary) throw new Error('Compact failed: empty summary')

          const compacted = rebuildHistoryAfterCompaction({
            summary,
            previousHistory,
            keepLastTurns: deps.cfg.context.compactKeepLastTurns,
          })

          historyRef.current =
            contextWindowTokens
              ? pruneForPromptBudget({
                  system,
                  messages: compacted,
                  contextWindowTokens,
                  effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
                  autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
                  baselineTokens: deps.cfg.context.baselineTokens,
                }).messages
              : compacted

          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: 'Conversation history compacted (summary kept for future turns).',
              timestamp: new Date(),
            },
          ])

          if (contextWindowTokens) {
            const usedTokens = estimatePromptTokens({ system, messages: historyRef.current })
            const stats = computeContextStats({
              config: {
                contextWindowTokens,
                effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
                autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
                baselineTokens: deps.cfg.context.baselineTokens,
              },
              usedTokens,
            })
            setContext({
              usedTokens: stats.usedTokens,
              limitTokens: stats.effectiveLimitTokens,
              percentRemaining: stats.percentRemaining,
              source: 'estimate',
            })
          } else {
            setContext(null)
          }
        } catch (e) {
          if (isAbortLikeError(e)) {
            return
          }
          const msg = e instanceof Error ? e.message : 'Compact failed'
          setError(msg)
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: `Error: ${msg}`,
              timestamp: new Date(),
            },
          ])
        } finally {
          setIsLoading(false)
          abortControllerRef.current = null
        }

        return
      }

      const slashEffect = text.startsWith('/')
        ? deps.commandRegistry?.dispatch(text, { preferredSpecId: opts?.preferredSlashSpecId })
        : null
      const slashResult = slashEffectToCommandResult(slashEffect)
      if (isConsumedCommandResult(slashResult)) {
        const userMsg: Msg = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: text,
          timestamp: new Date(),
        }

        const appended: Msg[] = []
        for (const eff of slashResult.ui ?? []) {
          if (eff.type === 'appendMessages') {
            for (const m of eff.messages) {
              appended.push({
                id: m.id ?? `assistant-${Date.now()}`,
                role: 'assistant',
                content: m.content,
                timestamp: m.timestamp ?? new Date(),
              })
            }
          } else if (eff.type === 'openOverlay') {
            overlayManagerRef.current.open(eff.overlay)
          } else if (eff.type === 'closeOverlay') {
            overlayManagerRef.current.close()
          } else if (eff.type === 'toast') {
            appended.push({
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: eff.message,
              timestamp: new Date(),
            })
          }
        }

        for (const eff of slashResult.model ?? []) {
          if (eff.type === 'injectNextTurn') pendingInjectedBlocksRef.current.push(...eff.blocks)
        }

        const data = isSlashCommandResultData(slashResult.data) ? slashResult.data : null
        if (data?.kind !== 'llm') {
          setMessages((prev) => [...prev, userMsg, ...appended])
        }

        if (data?.kind === 'local_async') {
          setIsLoading(true)
          setLoadingText(data.loadingText || 'Working')
          thinkingBufferRef.current = ''
          thinkingLastFlushAtRef.current = 0
          setThinkingText('')
          setError(null)
          currentAssistantIdRef.current = null

          try {
            const out = await data.run()
            if (out.recordForNextTurn) {
              pendingInjectedBlocksRef.current.push(...buildLocalCommandInjectedBlocks(out.recordForNextTurn))
            }
            setMessages((prev) => [
              ...prev,
              {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: out.stdout,
                timestamp: new Date(),
              },
            ])
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Command failed'
            setMessages((prev) => [
              ...prev,
              {
                id: `error-${Date.now()}`,
                role: 'assistant',
                content: `Error: ${msg}`,
                timestamp: new Date(),
              },
            ])
          } finally {
            setIsLoading(false)
          }

          return
        }

        if (data?.kind === 'llm') {
          // Continue into the LLM streaming path, using the provided blocks.
        } else {
          return
        }
      }

      const userMsg: Msg = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, userMsg])
      setIsLoading(true)
      setLoadingText(slashEffect?.kind === 'llm' ? slashEffect.loadingText || 'Thinking' : 'Thinking')
      thinkingBufferRef.current = ''
      thinkingLastFlushAtRef.current = 0
      setThinkingText('')
      setError(null)
      currentAssistantIdRef.current = null

      const abortController = new AbortController()
      abortControllerRef.current = abortController
      assistantBufferRef.current = ''
      contextBudgetConfigRef.current = null
      const sendSeq = (sendSeqRef.current += 1)

      try {
        if (!reminderServiceRef.current) reminderServiceRef.current = new ReminderService()

        const promptProfile = deps.promptProfile ?? deps.cfg.ui.promptProfile
        const planPath =
          deps.mode === 'plan'
            ? deps.planSession?.getPlanPath() ?? deps.planSession?.startNewPlan() ?? null
            : deps.planSession?.getPlanPath() ?? null

        const cwd = process.cwd()
        const injectedBlocks: PromptBlock[] = [
          ...(promptProfile === 'full' ? reminderServiceRef.current.generateInjectedBlocks({ cwd }) : []),
          ...buildModeInjectedBlocks(deps.mode, planPath),
          ...(pendingExitPlanReminderRef.current ? buildExitPlanInjectedBlocks(planPath) : []),
          ...pendingInjectedBlocksRef.current,
        ]
        pendingInjectedBlocksRef.current = []

        const user =
          slashEffect?.kind === 'llm'
            ? { role: 'user' as const, content: [...injectedBlocks, ...slashEffect.blocks] }
            : { role: 'user' as const, content: [...injectedBlocks, ...buildUserContent(text)] }

        const system = buildSystemPrompt({
          allowedSubagents,
          cwd,
          model: deps.cfg.llm.model,
          profile: promptProfile,
        })

        const contextWindowTokens =
          deps.cfg.llm.contextWindowTokens ??
          getKnownContextWindowTokens({ provider, model: deps.cfg.llm.model })

        contextBudgetConfigRef.current = contextWindowTokens
          ? {
              contextWindowTokens,
              effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
              autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
              baselineTokens: deps.cfg.context.baselineTokens,
            }
          : null

        if (
          deps.cfg.context.enableAutoCompact &&
          contextWindowTokens &&
          historyRef.current.length > 0 &&
          countNonToolUserTurns(historyRef.current) >= 2 &&
          sendSeq - lastAutoCompactSeqRef.current >= deps.cfg.context.autoCompactMinTurnsBetweenRuns
        ) {
          const usedTokens = estimatePromptTokens({ system, messages: [...historyRef.current, user] })
          const stats = computeContextStats({
            config: {
              contextWindowTokens,
              effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
              autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
              baselineTokens: deps.cfg.context.baselineTokens,
            },
            usedTokens,
          })

          if (stats.shouldAutoCompact) {
            const previousHistory = historyRef.current
            const compactUser: ChatHistory[number] = {
              role: 'user',
              content: [{ type: 'text', text: buildCompactRequest('') }],
            }

            const compactSink = (ev: StreamEvent) => {
              // Auto-compact runs inside an active turn; forwarding complete/error into the main
              // event handler would incorrectly reset loading state or surface irrelevant errors.
              if (ev.type === 'thinking_delta' || ev.type === 'usage') {
                handleEvent(ev)
              }
            }

            const compactedHistory = await deps.engine.runTurn({
              history: previousHistory,
              user: compactUser,
              system,
              tools: [],
              onEvent: compactSink,
              cwd,
              signal: abortController.signal,
              promptBudget: contextBudgetConfigRef.current,
              exec: {
                replMode: deps.mode,
                getReplMode: () => modeRef.current,
                setReplMode,
                getPlanPath: () => deps.planSession?.getPlanPath() ?? null,
              },
            })

            const summary = extractAssistantText(compactedHistory).trim()
            if (summary) {
              const compacted = rebuildHistoryAfterCompaction({
                summary,
                previousHistory,
                keepLastTurns: deps.cfg.context.compactKeepLastTurns,
              })

              historyRef.current = pruneForPromptBudget({
                system,
                messages: compacted,
                contextWindowTokens,
                effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
                autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
                baselineTokens: deps.cfg.context.baselineTokens,
              }).messages

              lastAutoCompactSeqRef.current = sendSeq
              if (deps.cfg.ui.showAutoCompactNotice) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    content: 'Conversation history auto-compacted (summary kept for future turns).',
                    timestamp: new Date(),
                  },
                ])
              }
            }
          }
        }
        const prunedForTurn = contextWindowTokens
          ? pruneForPromptBudget({
              system,
              messages: [...historyRef.current, user],
              contextWindowTokens,
              effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
              autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
              baselineTokens: deps.cfg.context.baselineTokens,
            })
          : { messages: [...historyRef.current, user], pruned: false }

        const prunedUser = prunedForTurn.messages[prunedForTurn.messages.length - 1]!
        const prunedHistory = prunedForTurn.messages.slice(0, -1)
        historyRef.current = prunedHistory

        if (contextWindowTokens) {
          const usedTokens = estimatePromptTokens({ system, messages: [...prunedHistory, prunedUser] })
          const stats = computeContextStats({
            config: {
              contextWindowTokens,
              effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
              autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
              baselineTokens: deps.cfg.context.baselineTokens,
            },
            usedTokens,
          })
          setContext({
            usedTokens: stats.usedTokens,
            limitTokens: stats.effectiveLimitTokens,
            percentRemaining: stats.percentRemaining,
            source: 'estimate',
          })
        } else {
          setContext(null)
        }

        const exec = {
          replMode: deps.mode,
          getReplMode: () => modeRef.current,
          setReplMode,
          getPlanPath: () => deps.planSession?.getPlanPath() ?? null,
        }
        const historyLen = prunedHistory.length
        const toolsForTurn = patchToolsForTurn(deps.tools, cwd)
        const nextHistory = await deps.engine.runTurn({
          history: prunedHistory,
          user: prunedUser,
          system,
          tools: toolsForTurn,
          onEvent: handleEvent,
          cwd,
          signal: abortController.signal,
          promptBudget: contextBudgetConfigRef.current,
          exec,
        })

        pendingExitPlanReminderRef.current = false

        const stripped =
          injectedBlocks.length > 0
            ? stripInjectedBlocksFromHistory(nextHistory, historyLen, injectedBlocks.length)
            : nextHistory

        historyRef.current =
          contextWindowTokens
            ? pruneForPromptBudget({
                system,
                messages: stripped,
                contextWindowTokens,
                effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
                autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
                baselineTokens: deps.cfg.context.baselineTokens,
              }).messages
            : stripped

        if (contextWindowTokens) {
          const usedTokens = estimatePromptTokens({ system, messages: historyRef.current })
          const stats = computeContextStats({
            config: {
              contextWindowTokens,
              effectiveContextWindowPercent: deps.cfg.context.effectiveContextWindowPercent,
              autoCompactLimitPercent: deps.cfg.context.autoCompactTokenLimitPercent,
              baselineTokens: deps.cfg.context.baselineTokens,
            },
            usedTokens,
          })
          setContext({
            usedTokens: stats.usedTokens,
            limitTokens: stats.effectiveLimitTokens,
            percentRemaining: stats.percentRemaining,
            source: 'estimate',
          })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to send message'
        if (!isAbortLikeError(e)) {
          setError(msg)
          setMessages((prev) => [
            ...prev.filter((m) => !(m.role === 'assistant' && m.content === '')),
            {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: `Error: ${msg}`,
              timestamp: new Date(),
            },
          ])
        }
      } finally {
        setIsLoading(false)
        abortControllerRef.current = null
      }
    },
    [
      allowedSubagents,
      deps.cfg,
      deps.commandRegistry,
      deps.engine,
      deps.mode,
      deps.planSession,
      deps.promptProfile,
      deps.reloadSubagents,
      deps.tools,
      handleEvent,
      isLoading,
      setReplMode,
      userInput,
    ],
  )

  return {
    state: {
      messages,
      staticMessages,
      transientMessages,
      isLoading,
      loadingText,
      thinkingText,
      error,
      allowedSubagents,
      agentsDialogOpen: overlay?.kind === 'agents',
      context,
    },
    actions: {
      send,
      abort,
      closeAgentsDialog,
      generateAgentDraft,
      saveAgentFromDialog,
    },
  }
}

function buildModeInjectedBlocks(mode: ReplMode, planPath: string | null): PromptBlock[] {
  if (mode !== 'plan') return []
  return [
    {
      type: 'text',
      text: buildPlanModeSystemReminder(planPath),
      cache_control: { type: 'ephemeral' },
    },
  ]
}

function patchToolsForTurn(tools: ToolDefinition[], cwd: string): ToolDefinition[] {
  // Some tools (e.g. Skill) depend on the current workspace state and should be
  // regenerated per turn so the model sees up-to-date info.
  return tools.map((t) => (t.name === 'Skill' ? buildSkillToolSpecForCwd(cwd) : t))
}

function buildExitPlanInjectedBlocks(planPath: string | null): PromptBlock[] {
  return [
    {
      type: 'text',
      text: buildExitedPlanModeSystemReminder(planPath),
      cache_control: { type: 'ephemeral' },
    },
  ]
}

function stripInjectedBlocksFromHistory(history: ChatHistory, userIndex: number, injectedCount: number): ChatHistory {
  const msg = history[userIndex]
  if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) return history
  if (injectedCount <= 0) return history
  if (msg.content.length <= injectedCount) return history

  const stripped: ChatHistory[number] = {
    ...msg,
    content: msg.content.slice(injectedCount),
  }

  return [...history.slice(0, userIndex), stripped, ...history.slice(userIndex + 1)]
}

function isExactSlashCommand(input: string, command: string): boolean {
  const raw = String(input || '').trimStart()
  const cmd = String(command || '').trim()
  if (!raw.startsWith('/')) return false
  if (!cmd.startsWith('/')) return false

  const re = new RegExp(`^${escapeRegex(cmd)}(?:\\s|$)`, 'i')
  return re.test(raw)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildCompactRequest(instructions: string): string {
  const extra = instructions.trim()
  return (
    'Summarize the conversation so far for future context.\n\n' +
    'Requirements:\n' +
    '- Preserve user goals, constraints, and preferences.\n' +
    '- Preserve key technical decisions and trade-offs.\n' +
    '- Preserve important file paths, commands, and APIs discussed.\n' +
    '- Preserve open questions and next steps.\n' +
    '- Keep it concise and structured (bullets or short sections).\n' +
    '- Do NOT call tools.\n\n' +
    (extra ? `Additional user instructions:\n${extra}\n\n` : '') +
    'Output only the summary.'
  )
}

function countNonToolUserTurns(history: ChatHistory): number {
  let n = 0
  for (const msg of history) {
    if (!msg || msg.role !== 'user') continue
    const content = (msg as any).content
    if (!Array.isArray(content)) {
      n++
      continue
    }
    const hasToolResult = content.some((b: any) => b?.type === 'tool_result')
    if (!hasToolResult) n++
  }
  return n
}

function extractAssistantText(history: ChatHistory): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (msg?.role !== 'assistant') continue

    const content = (msg as any).content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) continue

    const parts = content
      .map((b: any) => (b?.type === 'text' && typeof b?.text === 'string' ? b.text : ''))
      .filter(Boolean)
    return parts.join('')
  }

  return ''
}

function formatToolUses(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  return `${n} tool use${n === 1 ? '' : 's'}`
}

function formatTokenTotal(usage: TokenUsage | undefined): string | null {
  const total = sumTokens(usage)
  if (total <= 0) return null
  return formatTokens(total)
}

function sumInputTokens(usage: TokenUsage | undefined): number {
  const u = usage || {}
  return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
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

function formatTokens(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  if (v < 1000) return String(v)
  if (v < 100000) return `${(v / 1000).toFixed(1).replace(/\\.0$/, '')}k`
  if (v < 1000000) return `${Math.round(v / 1000)}k`
  return `${(v / 1000000).toFixed(1).replace(/\\.0$/, '')}m`
}

function formatDuration(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function parseBackgroundTaskId(rawResult: string): string | null {
  const text = String(rawResult || '').trim()
  if (!text) return null

  try {
    const parsed = JSON.parse(text)
    const taskId = (parsed as any)?.task_id
    const status = (parsed as any)?.status
    if (typeof taskId === 'string' && taskId.trim() && status === 'running') {
      return taskId.trim()
    }
  } catch {
    // not JSON
  }

  return null
}

function parseTaskTranscript(rawResult: string): string[] | null {
  const text = stripTrailingSystemReminderBlock(String(rawResult || ''))
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    const transcript = (parsed as any)?.transcript
    if (!Array.isArray(transcript)) return null
    const lines = transcript.map((l: any) => String(l ?? ''))
    return lines.length ? lines : null
  } catch {
    return null
  }
}

function stripTrailingSystemReminderBlock(raw: string): string {
  const s = String(raw || '')
  const marker = '\n\n<system-reminder>'
  const idx = s.lastIndexOf(marker)
  if (idx < 0) return s

  const tail = s.slice(idx + 2) // starts at "<system-reminder>"
  const close = '</system-reminder>'
  const closeIdx = tail.lastIndexOf(close)
  if (closeIdx < 0) return s

  const after = tail.slice(closeIdx + close.length)
  if (after.trim().length !== 0) return s

  return s.slice(0, idx).trimEnd()
}

 
