import fs from 'node:fs'
import path from 'node:path'
import type { PromptBlock } from '../../prompts'
import { buildInitCommandContent } from '../../prompts'
import type { TaskManager } from '../../tools/runtime/taskManager'

export type SlashCommandSpec = {
  command: string
  description: string
  implemented?: boolean
}

export type LocalCommandRecord = {
  commandName: string
  commandMessage: string
  commandArgs: string
  stdout: string
}

export type SlashCommandEffect =
  | {
      kind: 'local'
      stdout: string
      recordForNextTurn?: LocalCommandRecord
    }
  | {
      kind: 'llm'
      blocks: PromptBlock[]
      loadingText?: string
    }
  | {
      kind: 'unimplemented'
      message: string
    }

export type SlashCommandRegistry = {
  list: () => SlashCommandSpec[]
  suggest: (input: string) => SlashCommandSpec[]
  dispatch: (input: string) => SlashCommandEffect | null
}

export type PromptProfile = 'lite' | 'full'

type CommandEntry = {
  spec: SlashCommandSpec
  dispatch?: (args: { command: string; args: string }) => SlashCommandEffect
}

const BUILTIN_SPECS: SlashCommandSpec[] = [
  { command: '/help', description: 'Get help with using Formax', implemented: true },
  { command: '/tasks', description: 'List and manage background tasks', implemented: true },
  { command: '/plan', description: 'Show current plan', implemented: true },
  { command: '/prompt', description: 'Switch system prompt profile (full/lite)', implemented: true },
  {
    command: '/status',
    description: 'Show status including version, model, API connectivity',
    implemented: false,
  },
  { command: '/install-github-app', description: 'Set up GitHub Actions for a repository', implemented: false },
  { command: '/stats', description: 'Show usage statistics and activity', implemented: false },
  { command: '/statusline', description: "Configure Claude Code's status line UI", implemented: false },
  { command: '/ide', description: 'Manage IDE integrations and show status', implemented: false },
  { command: '/cost', description: 'Show total cost and duration of the session', implemented: false },
  { command: '/doctor', description: 'Diagnose and verify installation and settings', implemented: false },
  { command: '/terminal-setup', description: 'Install terminal key bindings and settings', implemented: false },
  { command: '/init', description: 'Initialize a CLAUDE.md file with repo documentation', implemented: true },
]

export function createSlashCommandRegistry(deps: {
  cwd: string
  taskManager?: TaskManager
  plan?: { getPlanPath: () => string | null }
  promptProfile?: { get: () => PromptProfile; set: (next: PromptProfile) => void }
}): SlashCommandRegistry {
  const pluginEntries = loadClaudeCommandEntries(deps.cwd)

  const byCommand = new Map<string, CommandEntry>()
  for (const spec of BUILTIN_SPECS) byCommand.set(spec.command, { spec })
  for (const entry of pluginEntries) {
    if (!byCommand.has(entry.spec.command)) byCommand.set(entry.spec.command, entry)
  }

  // Built-in dispatchers
  byCommand.set('/help', {
    spec: byCommand.get('/help')!.spec,
    dispatch: () => {
      const specs = Array.from(byCommand.values())
        .map((e) => e.spec)
        .sort((a, b) => a.command.localeCompare(b.command))
      return { kind: 'local', stdout: formatHelpOutput(specs) }
    },
  })

  byCommand.set('/tasks', {
    spec: byCommand.get('/tasks')!.spec,
    dispatch: () => ({
      kind: 'local',
      stdout: formatTasksOutput(deps.taskManager?.list() ?? []),
    }),
  })

  byCommand.set('/plan', {
    spec: byCommand.get('/plan')!.spec,
    dispatch: () => {
      const planPath = deps.plan?.getPlanPath() ?? null
      if (!planPath) return { kind: 'local', stdout: 'No plan found for current session.' }

      try {
        const raw = fs.readFileSync(planPath, 'utf8')
        const stdout = raw.trimEnd() || '(empty plan)'
        return { kind: 'local', stdout }
      } catch {
        return { kind: 'local', stdout: 'No plan found for current session.' }
      }
    },
  })

  byCommand.set('/prompt', {
    spec: byCommand.get('/prompt')!.spec,
    dispatch: (invocation) => {
      const current = deps.promptProfile?.get?.() ?? 'full'
      const raw = (invocation.args || '').trim().toLowerCase()
      if (!raw) {
        return {
          kind: 'local',
          stdout:
            `Prompt profile: ${current}\n\n` +
            `Usage:\n` +
            `- /prompt full\n` +
            `- /prompt lite`,
        }
      }

      if (raw !== 'full' && raw !== 'lite') {
        return { kind: 'local', stdout: `Unknown profile: ${raw}\n\nUse: /prompt full|lite` }
      }

      deps.promptProfile?.set(raw)
      return { kind: 'local', stdout: `Prompt profile set to: ${raw}` }
    },
  })

  byCommand.set('/init', {
    spec: byCommand.get('/init')!.spec,
    dispatch: () => ({
      kind: 'llm',
      blocks: buildInitCommandContent(),
      loadingText: 'Spelunking',
    }),
  })

  const list = (): SlashCommandSpec[] => {
    const merged = Array.from(byCommand.values()).map((e) => e.spec)
    merged.sort((a, b) => a.command.localeCompare(b.command))
    return merged
  }

  const suggest = (input: string): SlashCommandSpec[] => {
    const raw = (input || '').trimStart()
    if (!raw.startsWith('/')) return []

    const query = raw.slice(1).toLowerCase()
    if (!query) return list()

    return list().filter((c) => c.command.slice(1).toLowerCase().startsWith(query))
  }

  const dispatch = (input: string): SlashCommandEffect | null => {
    const parsed = parseSlashCommand(input)
    if (!parsed) return null

    const entry = byCommand.get(parsed.command)
    if (!entry) return null

    if (entry.dispatch) {
      return entry.dispatch(parsed)
    }

    if (entry.spec.implemented === false) {
      return { kind: 'unimplemented', message: `Command ${entry.spec.command} is not implemented yet.` }
    }

    return null
  }

  return { list, suggest, dispatch }
}

