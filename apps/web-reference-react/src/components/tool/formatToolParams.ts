import {
  orderToolParamsByToolName,
  parseToolParamsText,
  stringifyToolParams as stringifySharedToolParams,
  type ToolParamDisplay,
} from '../../parity/tools/paramsText'
import { formatPathForToolDisplay } from './pathDisplay'

const MAX_VALUE_LENGTH = 80
const REDACTED_VALUE = '[REDACTED]'

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 3))}...`
}

function isPathLikeLabel(label: string): boolean {
  const lower = label.toLowerCase()
  if (lower === 'cwd' || lower === 'path' || lower === 'file') return true
  if (lower.endsWith('_path')) return true
  return false
}

function normalizePathValue(param: ToolParamDisplay, cwd?: string): ToolParamDisplay {
  if (param.valueType !== 'string') return param
  if (!isPathLikeLabel(param.label)) return param
  return {
    ...param,
    value: formatPathForToolDisplay(param.value, cwd),
  }
}

function truncateDisplayValue(param: ToolParamDisplay): ToolParamDisplay {
  if (param.value === REDACTED_VALUE) return param
  return {
    ...param,
    value: truncate(param.value, MAX_VALUE_LENGTH),
  }
}

export function formatToolParams(args: { toolName: string; paramsText?: string; cwd?: string }): ToolParamDisplay[] {
  const parsed = parseToolParamsText(args.paramsText)
  if (parsed.length === 0) return []
  const ordered = orderToolParamsByToolName(args.toolName, parsed)
  return ordered.map((param) => truncateDisplayValue(normalizePathValue(param, args.cwd)))
}

export function stringifyToolParams(params: ToolParamDisplay[]): string | undefined {
  return stringifySharedToolParams(params)
}
