import type { ToolCallItem, ToolStatus, ToolUiBlock } from './toolUiBlocksTypes'

type ToolBlockRenderer = (item: ToolCallItem) => ToolUiBlock[]

function toToolStatus(status: ToolCallItem['status']): ToolStatus {
  if (status === 'running' || status === 'completed' || status === 'error') return status
  return 'pending'
}

function parseParamMap(paramsText: string | undefined): Record<string, string> {
  if (!paramsText) return {}
  const map: Record<string, string> = {}
  const pairs: string[] = []
  let current = ''
  let inString = false
  let escaped = false
  let depth = 0
  for (const char of paramsText) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      current += char
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      current += char
      continue
    }
    if (!inString) {
      if (char === '{' || char === '[') depth += 1
      if ((char === '}' || char === ']') && depth > 0) depth -= 1
      if (char === ',' && depth === 0) {
        const token = current.trim()
        if (token) pairs.push(token)
        current = ''
        continue
      }
    }
    current += char
  }
  const last = current.trim()
  if (last) pairs.push(last)
  for (const pair of pairs) {
    const idx = pair.indexOf('=')
    if (idx <= 0) continue
    const key = pair.slice(0, idx).trim()
    const rawValue = pair.slice(idx + 1).trim()
    if (!key) continue
    map[key] = rawValue
  }
  return map
}

function normalizeDisplay(value: string | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'string') return parsed
    return JSON.stringify(parsed)
  } catch {
    return trimmed
  }
}

const defaultRenderer: ToolBlockRenderer = (item) => {
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title: item.toolName,
      ...(item.paramsText ? { paramsText: item.paramsText } : {}),
      summary: item.summary,
      ...(item.inputState ? { inputState: item.inputState } : {}),
      expandable: item.detailLines.length > 0,
    },
  ]
  if (item.detailLines.length > 0) {
    blocks.push({ kind: 'details', lines: item.detailLines })
  }
  return blocks
}

const bashRenderer: ToolBlockRenderer = (item) => {
  const params = parseParamMap(item.paramsText)
  const command = normalizeDisplay(params.command)
  const title = command ? `Bash ${command}` : item.toolName
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title,
      summary: item.summary,
      ...(item.inputState ? { inputState: item.inputState } : {}),
      expandable: item.detailLines.length > 0,
    },
  ]
  if (item.detailLines.length > 0) {
    blocks.push({ kind: 'details', lines: item.detailLines })
  }
  return blocks
}

const globRenderer: ToolBlockRenderer = (item) => {
  const params = parseParamMap(item.paramsText)
  const pattern = normalizeDisplay(params.pattern ?? params.glob)
  const headerSummary = pattern ? `pattern: ${pattern}` : item.summary
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title: item.toolName,
      summary: headerSummary,
      ...(item.inputState ? { inputState: item.inputState } : {}),
      expandable: item.detailLines.length > 0,
    },
  ]
  if (item.detailLines.length > 0) {
    blocks.push({ kind: 'details', lines: item.detailLines })
  } else if (pattern && item.summary && item.summary !== headerSummary) {
    blocks.push({ kind: 'info', text: item.summary })
  }
  return blocks
}

const renderers: Record<string, ToolBlockRenderer> = {
  Bash: bashRenderer,
  Glob: globRenderer,
}

export function buildToolUiBlocks(item: ToolCallItem): ToolUiBlock[] {
  const renderer = renderers[item.toolName] ?? defaultRenderer
  return renderer(item)
}