export function getSlashCommandSuggestions(input: string): SlashCommandSpec[] {
  // Backwards-compatible helper for legacy call sites (no plugins, no dispatch).
  return createSlashCommandRegistry({ cwd: process.cwd() }).suggest(input)
}

export function parseSlashCommand(input: string): { command: string; args: string } | null {
  const raw = (input || '').trim()
  if (!raw.startsWith('/')) return null

  const firstSpace = raw.indexOf(' ')
  if (firstSpace === -1) return { command: raw, args: '' }

  const cmd = raw.slice(0, firstSpace)
  const args = raw.slice(firstSpace + 1).trim()
  return { command: cmd, args }
}

function loadClaudeCommandEntries(cwd: string): CommandEntry[] {
  const dir = path.join(cwd, '.claude', 'commands')
  try {
    if (!fs.existsSync(dir)) return []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => {
        const filePath = path.join(dir, e.name)
        const raw = fs.readFileSync(filePath, 'utf8')
        const parsed = parseFrontmatter(raw)
        const body = (parsed?.body ?? raw).trim()

        const baseName = path.basename(e.name, path.extname(e.name))
        const cmd = `/${baseName}`
        const description = (parsed?.attributes.description || extractFirstLine(body) || 'Custom command').trim()

        const spec: SlashCommandSpec = {
          command: cmd,
          description,
          implemented: true,
        }

        return {
          spec,
          dispatch: (invocation) => ({
            kind: 'llm',
            blocks: buildFileCommandContent({ command: cmd, args: invocation.args, body }),
            loadingText: 'Thinking',
          }),
        }
      })
  } catch {
    return []
  }
}

function buildFileCommandContent(args: { command: string; args: string; body: string }): PromptBlock[] {
  const cmdName = args.command.startsWith('/') ? args.command.slice(1) : args.command
  const cmdArgs = args.args || ''
  return [
    {
      type: 'text',
      text:
        `<command-message>${cmdName} is running…</command-message>\n` +
        `<command-name>${args.command}</command-name>` +
        (cmdArgs ? `\n<command-args>${cmdArgs}</command-args>` : ''),
    },
    {
      type: 'text',
      text: args.body,
    },
  ]
}

function extractFirstLine(body: string): string {
  const lines = (body || '').split(/\r?\n/g)
  const first = lines.find((l) => l.trim().length > 0)
  if (!first) return ''
  return first.replace(/^#+\s*/, '').trim().slice(0, 80)
}

function parseFrontmatter(text: string): { attributes: Record<string, string>; body: string } | null {
  const raw = text || ''
  if (!raw.startsWith('---')) return null

  const end = raw.indexOf('\n---', 3)
  if (end === -1) return null

  const header = raw.slice(3, end).trim()
  const body = raw.slice(end + '\n---'.length).replace(/^\s+/, '')
  const attributes: Record<string, string> = {}

  for (const line of header.split(/\r?\n/g)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf(':')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim().replace(/^"|"$/g, '')
    if (key) attributes[key] = value
  }

  return { attributes, body }
}

function formatTasksOutput(tasks: Array<{ id: string; kind?: string; label?: string; status: string }>): string {
  if (!tasks || tasks.length === 0) return 'No background tasks.'

  const lines = ['Background tasks:']
  for (const t of tasks) {
    const kind = t.kind ? ` ${t.kind}` : ''
    const label = t.label ? ` — ${t.label}` : ''
    lines.push(`- ${t.status}${kind} ${t.id}${label}`)
  }
  lines.push('')
  lines.push('Tip: ask me to run TaskOutput with a task_id to fetch output.')
  lines.push('Tip: ask me to run KillShell with a shell_id to stop a running shell task.')
  return lines.join('\n')
}

function formatHelpOutput(specs: SlashCommandSpec[]): string {
  const lines: string[] = []

  lines.push('Formax help')
  lines.push('')
  lines.push('Slash commands:')

  for (const s of specs) {
    const status = s.implemented === false ? ' (not implemented)' : ''
    lines.push(`- ${s.command} — ${s.description}${status}`)
  }

  lines.push('')
  lines.push('Tips:')
  lines.push('- Type "/" to see command suggestions; use Tab/Arrow keys to navigate.')
  lines.push('- Use "/prompt full|lite" to switch system prompt profiles.')
  lines.push('- Press Shift+Tab to cycle modes (normal → acceptEdits → plan).')
  lines.push('- Press Esc to cancel interactive prompts (AskUserQuestion / approvals).')

  return lines.join('\n')
}
