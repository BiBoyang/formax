export type ToolParamValueType = 'string' | 'json'

export type ToolParamDisplay = {
  label: string
  value: string
  valueType: ToolParamValueType
}

const REDACTED_VALUE = '[REDACTED]'
const DEFAULT_MAX_PARAMS_TEXT_LENGTH = 180
const DEFAULT_MAX_STRING_VALUE_LENGTH = 120
const DEFAULT_MAX_JSON_VALUE_LENGTH = 2000
const DEFAULT_MAX_PARAM_COUNT = 12

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

function shouldRedact(label: string): boolean {
  const lower = label.toLowerCase()
  return lower.includes('token') || lower.includes('password') || lower.includes('secret') || lower.includes('key')
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 3))}...`
}

function normalizeUnknownValue(
  value: unknown,
  options?: { maxStringLength?: number; maxJsonLength?: number },
): Pick<ToolParamDisplay, 'value' | 'valueType'> {
  const maxStringLength = options?.maxStringLength ?? DEFAULT_MAX_STRING_VALUE_LENGTH
  const maxJsonLength = options?.maxJsonLength ?? DEFAULT_MAX_JSON_VALUE_LENGTH

  if (typeof value === 'string') {
    return { value: truncate(value, maxStringLength), valueType: 'string' }
  }

  const asJson = JSON.stringify(value)
  if (typeof asJson !== 'string') return { value: '', valueType: 'string' }

  if (asJson.length <= maxJsonLength) {
    return { value: asJson, valueType: 'json' }
  }

  return { value: JSON.stringify({ truncated: true }), valueType: 'json' }
}

function parseJsonObjectParams(paramsText: string): ToolParamDisplay[] | null {
  const trimmed = paramsText.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return Object.entries(parsed as Record<string, unknown>).map(([label, value]) => {
      if (shouldRedact(label)) {
        return { label, value: REDACTED_VALUE, valueType: 'string' as const }
      }
      const normalized = normalizeUnknownValue(value)
      return { label, value: normalized.value, valueType: normalized.valueType }
    })
  } catch {
    return null
  }
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

export function parseToolParamsText(paramsText: string | undefined): ToolParamDisplay[] {
  if (!paramsText) return []
  const parsedJsonObject = parseJsonObjectParams(paramsText)
  if (parsedJsonObject) return parsedJsonObject
  const pairs = splitParamPairs(paramsText)
  const parsed: ToolParamDisplay[] = []

  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=')
    if (eqIndex <= 0) continue
    const label = pair.slice(0, eqIndex).trim()
    const rawValue = pair.slice(eqIndex + 1)
    const normalized = normalizeRawValue(rawValue)
    parsed.push({
      label,
      value: shouldRedact(label) ? REDACTED_VALUE : normalized.value,
      ...(shouldRedact(label) ? { valueType: 'string' as const } : { valueType: normalized.valueType }),
    })
  }

  return parsed
}

export function formatToolInputAsParamsText(
  input: unknown,
  options?: {
    maxStringLength?: number
    maxJsonLength?: number
    maxParams?: number
  },
): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined

  const maxParams = options?.maxParams ?? DEFAULT_MAX_PARAM_COUNT
  const entries = Object.entries(input as Record<string, unknown>).slice(0, maxParams)
  if (entries.length === 0) return undefined

  const params: ToolParamDisplay[] = entries.map(([label, value]) => {
    if (shouldRedact(label)) {
      return { label, value: REDACTED_VALUE, valueType: 'string' as const }
    }
    const normalized = normalizeUnknownValue(value, {
      maxStringLength: options?.maxStringLength,
      maxJsonLength: options?.maxJsonLength,
    })
    return { label, value: normalized.value, valueType: normalized.valueType }
  })

  return stringifyToolParams(params, Number.MAX_SAFE_INTEGER)
}

export function orderToolParamsByToolName(toolName: string, parsed: ToolParamDisplay[]): ToolParamDisplay[] {
  if (parsed.length === 0) return []
  const usedLabels = new Set<string>()
  const ordered: ToolParamDisplay[] = []
  const pushPicked = (picked: ToolParamDisplay | null) => {
    if (picked) ordered.push(picked)
  }

  switch (toolName) {
    case 'Bash':
      pushPicked(pickValue(parsed, usedLabels, { label: 'command', keys: ['command'] }))
      pushPicked(pickValue(parsed, usedLabels, { label: 'cwd', keys: ['cwd'] }))
      break
    case 'Glob':
      pushPicked(pickValue(parsed, usedLabels, { label: 'pattern', keys: ['pattern', 'glob'] }))
      pushPicked(pickValue(parsed, usedLabels, { label: 'path', keys: ['path'] }))
      break
    case 'Grep':
    case 'Search':
      pushPicked(pickValue(parsed, usedLabels, { label: 'pattern', keys: ['pattern'] }))
      pushPicked(pickValue(parsed, usedLabels, { label: 'path', keys: ['path'] }))
      pushPicked(pickValue(parsed, usedLabels, { label: 'output_mode', keys: ['output_mode'] }))
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

export function stringifyToolParams(params: ToolParamDisplay[], maxLength = DEFAULT_MAX_PARAMS_TEXT_LENGTH): string | undefined {
  if (params.length === 0) return undefined
  const renderValue = (param: ToolParamDisplay): string => {
    if (param.valueType === 'json') return param.value
    return JSON.stringify(param.value)
  }
  const text = params
    .map((param) => `${param.label}=${renderValue(param)}`)
    .join(', ')
  return truncate(text.trim(), maxLength)
}

export function parseJsonArrayLength(value: string): number | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}
