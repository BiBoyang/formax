import type {
  ToolDefinition,
  ToolReferenceBlock,
  ToolResultContent,
  ToolResultContentBlock,
} from '../toolContracts'

function stringifyUnknownBlock(block: ToolResultContentBlock): string {
  try {
    return JSON.stringify(block)
  } catch {
    return ''
  }
}

function toolReferenceToText(block: ToolReferenceBlock): string {
  const name = typeof block.tool_name === 'string'
    ? block.tool_name.trim()
    : typeof block.name === 'string'
      ? block.name.trim()
      : ''
  const description = typeof block.description === 'string' ? block.description.trim() : ''
  if (!name) return description
  return description ? `${name}: ${description}` : name
}

export function toolResultContentToText(content: ToolResultContent): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) {
    if (content === null || content === undefined) return ''
    if (typeof content === 'number' || typeof content === 'boolean' || typeof content === 'bigint') {
      return String(content)
    }
    return ''
  }

  const lines: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if ((block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string' && text) lines.push(text)
      continue
    }
    if ((block as { type?: unknown }).type === 'tool_reference') {
      const text = toolReferenceToText(block as ToolReferenceBlock)
      if (text) lines.push(text)
      continue
    }

    const text = stringifyUnknownBlock(block)
    if (text) lines.push(text)
  }
  return lines.join('\n')
}

export function toToolReferenceBlock(tool: ToolDefinition): ToolReferenceBlock {
  return {
    type: 'tool_reference',
    tool_name: tool.name,
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
    ...(tool.defer_loading === true ? { defer_loading: true } : {}),
  }
}
