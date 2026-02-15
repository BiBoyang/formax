import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getConfigPaths } from '../adapters/fs/configPaths'
import type { ChatEngine } from '../chat/engine'
import type { PromptBlock, PromptMessage } from '../prompts'
import type { AskUserAnswers, AskUserQuestion } from '../tools/runtime/userInputManager'

const TOOL_PRESET_OPTIONS = [
  { label: 'All tools', description: 'Full tool access (still subject to runtime deny + approvals).' },
  { label: 'Read-only tools', description: 'Read, Glob, Grep' },
  { label: 'Edit tools', description: 'Read, Edit, Write, NotebookEdit' },
  { label: 'Execution tools', description: 'Bash' },
]

const MODEL_OPTIONS = [
  { label: 'Sonnet', description: 'Balanced performance - best for most agents' },
  { label: 'Opus', description: 'Most capable for complex reasoning tasks' },
  { label: 'Haiku', description: 'Fast and efficient for simple tasks' },
  { label: 'Inherit', description: 'Use the same model as the main conversation' },
]

const COLOR_OPTIONS = [
  { label: 'Red', description: '' },
  { label: 'Blue', description: '' },
  { label: 'Green', description: '' },
  { label: 'Yellow', description: '' },
  { label: 'Purple', description: '' },
  { label: 'Orange', description: '' },
  { label: 'Pink', description: '' },
  { label: 'Cyan', description: '' },
]

export function buildAgentsWizardEntryQuestions(): AskUserQuestion[] {
  return [
    {
      header: 'scope',
      question: 'Create new agent: choose scope',
      options: [
        {
          label: 'Project-level (.formax/agents)',
          description: 'Saved to the current repo and shared with this project.',
        },
        {
          label: 'User-level (~/.formax/agents)',
          description: 'Saved to your global config and available in all projects.',
        },
      ],
      multiSelect: false,
    },
    {
      header: 'mode',
      question: 'Create new agent: choose method',
      options: [
        {
          label: 'Write manually',
          description: 'Enter the full system prompt yourself.',
        },
        {
          label: 'Generate with Claude',
          description: 'Describe what you want; Claude drafts identifier + whenToUse + system prompt (JSON).',
        },
      ],
      multiSelect: false,
    },
  ]
}

export function buildAgentsWizardManualQuestions(): AskUserQuestion[] {
  return [
    {
      header: 'name',
      question: 'Agent name (used as subagent_type)',
      options: [],
      multiSelect: false,
    },
    {
      header: 'description',
      question: 'Description (when to use this agent)',
      options: [],
      multiSelect: false,
    },
    {
      header: 'tools',
      question: 'Select tools preset (or choose "Type something." to enter a comma-separated tool list)',
      options: TOOL_PRESET_OPTIONS,
      multiSelect: false,
    },
    {
      header: 'model',
      question: 'Select model',
      options: MODEL_OPTIONS,
      multiSelect: false,
    },
    {
      header: 'color',
      question: 'Choose background color',
      options: COLOR_OPTIONS,
      multiSelect: false,
    },
    {
      header: 'systemPrompt',
      question: 'System prompt',
      options: [],
      multiSelect: false,
    },
  ]
}

export function buildAgentsWizardGenerateQuestions(): AskUserQuestion[] {
  return [
    {
      header: 'agentDescription',
      question: 'Describe the agent you want (what it does, when to use it, output format expectations, etc.)',
      options: [],
      multiSelect: false,
    },
    {
      header: 'tools',
      question: 'Select tools preset (or choose "Type something." to enter a comma-separated tool list)',
      options: TOOL_PRESET_OPTIONS,
      multiSelect: false,
    },
    {
      header: 'model',
      question: 'Select model',
      options: MODEL_OPTIONS,
      multiSelect: false,
    },
    {
      header: 'color',
      question: 'Choose background color',
      options: COLOR_OPTIONS,
      multiSelect: false,
    },
  ]
}

export async function createAgentFromWizardAnswers(args: {
  answers: AskUserAnswers
  cwd: string
  env?: NodeJS.ProcessEnv
  projectAgentsDir: string
}): Promise<{ name: string; filePath: string }> {
  const env = args.env ?? process.env
  const scope = String(args.answers.scope || '').toLowerCase()
  const isUser = scope.includes('user-level')

  const configPaths = getConfigPaths({ cwd: args.cwd, env })
  const globalConfigDir = path.resolve(args.cwd, configPaths.globalConfigDir)
  const userAgentsDir = path.join(globalConfigDir, 'agents')

  const dir = isUser ? userAgentsDir : args.projectAgentsDir

  const nameRaw = String(args.answers.name || '').trim()
  const name = normalizeAgentName(nameRaw)
  if (!name) throw new Error('Missing agent name.')

  const description = yamlInlineValue(String(args.answers.description || '').trim())
  if (!description) throw new Error('Missing agent description.')

  const systemPrompt = String(args.answers.systemPrompt || '').trim()
  if (!systemPrompt) throw new Error('Missing system prompt.')

  const model = normalizeAgentModel(String(args.answers.model || '').trim())
  const color = normalizeAgentColor(String(args.answers.color || '').trim())
  const tools = toolsFrontmatterFromAnswer(String(args.answers.tools || '').trim())

  const fmLines: string[] = ['---']
  fmLines.push(`name: ${name}`)
  fmLines.push(`description: ${description}`)
  if (model) fmLines.push(`model: ${model}`)
  if (color) fmLines.push(`color: ${color}`)
  if (tools) fmLines.push(`tools: ${tools}`)
  fmLines.push('---', '')

  const content = fmLines.join('\n') + systemPrompt.trimEnd() + '\n'

  await fsp.mkdir(dir, { recursive: true })
  const filePath = await pickNonexistentPath({
    dir,
    baseName: name,
    ext: '.md',
  })

  await fsp.writeFile(filePath, content, 'utf8')
  return { name, filePath }
}

