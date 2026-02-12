import type { ToolCallItem, ToolStatus, ToolUiBlock } from './toolUiBlocksTypes'
import { formatToolParams, stringifyToolParams } from './formatToolParams'

type ToolBlockRenderer = (item: ToolCallItem) => ToolUiBlock[]

function toToolStatus(status: ToolCallItem['status']): ToolStatus {
  if (status === 'running' || status === 'completed' || status === 'error') return status
  return 'pending'
}

function withStandardBlocks(args: {
  item: ToolCallItem
  title: string
  summary: string
  paramsText?: string
}): ToolUiBlock[] {
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(args.item.status),
      title: args.title,
      ...(args.paramsText ? { paramsText: args.paramsText } : {}),
      summary: args.summary,
      ...(args.item.inputState ? { inputState: args.item.inputState } : {}),
      expandable: args.item.detailLines.length > 0,
    },
  ]
  if (args.item.detailLines.length > 0) {
    blocks.push({ kind: 'details', lines: args.item.detailLines })
  }
  return blocks
}

function arrayCountFromParamValue(value: string): number | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}

const defaultRenderer: ToolBlockRenderer = (item) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText })
  const paramsText = stringifyToolParams(params) ?? item.paramsText
  return withStandardBlocks({
    item,
    title: item.toolName,
    summary: item.summary,
    ...(paramsText ? { paramsText } : {}),
  })
}

const bashRenderer: ToolBlockRenderer = (item) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText })
  const command = params.find((param) => param.label === 'command')?.value
  const title = command ? `Bash ${command}` : item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'command')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    ...(paramsText ? { paramsText } : {}),
  })
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

const readLikeRenderer: ToolBlockRenderer = (item) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText })
  const file = params.find((param) => param.label === 'file')?.value
  const title = file ? `${item.toolName} ${file}` : item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'file')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    ...(paramsText ? { paramsText } : {}),
  })
}

const webSearchRenderer: ToolBlockRenderer = (item) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText })
  const query = params.find((param) => param.label === 'query')?.value
  const title = query ? `WebSearch ${query}` : item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'query')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    ...(paramsText ? { paramsText } : {}),
  })
}

const webFetchRenderer: ToolBlockRenderer = (item) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText })
  const url = params.find((param) => param.label === 'url')?.value
  const title = url ? `WebFetch ${url}` : item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'url')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    ...(paramsText ? { paramsText } : {}),
  })
}

const taskRenderer: ToolBlockRenderer = (item) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText })
  const subagent = params.find((param) => param.label === 'subagent_type')?.value
  const description = params.find((param) => param.label === 'description')?.value
  const title =
    subagent && description
      ? `Task ${subagent}(${description})`
      : subagent
        ? `Task ${subagent}`
        : description
          ? `Task (${description})`
          : item.toolName
  const paramsText =
    params.length > 0
      ? stringifyToolParams(params.filter((param) => param.label !== 'subagent_type' && param.label !== 'description'))
      : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    ...(paramsText ? { paramsText } : {}),
  })
}

const askQuestionRenderer: ToolBlockRenderer = (item) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText })
  const questions = params.find((param) => param.label === 'questions')
  const count = questions ? arrayCountFromParamValue(questions.value) : null
  const title = count == null ? item.toolName : `${item.toolName} ${count} questions`
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'questions')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    ...(paramsText ? { paramsText } : {}),
  })
}

const todoWriteRenderer: ToolBlockRenderer = (item) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText })
  const todos = params.find((param) => param.label === 'todos')
  const count = todos ? arrayCountFromParamValue(todos.value) : null
  const title = count == null ? item.toolName : `${item.toolName} ${count} items`
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'todos')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    ...(paramsText ? { paramsText } : {}),
  })
}

const renderers: Record<string, ToolBlockRenderer> = {
  Bash: bashRenderer,
  Glob: globRenderer,
  Read: readLikeRenderer,
  Write: readLikeRenderer,
  Edit: readLikeRenderer,
  WebSearch: webSearchRenderer,
  WebFetch: webFetchRenderer,
  Task: taskRenderer,
  AskUserQuestion: askQuestionRenderer,
  TodoWrite: todoWriteRenderer,
}

export function buildToolUiBlocks(item: ToolCallItem): ToolUiBlock[] {
  const renderer = renderers[item.toolName] ?? defaultRenderer
  return renderer(item)
}
