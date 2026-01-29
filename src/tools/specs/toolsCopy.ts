/**
 * @deprecated Use individual tool spec files in modules/{tool}/spec.ts instead.
 * This module is only kept for parity testing against src/tools/specs/reference/tools-copy.json.
 *
 * All runtime tool specs should be imported from their respective module directories.
 * The src/tools/specs/reference/tools-copy.json file serves as a reference snapshot for parity validation.
 */
import type { ToolDefinition } from '../types'
import toolsCopy from './reference/tools-copy.json'

export type ToolCopyName =
  | 'AskUserQuestion'
  | 'Bash'
  | 'Edit'
  | 'EnterPlanMode'
  | 'ExitPlanMode'
  | 'Glob'
  | 'Grep'
  | 'KillShell'
  | 'NotebookEdit'
  | 'Read'
  | 'Skill'
  | 'SlashCommand'
  | 'Task'
  | 'TaskOutput'
  | 'TodoWrite'
  | 'WebFetch'
  | 'WebSearch'
  | 'Write'

export type ToolCopySpec = Pick<ToolDefinition, 'name' | 'description' | 'input_schema'>

type ToolsCopyJson = {
  tools?: Array<{ name?: string; description?: string; input_schema?: unknown }>
}

const TOOL_COPY_SPECS: Partial<Record<ToolCopyName, ToolCopySpec>> = Object.create(null)

const rawTools = (toolsCopy as ToolsCopyJson).tools ?? []
for (const tool of rawTools) {
  const name = String(tool?.name ?? '').trim() as ToolCopyName
  if (!name) continue
  TOOL_COPY_SPECS[name] = {
    name,
    description: typeof tool?.description === 'string' ? tool.description : '',
    input_schema: tool?.input_schema,
  }
}

export function getToolCopySpec(name: ToolCopyName): ToolCopySpec {
  const spec = TOOL_COPY_SPECS[name]
  if (!spec) throw new Error(`Missing tools-copy spec for tool: ${name}`)
  return spec
}

export function hasToolCopySpec(name: string): name is ToolCopyName {
  return Object.prototype.hasOwnProperty.call(TOOL_COPY_SPECS, name)
}
