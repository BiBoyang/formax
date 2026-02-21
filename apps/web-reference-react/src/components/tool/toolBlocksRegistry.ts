import type { ToolCallItem, ToolDisplayDensity, ToolStatus, ToolUiBlock } from './toolUiBlocksTypes'
import { formatToolParams, stringifyToolParams } from './formatToolParams'
import { formatPathForToolDisplay, sanitizeToolTextPaths } from './pathDisplay'
import { parseAskAnswerLines } from '../../../../../src/features/tools/presentation/askAnswers'
import {
  parseJsonArrayLength,
  parseToolParamsText,
} from '../../../../../src/features/tools/presentation/paramsText'
import {
  formatItemCountLabel,
  formatQuestionCountLabel,
  summarizeAskUserQuestionStatus,
  summarizePlanModeStatus,
  summarizeTodoWriteStatus,
} from '../../../../../src/features/tools/presentation/labels'
import { buildBashParamsFromParamsText } from '../../../../../src/features/tools/presentation/bashParams'
import {
  getToolPresentationSemantic,
  type ToolPresentationSemantic,
} from '../../../../../src/features/tools/presentation/toolSemantics'
import { resolveInteractivePromptModel } from '../../../../../src/features/tools/presentation/interactivePrompts'

type ToolRenderContext = {
  cwd?: string
  density?: ToolDisplayDensity
}

type ToolBlockRenderer = (item: ToolCallItem, context: ToolRenderContext) => ToolUiBlock[]

function looksLikeRawJsonPayload(summary: string): boolean {
  const trimmed = summary.trim()
  if (!trimmed) return false
  if (trimmed === '{' || trimmed === '}' || trimmed === '[]' || trimmed === '{}') return true
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function toToolStatus(status: ToolCallItem['status']): ToolStatus {
  if (status === 'running' || status === 'completed' || status === 'error') return status
  return 'pending'
}

function parseJsonArray(raw: string | undefined): unknown[] | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
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
  const bashParams = buildBashParamsFromParamsText(item.paramsText)
  const command = bashParams.command ?? params.find((param) => param.label === 'command')?.value
  const title = command ? `Bash ${command}` : item.toolName
  const normalizedNonCommandParams =
    params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'command')) : undefined
  const paramsText =
    normalizedNonCommandParams ??
    bashParams.paramsTextWithoutCommand ??
    (bashParams.hasCommandParam ? undefined : item.paramsText)
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

const WRITE_DIFF_MAX_LINES = 220
const WRITE_PARAM_STRING_CLIP_LEN = 120

function isLikelyTruncatedParamsText(paramsText: string | undefined): boolean {
  if (typeof paramsText !== 'string') return false
  return paramsText.trimEnd().endsWith('...')
}

function isLikelyClippedWriteContent(content: string, paramsText: string | undefined): boolean {
  if (typeof paramsText !== 'string') return false
  if (!content.endsWith('...')) return false
  return content.length === WRITE_PARAM_STRING_CLIP_LEN
}

function toWriteContentLines(content: string): string[] {
  if (content.length === 0) return []
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (normalized.endsWith('\n')) lines.pop()
  return lines
}

function makeWritePatch(content: string): { patch: string; additions: number; deletions: number } {
  const sourceLines = toWriteContentLines(content)
  const clipped = sourceLines.slice(0, WRITE_DIFF_MAX_LINES)
  const clippedCount = Math.max(0, sourceLines.length - clipped.length)
  const patchLines = clipped.map((line) => `+${line}`)
  if (clippedCount > 0) {
    patchLines.push(`+… (${clippedCount} more lines not shown)`)
  }
  const startLine = sourceLines.length > 0 ? 1 : 0
  const patch = [`@@ -0,0 +${startLine},${sourceLines.length} @@`, ...patchLines].join('\n')
  return {
    patch,
    additions: sourceLines.length,
    deletions: 0,
  }
}

function pickRawParam(parsed: ReturnType<typeof parseToolParamsText>, keys: string[]): string | undefined {
  for (const key of keys) {
    const hit = parsed.find((entry) => entry.label === key)
    if (hit) return hit.value
  }
  return undefined
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

const writeRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const file = params.find((param) => param.label === 'file')?.value
  const title = file ? `${item.toolName} ${file}` : item.toolName
  const summary = readLikeSummary(item, file, context)
  const paramsTextTruncated = isLikelyTruncatedParamsText(item.paramsText)
  const rawParams = parseToolParamsText(item.paramsText)
  const rawContent = pickRawParam(rawParams, ['content'])
  const contentTruncated =
    typeof rawContent === 'string' && isLikelyClippedWriteContent(rawContent, item.paramsText)
  const rawFilePath = pickRawParam(rawParams, ['file_path', 'path'])
  const displayPath = formatPathForToolDisplay(rawFilePath ?? file ?? 'untitled', context.cwd)

  const blocks = withStandardBlocks({
    item,
    title,
    summary,
    cwd: context.cwd,
  })

  if (item.status === 'completed' && (paramsTextTruncated || contentTruncated)) {
    blocks.push({
      kind: 'info',
      text: 'Diff preview unavailable (tool input was truncated).',
    })
  } else if (item.status === 'completed' && typeof rawContent === 'string') {
    const writePatch = makeWritePatch(rawContent)
    blocks.push({
      kind: 'diff',
      files: [
        {
          path: displayPath,
          additions: writePatch.additions,
          deletions: writePatch.deletions,
          patch: writePatch.patch,
        },
      ],
    })
  }

  return blocks
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
  const rawParams = parseToolParamsText(item.paramsText)
  const rawQuestions = rawParams.find((param) => param.label === 'questions')
  const questionValue = rawQuestions?.value ?? questions?.value
  const parsedQuestions = parseJsonArray(questionValue)
  const normalizedQuestions = resolveInteractivePromptModel({
    toolName: item.toolName,
    input: { questions: parsedQuestions ?? [] },
  })
  const count =
    parsedQuestions && normalizedQuestions?.kind === 'ask_user_question'
      ? normalizedQuestions.questions.length
      : questionValue
        ? parseJsonArrayLength(questionValue)
        : null
  const title = count == null ? item.toolName : `${item.toolName} ${formatQuestionCountLabel(count)}`
  const parsedAnswers =
    item.status === 'completed'
      ? parseAskAnswerLines(item.detailLines) ?? parseAskAnswerLines([item.summary])
      : null
  const sanitizedSummary = sanitizeToolTextPaths(item.summary, context.cwd)
  const fallbackSummary =
    item.status === 'completed' && !parsedAnswers && looksLikeRawJsonPayload(sanitizedSummary) ? '' : sanitizedSummary
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
  Write: writeRenderer,
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
  return renderer(item, {
    cwd: context.cwd,
    density: context.density ?? 'compact',
  })
}
