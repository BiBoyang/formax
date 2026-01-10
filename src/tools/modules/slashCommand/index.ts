import fs from 'node:fs'
import path from 'node:path'
import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import { SlashCommandToolHandler } from './handler'

const BASE_DESCRIPTION =
  'Execute a custom slash command within the main conversation.\n\n' +
  'How slash commands work:\n' +
  'When you use this tool (or when a user types a slash command), you will see <command-message>{name} is running…</command-message> followed by the expanded prompt.\n\n' +
  'Usage:\n' +
  '- command (required): The slash command to execute, including any arguments\n' +
  '- Example: command: "/review-pr 123"\n\n' +
  'IMPORTANT: Only use this tool for custom slash commands from `.claude/commands/*.md`.\n' +
  'Do NOT use this tool for built-in CLI commands (like /help, /clear, etc.).\n'

function buildAvailableCommandsSection(cwd: string): string {
  const dir = path.join(cwd, '.claude', 'commands')
  try {
    if (!fs.existsSync(dir)) return '\nAvailable Commands:\n(none found)\n'
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const commands = entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => {
        const filePath = path.join(dir, e.name)
        const raw = fs.readFileSync(filePath, 'utf8')
        const parsed = parseFrontmatter(raw)
        const body = (parsed?.body ?? raw).trim()
        const baseName = path.basename(e.name, path.extname(e.name))
        if (!isSafeCommandName(baseName)) return null
        const cmd = `/${baseName}`
        const desc = (parsed?.attributes.description || extractFirstLine(body) || 'Custom command').trim()
        return { cmd, desc }
      })
      .filter((v): v is { cmd: string; desc: string } => Boolean(v))
      .sort((a, b) => a.cmd.localeCompare(b.cmd))

    if (commands.length === 0) return '\nAvailable Commands:\n(none found)\n'

    return '\nAvailable Commands:\n' + commands.map((c) => `- ${c.cmd}: ${c.desc}`).join('\n') + '\n'
  } catch {
    return '\nAvailable Commands:\n(none found)\n'
  }
}

const spec: ToolDefinition = {
  name: 'SlashCommand',
  description: BASE_DESCRIPTION + buildAvailableCommandsSection(process.cwd()),
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The slash command to execute with its arguments, e.g., "/review-pr 123"',
      },
    },
    required: ['command'],
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
  },
}

export const slashCommandToolModule: ToolModule = {
  name: 'SlashCommand',
  handler: SlashCommandToolHandler,
  spec,
}

function extractFirstLine(body: string): string {
  const lines = (body || '').split(/\r?\n/g)
  const first = lines.find((l) => l.trim().length > 0)
  if (!first) return ''
  return first.replace(/^#+\s*/, '').trim().slice(0, 80)
}

function isSafeCommandName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)
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
