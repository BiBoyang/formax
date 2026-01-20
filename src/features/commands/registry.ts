import fs from 'node:fs'
import path from 'node:path'
import type { PromptBlock } from '../../prompts'
import { buildInitCommandContent } from '../../prompts'
import { formatStatusHuman } from '../../core/diagnostics/format.js'
import type { StatusSnapshot } from '../../core/diagnostics/status.js'
import type { TaskManager } from '../../tools/runtime/taskManager'
import { readTodos } from '../../tools/runtime/todosFile'
import { getConfigPaths } from '../../adapters/fs/configPaths'
import { createCommandStore } from '../../commands/CommandStore'
import { buildFileCommandContent } from '../../commands/render'

export type SlashCommandSpec = {
  id: string
  source: 'builtin' | 'user' | 'project'
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
      kind: 'open_agents_dialog'
    }
  | {
      kind: 'open_permissions_dialog'
    }
  | {
      kind: 'local_async'
      loadingText?: string
      run: () => Promise<{ stdout: string; recordForNextTurn?: LocalCommandRecord }>
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
  dispatch: (input: string, opts?: { preferredSpecId?: string }) => SlashCommandEffect | null
}

export type PromptProfile = 'lite' | 'full'

type CommandEntry = {
  spec: SlashCommandSpec
  dispatch?: (args: { command: string; args: string }) => SlashCommandEffect
}

const BUILTIN_SPECS: SlashCommandSpec[] = [
  { id: 'builtin:/help', source: 'builtin', command: '/help', description: 'Get help with using Formax', implemented: true },
  { id: 'builtin:/tasks', source: 'builtin', command: '/tasks', description: 'List and manage background tasks', implemented: true },
  { id: 'builtin:/todos', source: 'builtin', command: '/todos', description: 'List current todos', implemented: true },
  { id: 'builtin:/agents', source: 'builtin', command: '/agents', description: 'Create and manage custom sub-agents', implemented: true },
  { id: 'builtin:/permissions', source: 'builtin', command: '/permissions', description: 'Manage tool permissions and workspace access', implemented: true },
  { id: 'builtin:/plan', source: 'builtin', command: '/plan', description: 'Show current plan', implemented: true },
  { id: 'builtin:/prompt', source: 'builtin', command: '/prompt', description: 'Switch system prompt profile (full/lite)', implemented: true },
  {
    id: 'builtin:/compact',
    source: 'builtin',
    command: '/compact',
    description: 'Clear conversation history but keep a summary in context. Optional: /compact <instructions>',
    implemented: true,
  },
  {
    id: 'builtin:/status',
    source: 'builtin',
    command: '/status',
    description: 'Show status including version, model, API connectivity',
    implemented: true,
  },
  { id: 'builtin:/install-github-app', source: 'builtin', command: '/install-github-app', description: 'Set up GitHub Actions for a repository', implemented: false },
  { id: 'builtin:/stats', source: 'builtin', command: '/stats', description: 'Show usage statistics and activity', implemented: false },
  { id: 'builtin:/statusline', source: 'builtin', command: '/statusline', description: "Configure Claude Code's status line UI", implemented: false },
  { id: 'builtin:/ide', source: 'builtin', command: '/ide', description: 'Manage IDE integrations and show status', implemented: false },
  { id: 'builtin:/cost', source: 'builtin', command: '/cost', description: 'Show total cost and duration of the session', implemented: false },
  { id: 'builtin:/doctor', source: 'builtin', command: '/doctor', description: 'Diagnose and verify installation and settings', implemented: true },
  { id: 'builtin:/terminal-setup', source: 'builtin', command: '/terminal-setup', description: 'Install terminal key bindings and settings', implemented: false },
  { id: 'builtin:/init', source: 'builtin', command: '/init', description: 'Initialize a CLAUDE.md file with repo documentation', implemented: true },
]

