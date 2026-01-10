import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SubAgentConfig } from './types'

type PromptVars = Record<string, string>

const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts')

function readPromptFile(fileName: string): string | null {
  try {
    return fs.readFileSync(path.join(PROMPTS_DIR, fileName), 'utf8')
  } catch {
    return null
  }
}

function stripLeadingHtmlComment(raw: string): string {
  const text = raw || ''
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('<!--')) return text.trim()
  const end = trimmed.indexOf('-->')
  if (end === -1) return text.trim()
  return trimmed.slice(end + 3).trim()
}

function interpolatePrompt(raw: string, vars: PromptVars): string {
  const text = raw || ''
  if (!vars || Object.keys(vars).length === 0) return text
  return text.replace(/\$\{([A-Z0-9_]+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m))
}

function loadPrompt(fileName: string, vars: PromptVars, fallback: string): string {
  const raw = readPromptFile(fileName)
  if (!raw) return fallback.trim()
  const stripped = stripLeadingHtmlComment(raw)
  return interpolatePrompt(stripped, vars).trim()
}

export function getBuiltinSubagents(): SubAgentConfig[] {
  const commonVars: PromptVars = {
    GLOB_TOOL_NAME: 'Glob',
    GREP_TOOL_NAME: 'Grep',
    READ_TOOL_NAME: 'Read',
    BASH_TOOL_NAME: 'Bash',
    WEBFETCH_TOOL_NAME: 'WebFetch',
    WEBSEARCH_TOOL_NAME: 'WebSearch',
    // Best-effort: these URLs are part of Claude Code's public docs references.
    CLAUDE_CODE_DOCS_MAP_URL: 'https://code.claude.com/docs/en/overview',
    AGENT_SDK_DOCS_MAP_URL: 'https://code.claude.com/docs/en/overview',
  }

  const explorePrompt = loadPrompt(
    'agent-prompt-explore.md',
    commonVars,
    'You are a file search specialist. Use Glob/Grep/Read to explore the codebase and report findings. Do not modify files.',
  )

  const planPrompt = loadPrompt(
    'agent-prompt-plan-mode-enhanced.md',
    commonVars,
    'You are a software architect. Explore read-only and propose an implementation plan. Do not modify files.',
  )

  const guidePrompt = loadPrompt(
    'agent-prompt-claude-guide-agent.md',
    commonVars,
    'You are the Claude Code guide agent. Use WebSearch/WebFetch/Read/Glob to answer questions about Claude Code and related docs.',
  )

  const statuslinePrompt = loadPrompt(
    'agent-prompt-status-line-setup.md',
    commonVars,
    'You are a statusline setup agent. Update ~/.claude/settings.json to configure the status line.',
  )

  const taskBase = loadPrompt(
    'agent-prompt-task-tool.md',
    commonVars,
    'You are a general-purpose agent. Use available tools to complete the user task.',
  )
  const taskExtra = loadPrompt('agent-prompt-task-tool-extra-notes.md', commonVars, '')
  const generalPurposePrompt = [taskBase, taskExtra].filter(Boolean).join('\n\n').trim()

  return [
    {
      name: 'general-purpose',
      description:
        'General-purpose agent for researching complex questions, searching code, and executing multi-step tasks. (Tools: *)',
      tools: ['*'],
      systemPrompt: generalPurposePrompt,
    },
    {
      name: 'statusline-setup',
      description: "Configure the user's status line display and settings. (Tools: Read, Edit)",
      tools: ['Read', 'Edit'],
      systemPrompt: statuslinePrompt,
    },
    {
      name: 'Explore',
      description:
        'Fast agent specialized for exploring codebases. Use for file discovery, codebase questions, and broad searches. (Tools: All tools)',
      tools: ['*'],
      systemPrompt: explorePrompt,
    },
    {
      name: 'Plan',
      description:
        'Software architect agent for designing implementation plans. Returns step-by-step plans and highlights critical files. (Tools: All tools)',
      tools: ['*'],
      systemPrompt: planPrompt,
    },
    {
      name: 'claude-code-guide',
      description:
        'Use when the user asks how to use Claude Code features, Claude Agent SDK, or Claude API. (Tools: Glob, Grep, Read, WebFetch, WebSearch)',
      tools: ['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch'],
      systemPrompt: guidePrompt,
    },
  ]
}
