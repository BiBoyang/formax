import type { ToolCallItem, ToolStatus, ToolUiBlock } from './toolUiBlocksTypes'
import { formatToolParams, stringifyToolParams } from './formatToolParams'
import { sanitizeToolTextPaths } from './pathDisplay'
import { parseAskAnswerLines } from '../../../../../src/features/tools/presentation/askAnswers'
import { parseJsonArrayLength } from '../../../../../src/features/tools/presentation/paramsText'
import {
  formatItemCountLabel,
  formatQuestionCountLabel,
  summarizeAskUserQuestionStatus,
  summarizePlanModeStatus,
  summarizeTodoWriteStatus,
} from '../../../../../src/features/tools/presentation/labels'
import {
  getToolPresentationSemantic,
  type ToolPresentationSemantic,
} from '../../../../../src/features/tools/presentation/toolSemantics'

type ToolRenderContext = {
  cwd?: string
}

type ToolBlockRenderer = (item: ToolCallItem, context: ToolRenderContext) => ToolUiBlock[]

function toToolStatus(status: ToolCallItem['status']): ToolStatus {
  if (status === 'running' || status === 'completed' || status === 'error') return status
  return 'pending'
}

function withStandardBlocks(args: {
  item: ToolCallItem
  title: string
  summary: string
  paramsText?: string
  cwd?: string
  detailLines?: string[]
}): ToolUiBlock[] {
  const summary = sanitizeToolTextPaths(args.summary, args.cwd)
  const rawDetailLines = args.detailLines ?? args.item.detailLines
  const detailLines = rawDetailLines.map((line) => sanitizeToolTextPaths(line, args.cwd))
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(args.item.status),
      title: args.title,
      ...(args.paramsText ? { paramsText: args.paramsText } : {}),
      summary,
      ...(args.item.inputState ? { inputState: args.item.inputState } : {}),
      expandable: detailLines.length > 0,
    },
  ]
  if (detailLines.length > 0) {
    blocks.push({ kind: 'details', lines: detailLines })
  }
  return blocks
}

const defaultRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const paramsText = stringifyToolParams(params) ?? item.paramsText
  return withStandardBlocks({
    item,
    title: item.toolName,
    summary: item.summary,
    cwd: context.cwd,
    ...(paramsText ? { paramsText } : {}),
  })
}

const bashRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const command = params.find((param) => param.label === 'command')?.value
  const title = command ? `Bash ${command}` : item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'command')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    cwd: context.cwd,
    ...(paramsText ? { paramsText } : {}),
  })
}

const globRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const pattern = params.find((param) => param.label === 'pattern')?.value
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'pattern')) : item.paramsText
  const headerSummary = pattern ? `pattern: ${pattern}` : sanitizeToolTextPaths(item.summary, context.cwd)
  const detailLines = item.detailLines.map((line) => sanitizeToolTextPaths(line, context.cwd))
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title: item.toolName,
      ...(paramsText ? { paramsText } : {}),
      summary: headerSummary,
      ...(item.inputState ? { inputState: item.inputState } : {}),
      expandable: detailLines.length > 0,
    },
  ]
  if (detailLines.length > 0) {
    blocks.push({ kind: 'details', lines: detailLines })
  } else if (pattern && item.summary && item.summary !== headerSummary) {
    blocks.push({ kind: 'info', text: sanitizeToolTextPaths(item.summary, context.cwd) })
  }
  return blocks
}

const searchRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const pattern = params.find((param) => param.label === 'pattern')?.value
  const title = pattern ? `${item.toolName} ${pattern}` : item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'pattern')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    cwd: context.cwd,
    ...(paramsText ? { paramsText } : {}),
  })
}

function readLikeSummary(item: ToolCallItem, file: string | undefined, context: ToolRenderContext): string {
  const fallback = sanitizeToolTextPaths(item.summary, context.cwd)
  if (item.status === 'error') return fallback
  if (!file) return fallback
  if (item.status !== 'completed') return fallback
  if (item.toolName === 'Write') return `Wrote ${file}`
  if (item.toolName === 'Edit') return `Edited ${file}`
  return fallback
}

const readLikeRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const file = params.find((param) => param.label === 'file')?.value
  const title = file ? `${item.toolName} ${file}` : item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'file')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: readLikeSummary(item, file, context),
    cwd: context.cwd,
    ...(paramsText ? { paramsText } : {}),
  })
}

const webSearchRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const query = params.find((param) => param.label === 'query')?.value
  const title = query ? `WebSearch ${query}` : item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'query')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    cwd: context.cwd,
    ...(paramsText ? { paramsText } : {}),
  })
}

const webFetchRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const url = params.find((param) => param.label === 'url')?.value
  const title = url ? `WebFetch ${url}` : item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'url')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    cwd: context.cwd,
    ...(paramsText ? { paramsText } : {}),
  })
}

const taskRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
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
    cwd: context.cwd,
    ...(paramsText ? { paramsText } : {}),
  })
}

const askQuestionRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const questions = params.find((param) => param.label === 'questions')
  const count = questions ? parseJsonArrayLength(questions.value) : null
  const title = count == null ? item.toolName : `${item.toolName} ${formatQuestionCountLabel(count)}`
  const parsedAnswers = item.status === 'completed' ? parseAskAnswerLines(item.detailLines) : null
  const fallbackSummary = sanitizeToolTextPaths(item.summary, context.cwd)
  const summary = summarizeAskUserQuestionStatus({
    status: toToolStatus(item.status),
    fallbackSummary,
    answerCount: parsedAnswers?.answerCount ?? null,
  })
  return withStandardBlocks({
    item,
    title,
    summary,
    cwd: context.cwd,
    ...(parsedAnswers ? { detailLines: parsedAnswers.lines } : {}),
  })
}

const todoWriteRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const todos = params.find((param) => param.label === 'todos')
  const count = todos ? parseJsonArrayLength(todos.value) : null
  const title = count == null ? item.toolName : `${item.toolName} ${formatItemCountLabel(count)}`
  const summary = summarizeTodoWriteStatus({
    status: toToolStatus(item.status),
    fallbackSummary: sanitizeToolTextPaths(item.summary, context.cwd),
  })
  return withStandardBlocks({
    item,
    title,
    summary,
    cwd: context.cwd,
  })
}

function getPlanModeSummary(args: {
  item: ToolCallItem
  kind: 'enter' | 'exit'
  context: ToolRenderContext
}): string {
  return summarizePlanModeStatus({
    kind: args.kind,
    status: toToolStatus(args.item.status),
    fallbackSummary: sanitizeToolTextPaths(args.item.summary, args.context.cwd),
  })
}

const enterPlanModeRenderer: ToolBlockRenderer = (item, context) => {
  return withStandardBlocks({
    item,
    title: 'Enter plan mode',
    summary: getPlanModeSummary({ item, kind: 'enter', context }),
    cwd: context.cwd,
  })
}

const exitPlanModeRenderer: ToolBlockRenderer = (item, context) => {
  return withStandardBlocks({
    item,
    title: 'Exit plan mode',
    summary: getPlanModeSummary({ item, kind: 'exit', context }),
    cwd: context.cwd,
  })
}

const renderers: Record<string, ToolBlockRenderer> = {
  Bash: bashRenderer,
  Glob: globRenderer,
  Grep: searchRenderer,
  Search: searchRenderer,
  Read: readLikeRenderer,
  Write: readLikeRenderer,
  Edit: readLikeRenderer,
  WebSearch: webSearchRenderer,
  WebFetch: webFetchRenderer,
  Task: taskRenderer,
}

const semanticRenderers: Partial<Record<ToolPresentationSemantic, ToolBlockRenderer>> = {
  ask_user_question: askQuestionRenderer,
  todo_write: todoWriteRenderer,
  enter_plan_mode: enterPlanModeRenderer,
  exit_plan_mode: exitPlanModeRenderer,
}

export function buildToolUiBlocks(item: ToolCallItem, context: ToolRenderContext = {}): ToolUiBlock[] {
  const semantic = getToolPresentationSemantic(item.toolName)
  const renderer = semanticRenderers[semantic] ?? renderers[item.toolName] ?? defaultRenderer
  return renderer(item, context)
}