export function createSlashCommandRegistry(deps: {
  cwd: string
  globalConfigDir?: string
  taskManager?: TaskManager
  plan?: { getPlanPath: () => string | null }
  promptProfile?: { get: () => PromptProfile; set: (next: PromptProfile) => void }
  status?: { get: () => StatusSnapshot }
  doctor?: { run: () => Promise<string> }
}): SlashCommandRegistry {
  // Built-in commands and `.formax/commands/**` are allowed to share the same
  // slash command id (e.g. `/status`). We keep *multiple* entries and:
  // - show all variants in the dropdown (builtin/user/project)
  // - default to the builtin implementation unless the UI explicitly selects a variant
  const globalConfigDir =
    deps.globalConfigDir ?? getConfigPaths({ cwd: deps.cwd, env: process.env }).globalConfigDir
  const commandStore = createCommandStore({ cwd: deps.cwd, globalConfigDir })
  const pluginEntries = loadFormaxCommandEntries(commandStore)

  const entriesById = new Map<string, CommandEntry>()
  const entriesByCommand = new Map<string, CommandEntry[]>()

  const addEntry = (entry: CommandEntry): void => {
    if (entriesById.has(entry.spec.id)) return
    entriesById.set(entry.spec.id, entry)
    const list = entriesByCommand.get(entry.spec.command) ?? []
    list.push(entry)
    entriesByCommand.set(entry.spec.command, list)
  }

  for (const spec of BUILTIN_SPECS) addEntry({ spec })
  for (const entry of pluginEntries) addEntry(entry)

  const setBuiltinDispatcher = (command: string, dispatch: CommandEntry['dispatch']): void => {
    const id = `builtin:${command}`
    const entry = entriesById.get(id)
    if (!entry) return
    entry.dispatch = dispatch
  }

  // Built-in dispatchers
  setBuiltinDispatcher('/help', () => {
      return { kind: 'local', stdout: formatHelpOutput(list()) }
  })

  setBuiltinDispatcher('/tasks', () => ({
      kind: 'local',
      stdout: formatTasksOutput(deps.taskManager?.list() ?? []),
  }))

  setBuiltinDispatcher('/todos', (invocation) => {
      const { todos } = readTodos(deps.cwd)
      const stdout = formatTodosCommandOutput(todos)
      return {
        kind: 'local',
        stdout,
        recordForNextTurn: {
          commandName: invocation.command,
          commandMessage: invocation.command.startsWith('/') ? invocation.command.slice(1) : invocation.command,
          commandArgs: invocation.args,
          stdout,
        },
      }
  })

  setBuiltinDispatcher('/agents', (invocation) => {
      const rawArgs = (invocation.args || '').trim()
      if (rawArgs) return { kind: 'local', stdout: 'Usage: /agents' }
      return { kind: 'open_agents_dialog' }
  })

  setBuiltinDispatcher('/permissions', (invocation) => {
      const rawArgs = (invocation.args || '').trim()
      if (rawArgs) return { kind: 'local', stdout: 'Usage: /permissions' }
      return { kind: 'open_permissions_dialog' }
  })

  setBuiltinDispatcher('/plan', () => {
      const planPath = deps.plan?.getPlanPath() ?? null
      if (!planPath) return { kind: 'local', stdout: 'No plan found for current session.' }

      try {
        const raw = fs.readFileSync(planPath, 'utf8')
        const stdout = raw.trimEnd() || '(empty plan)'
        return { kind: 'local', stdout }
      } catch {
        return { kind: 'local', stdout: 'No plan found for current session.' }
      }
  })

  setBuiltinDispatcher('/prompt', (invocation) => {
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
  })

  setBuiltinDispatcher('/status', () => {
      const snapshot = deps.status?.get?.()
      if (!snapshot) return { kind: 'local', stdout: 'Status is not available in this context.' }
      return { kind: 'local', stdout: formatStatusHuman(snapshot) + '\n' }
  })

  setBuiltinDispatcher('/doctor', () => {
      if (!deps.doctor) return { kind: 'local', stdout: 'Doctor is not available in this context.' }
      return {
        kind: 'local_async',
        loadingText: 'Diagnosing',
        run: async () => ({ stdout: await deps.doctor.run() }),
      }
  })

  setBuiltinDispatcher('/init', () => ({
      kind: 'llm',
      blocks: buildInitCommandContent(),
      loadingText: 'Spelunking',
  }))

  const list = (): SlashCommandSpec[] => {
    const merged = Array.from(entriesById.values()).map((e) => e.spec)
    merged.sort(
      (a, b) =>
        a.command.localeCompare(b.command) ||
        sourceRank(a.source) - sourceRank(b.source) ||
        a.id.localeCompare(b.id),
    )
    return merged
  }

  const suggest = (input: string): SlashCommandSpec[] => {
    const parsed = parseSlashCommand(input)
    if (!parsed) return []

    const query = parsed.command.slice(1).toLowerCase()
    if (!query) return list()

    const scored = list()
      .map((c) => {
        const key = c.command.slice(1).toLowerCase()
        const desc = c.description.toLowerCase()

        // 0) Strict prefix on the full command id.
        if (key.startsWith(query)) return { c, score: 0, tie: key.length, gaps: 0, start: 0 }

        // 1) Prefix match on any segment of `/dir:cmd` (Claude Code style).
        const segments = key.split(':').filter(Boolean)
        if (segments.some((seg) => seg.startsWith(query))) return { c, score: 1, tie: key.length, gaps: 0, start: 0 }

        // 2) Fuzzy (subsequence) match on command id.
        const keyMatch = subsequenceMatch(query, key)
        if (keyMatch) return { c, score: 2, tie: keyMatch.span, gaps: keyMatch.gaps, start: keyMatch.start }

        // 3) Fuzzy (subsequence) match on description.
        const descMatch = subsequenceMatch(query, desc)
        if (descMatch) return { c, score: 3, tie: descMatch.span, gaps: descMatch.gaps, start: descMatch.start }

        return null
      })
      .filter(
        (v): v is { c: SlashCommandSpec; score: number; tie: number; gaps: number; start: number } => Boolean(v),
      )

    scored.sort(
      (a, b) =>
        a.score - b.score ||
        a.gaps - b.gaps ||
        a.tie - b.tie ||
        a.start - b.start ||
        a.c.command.localeCompare(b.c.command) ||
        sourceRank(a.c.source) - sourceRank(b.c.source) ||
        a.c.id.localeCompare(b.c.id),
    )
    return scored.map((v) => v.c)
  }

  const dispatch = (input: string, opts?: { preferredSpecId?: string }): SlashCommandEffect | null => {
    const parsed = parseSlashCommand(input)
    if (!parsed) return null

    const candidates = entriesByCommand.get(parsed.command) ?? []
    if (candidates.length === 0) return null

    const preferredSpecId = opts?.preferredSpecId
    const preferred =
      preferredSpecId
        ? candidates.find((e) => e.spec.id === preferredSpecId) ?? entriesById.get(preferredSpecId)
        : null

    const entry =
      preferred ??
      candidates.find((e) => e.spec.source === 'builtin') ??
      candidates.find((e) => e.spec.source === 'project') ??
      candidates.find((e) => e.spec.source === 'user') ??
      candidates[0] ??
      null

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
  const configPaths = getConfigPaths({ cwd: process.cwd(), env: process.env })
  return createSlashCommandRegistry({ cwd: process.cwd(), globalConfigDir: configPaths.globalConfigDir }).suggest(input)
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

function formatTodosCommandOutput(
  todos: Array<{ content: string; status: string }> | null,
): string {
  if (!todos || todos.length === 0) return 'No todos currently tracked'

  const headerCount = todos.length
  const headerNoun = headerCount === 1 ? 'todo' : 'todos'
  const header = `\u001b[1m${headerCount} ${headerNoun}\u001b[22m:`

  const lines: string[] = [header, '']
  for (const t of todos) {
    const content = String(t?.content ?? '')
    const status = String(t?.status ?? '')

    if (status === 'in_progress') {
      lines.push(`☐ \u001b[1m${content}\u001b[22m`)
    } else if (status === 'completed') {
      lines.push(`\u001b[38;2;153;153;153m☒ \u001b[9m${content}\u001b[29m\u001b[39m`)
    } else {
      lines.push(`☐ ${content}`)
    }
  }

  return lines.join('\n')
}

function subsequenceMatch(query: string, text: string): { start: number; span: number; gaps: number } | null {
  const q = String(query || '')
  const t = String(text || '')
  if (!q) return { start: 0, span: 0, gaps: 0 }
  if (!t) return null

  const positions: number[] = []
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      positions.push(ti)
      qi++
    }
  }
  if (qi !== q.length) return null

  const start = positions[0] ?? 0
  const end = positions[positions.length - 1] ?? start
  const span = Math.max(0, end - start)
  const gaps = Math.max(0, (span + 1) - q.length)
  return { start, span, gaps }
}

