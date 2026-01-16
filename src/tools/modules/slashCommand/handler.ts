import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'
import { getConfigPaths } from '../../../adapters/fs/configPaths'
import { createCommandStore } from '../../../commands/CommandStore'
import { buildFileCommandExpandedText } from '../../../commands/render'

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
      const configPaths = getConfigPaths({ cwd, env: process.env })
      const store = createCommandStore({ cwd, globalConfigDir: configPaths.globalConfigDir })
      const available = listAvailableCommands(store)

      const cmdId = normalizeCommandId(parsed.command)
      if (!isSafeCommandId(cmdId)) {
        return { tool_use_id: call.id, content: `Error: Invalid command name: ${parsed.command}`, is_error: true }
      }

      const meta = store.get(cmdId)
      if (!meta) {
        const list = available.length ? available.map((c) => c.command).join(', ') : '(none)'
        return {
          tool_use_id: call.id,
          content: `Error: Unknown slash command: ${parsed.command}\nAvailable commands: ${list}`,
          is_error: true,
        }
      }

      if (meta.disableModelInvocation) {
        return {
          tool_use_id: call.id,
          content: `Error: Slash command is disabled for model invocation: ${meta.id}`,
          is_error: true,
        }
      }

      return {
        tool_use_id: call.id,
        content: buildFileCommandExpandedText({ command: meta.id, args: parsed.args, body: meta.body }),
      }
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

function normalizeCommandId(raw: string): string {
  const text = String(raw || '').trim()
  if (!text) return text
  if (text.startsWith('/')) return text
  return '/' + text
}

function isSafeCommandId(id: string): boolean {
  if (!id.startsWith('/')) return false
  if (id.includes('..')) return false
  if (id.slice(1).includes('/')) return false
  if (id.includes('\\')) return false
  const body = id.slice(1)
  if (!body) return false
  return body.split(':').every((seg) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(seg))
}

function listAvailableCommands(store: ReturnType<typeof createCommandStore>): Array<{ command: string; description: string }> {
  return store
    .list()
    .filter((c) => !c.disableModelInvocation)
    .map((c) => ({ command: c.id, description: c.description }))
    .sort((a, b) => a.command.localeCompare(b.command))
}
