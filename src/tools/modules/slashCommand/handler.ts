import fs from 'node:fs'
import path from 'node:path'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'

export const SlashCommandToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'SlashCommand'
  },

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const input = requirePlainObject(call.input || {}, 'SlashCommand.input')
      assertNoExtraKeys(input, ['command'], 'SlashCommand.input')
      const rawCommand = (input as any).command

      if (typeof rawCommand !== 'string' || !rawCommand.trim()) {
        return { tool_use_id: call.id, content: 'Error: Missing required field command.', is_error: true }
      }

      const parsed = parseCommand(rawCommand)
      if (!parsed) {
        return { tool_use_id: call.id, content: 'Error: Invalid command format.', is_error: true }
      }

      const cwd = ctx.cwd || process.cwd()
      const available = listCustomCommands(cwd)

      const cmdName = parsed.command.startsWith('/') ? parsed.command.slice(1) : parsed.command
      if (!isSafeCommandName(cmdName)) {
        return {
          tool_use_id: call.id,
          content: `Error: Invalid command name: ${parsed.command}`,
          is_error: true,
        }
      }

      const filePath = path.join(cwd, '.claude', 'commands', `${cmdName}.md`)
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        const list = available.length ? available.map((c) => c.command).join(', ') : '(none)'
        return {
          tool_use_id: call.id,
          content: `Error: Unknown slash command: ${parsed.command}\nAvailable commands: ${list}`,
          is_error: true,
        }
      }

      const raw = fs.readFileSync(filePath, 'utf8')
      const parsedFile = parseFrontmatter(raw)
      const body = (parsedFile?.body ?? raw).trim()

      if (!body) {
        return {
          tool_use_id: call.id,
          content: `Error: Slash command file is empty: ${filePath}`,
          is_error: true,
        }
      }

      const header =
        `<command-message>${cmdName} is running…</command-message>\n` +
        `<command-name>${parsed.command}</command-name>` +
        (parsed.args ? `\n<command-args>${parsed.args}</command-args>` : '')

      return { tool_use_id: call.id, content: [header, body].join('\n\n') }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}

function parseCommand(raw: string): { command: string; args: string } | null {
  const text = String(raw || '').trim()
  if (!text.startsWith('/')) return null
  if (text.includes('\n') || text.includes('\r')) return null

  const firstSpace = text.indexOf(' ')
  if (firstSpace === -1) return { command: text, args: '' }

  const command = text.slice(0, firstSpace)
  const args = text.slice(firstSpace + 1).trim()
  return { command, args }
}

function isSafeCommandName(name: string): boolean {
  // Keep it simple and traversal-safe: `/foo-bar_123` matches `foo-bar_123.md`.
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)
}

function listCustomCommands(cwd: string): Array<{ command: string; description: string }> {
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
        if (!isSafeCommandName(baseName)) return null
        const command = `/${baseName}`
        const description = (parsed?.attributes.description || extractFirstLine(body) || 'Custom command').trim()
        return { command, description }
      })
      .filter((v): v is { command: string; description: string } => Boolean(v))
  } catch {
    return []
  }
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
