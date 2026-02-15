import type { ChatEngine } from '../chat/engine'
import { createChatEngine } from '../chat/engine'
import type { ContextBudgetConfig } from '../chat/context/budget'
import type { PromptBlock } from '../prompts'
import type { ToolDefinition } from '../tools/types'
import type { ToolExecutor } from '../tools/executor'
import type { LlmStreamClient } from '../streaming/types'
import type { StreamEvent, StreamSink } from '../streaming/types'
import type { SubAgentConfig, SubAgentResult } from './types'
import { randomUUID } from 'node:crypto'
import { SUBAGENT_DENY_TOOLS } from '../tools/executor/subagentDenyTools'

const DEFAULT_SUMMARY_MAX_CHARS = 500
const SUMMARY_TRUNCATION_SUFFIX = '…'
const READONLY_SUBAGENT_DENY_TOOLS = ['Edit', 'Write', 'NotebookEdit'] as const

export interface SubAgentRunner {
  run(args: {
    agent: SubAgentConfig
    task: string
    resume?: string
    agentId?: string
    replMode?: 'normal' | 'acceptEdits' | 'plan'
    interactive?: boolean
    model?: string
    promptBudget?: ContextBudgetConfig | null
    signal?: AbortSignal
    onEvent?: StreamSink
}): Promise<SubAgentResult>
}

function getDenyToolsForSubagent(agent: SubAgentConfig): string[] {
  const deny = new Set<string>(SUBAGENT_DENY_TOOLS)
  if (agent.name === 'Explore' || agent.name === 'Plan') {
    for (const toolName of READONLY_SUBAGENT_DENY_TOOLS) deny.add(toolName)
  }
  return Array.from(deny)
}

export function createSubAgentRunner(deps: {
  client: LlmStreamClient
  executor: ToolExecutor
  allTools: ToolDefinition[]
  promptBudget?: ContextBudgetConfig | null
}): SubAgentRunner {
  const engine: ChatEngine = createChatEngine({ client: deps.client, executor: deps.executor })
  const sessions = new Map<
    string,
    {
      agentName: string
      history: Awaited<ReturnType<ChatEngine['runTurn']>>
    }
  >()

  return {
    async run({
      agent,
      task,
      resume,
      agentId: requestedAgentId,
      replMode,
      interactive,
      model,
      promptBudget,
      signal,
      onEvent,
    }): Promise<SubAgentResult> {
      const agentId = typeof resume === 'string' && resume.trim()
        ? resume.trim()
        : typeof requestedAgentId === 'string' && requestedAgentId.trim()
          ? requestedAgentId.trim()
          : randomUUID()

      const resumeSession = typeof resume === 'string' && resume.trim() ? sessions.get(resume.trim()) : null
      if (resume && !resumeSession) {
        return { agentId, response: '', summary: '', success: false, error: `Unknown agent ID: ${resume}` }
      }
      if (resumeSession && resumeSession.agentName !== agent.name) {
        return {
          agentId,
          response: '',
          summary: '',
          success: false,
          error: `Agent ID ${resume} belongs to '${resumeSession.agentName}', not '${agent.name}'.`,
        }
      }

      const allowed = new Set(agent.tools || [])
      const allowAll = allowed.has('*')
      const denyTools = getDenyToolsForSubagent(agent)
      const denyToolsSet = new Set(denyTools)
      const allowedTools = deps.allTools
        .filter((t) => (allowAll ? true : allowed.has(t.name)))
        .filter((t) => !denyToolsSet.has(t.name))

      const system: PromptBlock[] = [
        {
          type: 'text',
          text: agent.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ]

      let currentMode: 'normal' | 'acceptEdits' | 'plan' = replMode ?? 'normal'
      const getReplMode = () => currentMode
      const setReplMode = (next: 'normal' | 'acceptEdits' | 'plan') => {
        currentMode = next
      }

      let summary = ''
      let response = ''
      const handleEvent: StreamSink = (ev: StreamEvent) => {
        onEvent?.(ev)
        if (ev.type === 'assistant_delta' && typeof ev.text === 'string') {
          response += ev.text
        }
      }
      const resolvedPromptBudget = promptBudget === undefined ? (deps.promptBudget ?? null) : promptBudget

      try {
        const nextHistory = await engine.runTurn({
          history: resumeSession?.history ?? [],
          user: { role: 'user', content: [{ type: 'text', text: task }] },
          system,
          tools: allowedTools,
          onEvent: handleEvent,
          cwd: process.cwd(),
          signal,
          model,
          promptBudget: resolvedPromptBudget,
          exec: {
            agentDepth: 1,
            replMode: currentMode,
            getReplMode,
            setReplMode,
            interactive,
            allowTools: Array.from(allowed),
            denyTools,
          },
        })
        sessions.set(agentId, { agentName: agent.name, history: nextHistory })

        const trimmed = response.trim()
        const limited =
          trimmed.length > DEFAULT_SUMMARY_MAX_CHARS
            ? trimmed.slice(0, DEFAULT_SUMMARY_MAX_CHARS) + SUMMARY_TRUNCATION_SUFFIX
            : trimmed

        return { agentId, response: trimmed, summary: limited, success: true }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          agentId,
          response: '',
          summary: '',
          success: false,
          error: msg,
        }
      }
    },
  }
}
