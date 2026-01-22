import childProcess from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PromptBlock } from './types'

export type SystemPromptProfile = 'lite' | 'full'

export type SystemPromptRuntimeDeps = {
  platform?: string
  getToday?: () => string
  osType?: () => string
  osRelease?: () => string
  isGitRepository?: (cwd: string) => boolean
  buildGitSnapshot?: (cwd: string) => string
}

export function buildSystemPrompt(args?: {
  appName?: string
  version?: string
  allowedSubagents?: Array<{ name: string; description: string }>
  cwd?: string
  model?: string
  profile?: SystemPromptProfile
}, deps?: SystemPromptRuntimeDeps): PromptBlock[] {
  const profile: SystemPromptProfile = args?.profile ?? 'full'
  return profile === 'lite' ? buildLiteSystemPrompt(args) : buildFullSystemPrompt(args, deps)
}

function buildLiteSystemPrompt(args?: {
  appName?: string
  version?: string
  allowedSubagents?: Array<{ name: string; description: string }>
  cwd?: string
  model?: string
}): PromptBlock[] {
  const base = "You are Claude Code, Anthropic's official CLI for Claude."
  const cwd = args?.cwd?.trim()
  const fsNote =
    (cwd ? `Current working directory: ${cwd}\n\n` : '') +
    'When calling file tools (Read/Write/Edit/...), prefer paths under the current working directory unless the user specifies otherwise. ' +
    'Do not guess other users home directories; if unsure, call Bash(pwd) first.'

  const allowed = args?.allowedSubagents?.filter((a) => a?.name) ?? []
  if (allowed.length === 0) {
    return [
      {
        type: 'text',
        text: `${base}\n\n${fsNote}`,
        cache_control: { type: 'ephemeral' },
      },
    ]
  }

  const list = allowed
    .map((a) => `- ${a.name}${a.description ? `: ${a.description}` : ''}`)
    .join('\n')

  return [
    {
      type: 'text',
      text:
        `${base}\n\n${fsNote}\n\n` +
        `Available subagents for Task.subagent_type:\n${list}\n\n` +
        `When calling Task, subagent_type MUST be one of the names above.`,
      cache_control: { type: 'ephemeral' },
    },
  ]
}

function buildFullSystemPrompt(args?: {
  appName?: string
  version?: string
  allowedSubagents?: Array<{ name: string; description: string }>
  cwd?: string
  model?: string
}, deps?: SystemPromptRuntimeDeps): PromptBlock[] {
  const appName = (args?.appName || '').trim() || 'Formax'
  const base = "You are Claude Code, Anthropic's official CLI for Claude."
  const cwd = args?.cwd?.trim()

  const allowed = args?.allowedSubagents?.filter((a) => a?.name) ?? []
  const list = allowed
    .map((a) => `- ${a.name}${a.description ? `: ${a.description}` : ''}`)
    .join('\n')

  const envBlock = buildRichEnvSnapshotBlock({ cwd: cwd ?? undefined, model: args?.model }, deps)

  const taskNotes =
    allowed.length > 0
      ? `Available subagents for Task.subagent_type:\n${list}\n\nWhen calling Task, subagent_type MUST be one of the names above.`
      : 'Task tool is available, but no subagents are configured for this session.'

  const fsNote =
    (cwd ? `Current working directory: ${cwd}\n\n` : '') +
    'When calling file tools (Read/Write/Edit/...), prefer paths under the current working directory unless the user specifies otherwise. ' +
    'Do not guess other users home directories; if unsure, call Bash(pwd) first. Prefer absolute paths when available.'

  const securityPolicy =
    'IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.'

  const fullText =
    '\n' +
    'You are an interactive CLI tool that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.\n' +
    '\n' +
    `${securityPolicy}\n` +
    'IMPORTANT: Do not guess URLs. Only use URLs provided by the user or discovered via WebSearch/WebFetch when relevant.\n' +
    '\n' +
    'If the user asks for help or wants to give feedback inform them of the following:\n' +
    `- /help: Get help with using ${appName}\n` +
    '- To give feedback, users should open an issue in this project repository.\n' +
    '\n' +
    '# Tone and style\n' +
    '- Your output is displayed in a terminal UI; keep responses short and concise.\n' +
    '- Avoid emojis unless the user explicitly requests them.\n' +
    '- Output text to communicate with the user; only use tools to complete tasks.\n' +
    '- NEVER create files unless they are necessary to achieve the user request; prefer editing existing files. This includes markdown files.\n' +
    '- Do not use a colon before tool calls. Prefer "Let me read the file." (period) over "Let me read the file:" (colon).\n' +
    '\n' +
    '# Professional objectivity\n' +
    '- Prioritize technical accuracy and truthfulness over validation.\n' +
    '- When uncertain, investigate before concluding.\n' +
    '\n' +
    '# Planning without timelines\n' +
    '- Provide concrete implementation steps without time estimates.\n' +
    '\n' +
    '# Task management\n' +
    '- Use TodoWrite for complex multi-step work to track progress and keep items up to date.\n' +
    '- Use AskUserQuestion when you need clarification or a decision.\n' +
    '- Mark todo items in_progress before starting and completed once done.\n' +
    '\n' +
    '# Asking questions as you work\n' +
    '- Use AskUserQuestion when you need clarification or decisions.\n' +
    '\n' +
    '# Doing tasks\n' +
    '- Do not propose code changes you have not read.\n' +
    '- Avoid over-engineering; keep changes focused on the request.\n' +
    '- Tool results and user messages may include <system-reminder> tags; treat them as important context.\n' +
    '\n' +
    '# Tool usage policy\n' +
    '- Only call tools that exist in the provided tools list; never invent tool names.\n' +
    '- If a tool description mentions an "Agent tool", interpret that as the Task tool (agent runner).\n' +
    '- Prefer specialized tools (Read/Edit/Write/Glob/Grep/Task/TaskOutput/...) over Bash where possible.\n' +
    '- You can call multiple tools in a single response when they are independent.\n' +
    '- Use Bash only for real shell commands; never use Bash echo or shell comments to communicate.\n' +
    '- For open-ended exploration across a codebase, prefer Task(subagent_type=Explore) rather than repeated Glob/Grep loops.\n' +
    '- If the user asks how to use Claude Code / Claude Agent SDK / Claude API docs, prefer Task(subagent_type=claude-code-guide).\n' +
    '\n' +
    fsNote +
    '\n\n' +
    taskNotes +
    '\n\n' +
    envBlock

  return [
    {
      type: 'text',
      text: base,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: fullText,
      cache_control: { type: 'ephemeral' },
    },
  ]
}

