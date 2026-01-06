import fsp from 'node:fs/promises'
import type { ToolDefinition } from './types'

function isToolDefinition(value: unknown): value is ToolDefinition {
  if (!value || typeof value !== 'object') return false
  const v = value as any
  return (
    typeof v.name === 'string' &&
    typeof v.description === 'string' &&
    'input_schema' in v
  )
}

export async function loadToolDefinitions(opts: {
  filePath: string
}): Promise<ToolDefinition[]> {
  try {
    const raw = await fsp.readFile(opts.filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const tools = Array.isArray(parsed?.tools) ? parsed.tools : []
    return tools.filter(isToolDefinition)
  } catch {
    return []
  }
}