function loadFormaxCommandEntries(store: ReturnType<typeof createCommandStore>): CommandEntry[] {
  return store.listAll().map((cmd) => {
    const scopeLabel = cmd.scope === 'project' ? 'Custom command (project)' : 'Custom command (user)'
    const baseDesc = cmd.hasDescriptionFrontmatter ? `${scopeLabel} — ${cmd.description}` : scopeLabel

    const spec: SlashCommandSpec = {
      id: `${cmd.scope}:${cmd.id}`,
      source: cmd.scope,
      command: cmd.id,
      description: baseDesc,
      implemented: true,
    }

    if (cmd.disableModelInvocation) {
      return {
        spec: { ...spec, description: `${baseDesc} (disabled)` },
        dispatch: () => ({
          kind: 'local',
          stdout:
            `Command ${cmd.id} is disabled for model invocation.\n` +
            `Remove "disable-model-invocation: true" from its frontmatter to enable it.`,
        }),
      }
    }

    return {
      spec,
      dispatch: (invocation) => ({
        kind: 'llm',
        blocks: buildFileCommandContent({ command: cmd.id, args: invocation.args, body: cmd.body }),
        loadingText: 'Thinking',
      }),
    }
  })
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

function sourceRank(source: SlashCommandSpec['source']): number {
  // Keep suggestion ordering consistent with default dispatch precedence:
  // builtin → project → user.
  return source === 'builtin' ? 0 : source === 'project' ? 1 : 2
}
