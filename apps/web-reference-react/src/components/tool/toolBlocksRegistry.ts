import type { ToolCallItem, ToolStatus, ToolUiBlock } from './toolUiBlocksTypes'
import { formatToolParams, stringifyToolParams } from './formatToolParams'

type ToolBlockRenderer = (item: ToolCallItem) => ToolUiBlock[]

function toToolStatus(status: ToolCallItem['status']): ToolStatus {
  if (status === 'running' || status === 'completed' || status === 'error') return status
  return 'pending'
}

const defaultRenderer: ToolBlockRenderer = (item) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText })
  const paramsText = stringifyToolParams(params) ?? item.paramsText
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title: item.toolName,
      ...(paramsText ? { paramsText } : {}),
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
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText })
  const command = params.find((param) => param.label === 'command')?.value
  const title = command ? `Bash ${command}` : item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'command')) : item.paramsText
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title,
      ...(paramsText ? { paramsText } : {}),
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
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText })
  const pattern = params.find((param) => param.label === 'pattern')?.value
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'pattern')) : item.paramsText
  const headerSummary = pattern ? `pattern: ${pattern}` : item.summary
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title: item.toolName,
      ...(paramsText ? { paramsText } : {}),
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
