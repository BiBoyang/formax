import fsp from 'node:fs/promises'
import path from 'node:path'
import { getConfigPaths } from '../adapters/fs/configPaths'
import type { AskUserAnswers, AskUserQuestion } from '../tools/runtime/userInputManager'

export function buildAgentsWizardQuestions(): AskUserQuestion[] {
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
      options: [
        { label: 'All tools', description: 'Full tool access (still subject to runtime deny + approvals).' },
        { label: 'Read-only tools', description: 'Read, Glob, Grep' },
        { label: 'Edit tools', description: 'Read, Edit, Write, NotebookEdit' },
        { label: 'Execution tools', description: 'Bash' },
      ],
      multiSelect: false,
    },
    {
      header: 'model',
      question: 'Select model',
      options: [
        { label: 'Sonnet', description: 'Balanced performance - best for most agents' },
        { label: 'Opus', description: 'Most capable for complex reasoning tasks' },
        { label: 'Haiku', description: 'Fast and efficient for simple tasks' },
        { label: 'Inherit', description: 'Use the same model as the main conversation' },
      ],
      multiSelect: false,
    },
    {
      header: 'color',
      question: 'Choose background color',
      options: [
        { label: 'Automatic', description: 'Let Formax pick' },
        { label: 'Red', description: '' },
        { label: 'Blue', description: '' },
        { label: 'Green', description: '' },
        { label: 'Yellow', description: '' },
        { label: 'Purple', description: '' },
        { label: 'Orange', description: '' },
        { label: 'Pink', description: '' },
        { label: 'Cyan', description: '' },
      ],
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

  const description = singleLine(String(args.answers.description || '').trim())
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

function singleLine(s: string): string {
  return String(s || '').replace(/\r?\n/g, ' ').trim()
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

