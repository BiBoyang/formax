import type { ToolCallItem } from './toolUiBlocksTypes'

export type ToolParamDisplay = {
  label: string
  value: string
  valueType: 'string' | 'json'
}

const MAX_VALUE_LENGTH = 80
const MAX_PARAMS_TEXT_LENGTH = 180
const REDACTED_VALUE = '[REDACTED]'

function splitParamPairs(paramsText: string): string[] {
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

  const tail = current.trim()
  if (tail) pairs.push(tail)
  return pairs
}

function normalizeRawValue(rawValue: string): Pick<ToolParamDisplay, 'value' | 'valueType'> {
  const trimmed = rawValue.trim()
  if (!trimmed) return { value: '', valueType: 'string' }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'string') {
      return { value: parsed, valueType: 'string' }
    }
    return { value: JSON.stringify(parsed), valueType: 'json' }
  } catch {
    const isJsonLike = trimmed.startsWith('{') || trimmed.startsWith('[')
    return { value: trimmed, valueType: isJsonLike ? 'json' : 'string' }
  }
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 3))}...`
}

function shouldRedact(label: string): boolean {
  const lower = label.toLowerCase()
  return lower.includes('token') || lower.includes('password') || lower.includes('secret') || lower.includes('key')
}

function parseParams(paramsText: string | undefined): ToolParamDisplay[] {
  if (!paramsText) return []
  const pairs = splitParamPairs(paramsText)
  const parsed: ToolParamDisplay[] = []

  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=')
    if (eqIndex <= 0) continue
    const label = pair.slice(0, eqIndex).trim()
    const rawValue = pair.slice(eqIndex + 1)
    if (!label) continue
    const normalized = normalizeRawValue(rawValue)
    parsed.push({
      label,
      value: shouldRedact(label) ? REDACTED_VALUE : truncate(normalized.value, MAX_VALUE_LENGTH),
      ...(shouldRedact(label) ? { valueType: 'string' as const } : { valueType: normalized.valueType }),
    })
  }

  return parsed
}

function pickValue(
  parsed: ToolParamDisplay[],
  usedLabels: Set<string>,
  options: { label: string; keys: string[] },
): ToolParamDisplay | null {
  for (const key of options.keys) {
    const hit = parsed.find((entry) => entry.label === key)
    if (!hit) continue
    usedLabels.add(hit.label)
    return {
      label: options.label,
      value: hit.value,
      valueType: hit.valueType,
    }
  }
  return null
}

export function formatToolParams(args: Pick<ToolCallItem, 'toolName' | 'paramsText'>): ToolParamDisplay[] {
  const parsed = parseParams(args.paramsText)
  if (parsed.length === 0) return []

  const usedLabels = new Set<string>()
  const ordered: ToolParamDisplay[] = []

  const pushPicked = (picked: ToolParamDisplay | null) => {
    if (picked) ordered.push(picked)
  }

  switch (args.toolName) {
    case 'Bash':
      pushPicked(pickValue(parsed, usedLabels, { label: 'command', keys: ['command'] }))
      pushPicked(pickValue(parsed, usedLabels, { label: 'cwd', keys: ['cwd'] }))
      break
    case 'Glob':
      pushPicked(pickValue(parsed, usedLabels, { label: 'pattern', keys: ['pattern', 'glob'] }))
      pushPicked(pickValue(parsed, usedLabels, { label: 'path', keys: ['path'] }))
      break
    case 'Read':
    case 'Write':
    case 'Edit':
      pushPicked(pickValue(parsed, usedLabels, { label: 'file', keys: ['file_path', 'path'] }))
      break
    case 'WebSearch':
      pushPicked(pickValue(parsed, usedLabels, { label: 'query', keys: ['query'] }))
      break
    case 'WebFetch':
      pushPicked(pickValue(parsed, usedLabels, { label: 'url', keys: ['url'] }))
      break
    case 'Task':
      pushPicked(pickValue(parsed, usedLabels, { label: 'subagent_type', keys: ['subagent_type'] }))
      pushPicked(pickValue(parsed, usedLabels, { label: 'description', keys: ['description', 'prompt'] }))
      break
    case 'AskUserQuestion':
      pushPicked(pickValue(parsed, usedLabels, { label: 'questions', keys: ['questions'] }))
      break
    case 'TodoWrite':
      pushPicked(pickValue(parsed, usedLabels, { label: 'todos', keys: ['todos'] }))
      break
    default:
      break
  }

  for (const entry of parsed) {
    if (usedLabels.has(entry.label)) continue
    ordered.push(entry)
  }

  return ordered
}

export function stringifyToolParams(params: ToolParamDisplay[]): string | undefined {
  if (params.length === 0) return undefined
  const renderValue = (param: ToolParamDisplay): string => {
    if (param.valueType === 'json') return param.value
    return JSON.stringify(param.value)
  }
  const text = params
    .map((param) => `${param.label}=${renderValue(param)}`)
    .join(', ')
  const compact = text.trim()
  if (!compact) return undefined
  return truncate(compact, MAX_PARAMS_TEXT_LENGTH)
}