function yamlInlineValue(s: string): string {
  // Claude Code stores multi-line description as literal "\n" sequences in YAML frontmatter.
  // Keep the frontmatter one-line (our parser is line-based) while preserving intent.
  return String(s || '').replace(/\r?\n/g, '\\n').trim()
}

function normalizeAgentName(raw: string): string {
  const s = String(raw || '').trim().toLowerCase()
  return s
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+/, '')
    .replace(/[-_]+$/, '')
}

function normalizeAgentModel(raw: string): string | null {
  const v = String(raw || '').trim().toLowerCase()
  if (!v) return null
  if (v === 'inherit' || v === 'sonnet' || v === 'opus' || v === 'haiku') return v
  return null
}

function normalizeAgentColor(raw: string): string | null {
  const v = String(raw || '').trim().toLowerCase()
  if (!v || v === 'automatic') return null
  return v
}

function toolsFrontmatterFromAnswer(answer: string): string | null {
  const raw = String(answer || '').trim()
  if (!raw) return null

  if (/^all tools$/i.test(raw)) return null
  if (/^read-only tools$/i.test(raw)) return 'Read, Glob, Grep'
  if (/^edit tools$/i.test(raw)) return 'Read, Edit, Write, NotebookEdit'
  if (/^execution tools$/i.test(raw)) return 'Bash'

  const parsed = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  if (parsed.length === 0) return null
  if (parsed.length === 1 && parsed[0] === '*') return null
  return parsed.join(', ')
}

async function pickNonexistentPath(args: { dir: string; baseName: string; ext: string }): Promise<string> {
  const base = String(args.baseName || '').trim() || 'agent'
  const ext = args.ext.startsWith('.') ? args.ext : `.${args.ext}`

  for (let i = 0; i < 1000; i++) {
    const suffix = i === 0 ? '' : `-${i + 1}`
    const candidate = path.join(args.dir, `${base}${suffix}${ext}`)
    try {
      await fsp.access(candidate)
    } catch {
      return candidate
    }
  }

  throw new Error('Failed to find an available filename for new agent.')
}

type PromptVars = Record<string, string>

const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts')

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

async function loadPrompt(fileName: string, vars: PromptVars, fallback: string): Promise<string> {
  try {
    const raw = await fsp.readFile(path.join(PROMPTS_DIR, fileName), 'utf8')
    return interpolatePrompt(stripLeadingHtmlComment(raw), vars).trim()
  } catch {
    return fallback.trim()
  }
}

function extractAssistantText(blocks: PromptBlock[]): string {
  return blocks
    .map((b) => {
      const t = (b as any)?.type
      if (t === 'text') return String((b as any)?.text ?? '')
      return ''
    })
    .join('')
}

function extractFirstJsonObject(text: string): string | null {
  const raw = String(text || '').trim()
  if (!raw) return null

  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(raw)
  if (fenced) {
    const nested = extractFirstJsonObject(fenced[1])
    if (nested) return nested
  }

  const start = raw.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }

  return null
}

export type AgentArchitectDraft = {
  identifier: string
  whenToUse: string
  systemPrompt: string
}

export function parseAgentArchitectDraft(raw: string): AgentArchitectDraft {
  const json = extractFirstJsonObject(raw)
  if (!json) throw new Error('Expected a JSON object, but none was found.')

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Failed to parse JSON output from agent architect.')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object from agent architect.')
  }

  const obj = parsed as Record<string, unknown>

  const identifier = typeof obj.identifier === 'string' ? obj.identifier : typeof obj.name === 'string' ? obj.name : ''
  const whenToUse =
    typeof obj.whenToUse === 'string' ? obj.whenToUse : typeof obj.description === 'string' ? obj.description : ''
  const systemPrompt = typeof obj.systemPrompt === 'string' ? obj.systemPrompt : ''

  if (!identifier.trim()) throw new Error('Agent architect output is missing "identifier".')
  if (!whenToUse.trim()) throw new Error('Agent architect output is missing "whenToUse".')
  if (!systemPrompt.trim()) throw new Error('Agent architect output is missing "systemPrompt".')

  return { identifier, whenToUse, systemPrompt }
}

export async function generateAgentDraftWithClaude(args: {
  engine: ChatEngine
  description: string
  cwd: string
  model?: string
  signal?: AbortSignal
}): Promise<{ name: string; description: string; systemPrompt: string }> {
  const userDescription = String(args.description || '').trim()
  if (!userDescription) throw new Error('Missing agent description for generation.')

  const systemText = await loadPrompt(
    'agent-prompt-agent-creation-architect.md',
    { TASK_TOOL_NAME: 'Task' },
    'You are an agent architect. Output a JSON object with fields: identifier, whenToUse, systemPrompt.',
  )

  const system: PromptBlock[] = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]

  const user: PromptMessage = {
    role: 'user',
    content: [
      {
        type: 'text',
        text: [
          'User request (describe the agent to create):',
          userDescription,
          '',
          'Return only the JSON object described in the system prompt.',
        ].join('\n'),
      },
    ],
  }

  const history = await args.engine.runTurn({
    history: [],
    user,
    system,
    tools: [],
    onEvent: () => {},
    cwd: args.cwd,
    model: args.model,
    signal: args.signal,
    exec: { agentDepth: 1 },
  })

  const assistant = history.filter((m) => m.role === 'assistant').at(-1)
  const assistantText = assistant ? extractAssistantText(assistant.content) : ''
  const draft = parseAgentArchitectDraft(assistantText)

  return {
    name: draft.identifier,
    description: draft.whenToUse,
    systemPrompt: draft.systemPrompt,
  }
}