type RichEnvSnapshotArgs = {
  cwd?: string
  model?: string
}

type RichEnvSnapshotCache = {
  key: string
  block: string
}

let richEnvSnapshotCache: RichEnvSnapshotCache | null = null

function buildRichEnvSnapshotBlock(args: RichEnvSnapshotArgs, deps?: SystemPromptRuntimeDeps): string {
  const cwd = (args.cwd || process.cwd()).trim() || process.cwd()
  const model = (args.model || '').trim()
  const key = `${cwd}::${model}`

  // Only cache the default runtime implementation. Test/injected dependencies should be deterministic.
  if (!deps && richEnvSnapshotCache?.key === key) return richEnvSnapshotCache.block

  const today = deps?.getToday ? safeCall(() => deps.getToday!(), '') : new Date().toISOString().slice(0, 10)
  const osVersion = `${deps?.osType ? safeCall(() => deps.osType!(), os.type()) : os.type()} ${
    deps?.osRelease ? safeCall(() => deps.osRelease!(), os.release()) : os.release()
  }`
  const platform = deps?.platform || process.platform
  const isGitRepo = deps?.isGitRepository ? safeCall(() => deps.isGitRepository!(cwd), false) : isGitRepository(cwd)

  const lines: string[] = []
  lines.push('Here is useful information about the environment you are running in:')
  lines.push('<env>')
  lines.push(`Working directory: ${cwd}`)
  lines.push(`Is directory a git repo: ${isGitRepo ? 'Yes' : 'No'}`)
  lines.push(`Platform: ${platform}`)
  lines.push(`OS Version: ${osVersion}`)
  lines.push(`Today's date: ${today}`)
  lines.push('</env>')

  if (model) {
    lines.push(`Model ID: ${model}`)
  }

  const gitSnapshot = isGitRepo
    ? deps?.buildGitSnapshot
      ? safeCall(() => deps.buildGitSnapshot!(cwd), '')
      : buildGitSnapshot(cwd)
    : ''
  if (gitSnapshot) {
    lines.push('')
    lines.push(gitSnapshot)
  }

  const block = lines.join('\n')
  if (!deps) richEnvSnapshotCache = { key, block }
  return block
}

function isGitRepository(cwd: string): boolean {
  const fromGit = runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (fromGit && fromGit.trim() === 'true') return true
  try {
    return fs.existsSync(path.join(cwd, '.git'))
  } catch {
    return false
  }
}

function buildGitSnapshot(cwd: string): string {
  const branch = (runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim()
  const statusPorcelain = (runGit(cwd, ['status', '--porcelain']) || '').trimEnd()
  const isClean = statusPorcelain.length === 0
  const commitsRaw = runGit(cwd, ['log', '-n', '5', '--pretty=format:%h %s']) || ''
  const commits = commitsRaw
    .split(/\r?\n/g)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((l) => truncateLine(l, 120))

  const lines: string[] = []
  lines.push(
    'gitStatus: This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.',
  )
  if (branch) lines.push(`Current branch: ${branch}`)
  lines.push('')
  lines.push('Status:')
  lines.push(isClean ? '(clean)' : '(dirty)')
  lines.push('')
  lines.push('Recent commits:')
  if (commits.length > 0) lines.push(...commits)
  return lines.join('\n')
}

function runGit(cwd: string, args: string[]): string | null {
  try {
    const res = childProcess.spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 1500,
      maxBuffer: 1024 * 128,
    })
    if (res.error) return null
    if (typeof res.status === 'number' && res.status !== 0) return null
    return String(res.stdout || '')
  } catch {
    return null
  }
}

function truncateLine(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s
  return s.slice(0, Math.max(0, maxChars - 1)) + '…'
}

function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}
