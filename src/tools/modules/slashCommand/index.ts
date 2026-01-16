import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import { SlashCommandToolHandler } from './handler'
import { baseSpec } from './spec'
import { getConfigPaths } from '../../../adapters/fs/configPaths'
import { createCommandStore } from '../../../commands/CommandStore'

function buildAvailableCommandsSection(cwd: string): string {
  const configPaths = getConfigPaths({ cwd, env: process.env })
  const store = createCommandStore({ cwd, globalConfigDir: configPaths.globalConfigDir })
  const commands = store
    .list()
    .filter((c) => !c.disableModelInvocation)
    .map((c) => ({ cmd: c.id, desc: c.description }))

  if (commands.length === 0) return '\nAvailable Commands:\n(none found)\n'
  return '\nAvailable Commands:\n' + commands.map((c) => `- ${c.cmd}: ${c.desc}`).join('\n') + '\n'
}

const spec: ToolDefinition = {
  name: 'SlashCommand',
  description: baseSpec.description + buildAvailableCommandsSection(process.cwd()),
  input_schema: baseSpec.input_schema,
}

export const slashCommandToolModule: ToolModule = {
  name: 'SlashCommand',
  handler: SlashCommandToolHandler,
  spec,
}
