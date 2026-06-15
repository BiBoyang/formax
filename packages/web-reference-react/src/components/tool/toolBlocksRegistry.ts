import type { ToolCallItem, ToolDisplayDensity, ToolStatus, ToolUiBlock, ToolUiTodoItemStatus } from './toolUiBlocksTypes'
import { formatToolParams, stringifyToolParams } from './formatToolParams'
import { sanitizeToolTextPaths } from './pathDisplay'
import { parseAskAnswerLines } from '../../parity/tools/askAnswers'
import {
  parseJsonArrayLength,
  parseToolParamsText,
} from '../../parity/tools/paramsText'
import {
  formatQuestionCountLabel,
  summarizeAskUserQuestionStatus,
  summarizePlanModeStatus,
  summarizeTodoWriteStatus,
} from '../../parity/tools/labels'
import {
  getToolPresentationSemantic,
  type ToolPresentationSemantic,
} from '../../parity/tools/toolSemantics'
import { resolveInteractivePromptModel } from '../../parity/tools/interactivePrompts'
import { isToolItemExpandable } from './toolItemExpansionPolicy'

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

function canExpandToolItem(item: ToolCallItem, hasDetails: boolean): boolean {
  return isToolItemExpandable({
    toolName: item.toolName,
    semantic: getToolPresentationSemantic(item.toolName),
    hasDetails,
  })
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

function normalizeTodoStatus(status: unknown): ToolUiTodoItemStatus {
  if (status === 'pending' || status === 'in_progress' || status === 'completed') return status
  return 'pending'
}

function toTodoItems(raw: unknown, cwd?: string): Array<{ content: string; status: ToolUiTodoItemStatus }> {
  if (!Array.isArray(raw)) return []
  const items: Array<{ content: string; status: ToolUiTodoItemStatus }> = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as { content?: unknown; activeForm?: unknown; status?: unknown }
    const contentCandidate = typeof item.content === 'string' && item.content.trim() ? item.content : item.activeForm
    if (typeof contentCandidate !== 'string' || !contentCandidate.trim()) continue
    items.push({
      content: sanitizeToolTextPaths(contentCandidate.trim(), cwd),
      status: normalizeTodoStatus(item.status),
    })
  }
  return items
}

function withStandardBlocks(args: {
  item: ToolCallItem
  title: string
  summary: string
  subtitle?: string
  subtitleMono?: boolean
  paramsText?: string
  cwd?: string
  detailLines?: string[]
}): ToolUiBlock[] {
  const summary = sanitizeToolTextPaths(args.summary, args.cwd)
  const rawDetailLines = args.detailLines ?? args.item.detailLines
  const detailLines = rawDetailLines.map((line) => sanitizeToolTextPaths(line, args.cwd))
  const expandable = canExpandToolItem(args.item, detailLines.length > 0)
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(args.item.status),
      title: args.title,
      ...(args.subtitle ? { subtitle: args.subtitle } : {}),
      ...(args.subtitleMono ? { subtitleMono: true } : {}),
      ...(args.paramsText ? { paramsText: args.paramsText } : {}),
      summary,
      ...(args.item.inputState ? { inputState: args.item.inputState } : {}),
      expandable,
    },
  ]
  if (expandable) {
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

function parseMcpToolName(toolName: string): { serverId: string; toolName: string } | null {
  if (!toolName.startsWith('mcp__')) return null
  const rest = toolName.slice('mcp__'.length)
  const separator = rest.indexOf('__')
  if (separator <= 0 || separator >= rest.length - 2) return null
  return {
    serverId: rest.slice(0, separator),
    toolName: rest.slice(separator + 2),
  }
}

const mcpRenderer: ToolBlockRenderer = (item, context) => {
  const parsed = parseMcpToolName(item.toolName)
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const paramsText = stringifyToolParams(params) ?? item.paramsText
  return withStandardBlocks({
    item,
    title: parsed ? `MCP ${parsed.serverId}/${parsed.toolName}` : item.toolName,
    summary: item.status === 'running' ? '' : item.summary,
    cwd: context.cwd,
    ...(paramsText ? { paramsText } : {}),
  })
}

function pickParamValue(params: ReturnType<typeof formatToolParams>, label: string): string | undefined {
  return params.find((param) => param.label === label)?.value
}

function collectToolOutputLines(args: { item: ToolCallItem; cwd?: string; sanitizePaths?: boolean }): string[] {
  const sanitize = args.sanitizePaths !== false
  const normalize = (text: string): string =>
    (sanitize ? sanitizeToolTextPaths(text, args.cwd) : text).replace(/\s+$/g, '')
  const summary = normalize(args.item.summary)
  const detailLines = args.item.detailLines.map((line) => normalize(line))
  const out: string[] = []
  if (summary) out.push(summary)
  for (const line of detailLines) {
    if (out.length > 0 && out[out.length - 1] === line) continue
    out.push(line)
  }
  return out
}

function formatOutputLineCount(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'} of output`
}

function withExitCodeLead(lines: string[]): string[] {
  if (lines.length === 0) return lines
  const pattern = /\bexit code\s+(\d+)\b/i
  const hit = lines.find((line) => pattern.exec(line))
  if (!hit) return lines
  const code = pattern.exec(hit)?.[1]
  if (!code) return lines
  const lead = `Exit code ${code}`
  if (lines[0]?.trim().toLowerCase() === lead.toLowerCase()) return lines
  const rest = lines.filter((line) => line.trim().toLowerCase() !== lead.toLowerCase())
  return [lead, ...rest]
}

const bashRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const command = pickParamValue(params, 'command') ?? ''
  const description = pickParamValue(params, 'description')
  const outputLines = item.status === 'running'
    ? []
    : item.status === 'error'
      ? withExitCodeLead(collectToolOutputLines({ item, cwd: context.cwd, sanitizePaths: false }))
      : collectToolOutputLines({ item, cwd: context.cwd, sanitizePaths: false })
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title: 'Bash',
      ...(description
        ? { subtitle: sanitizeToolTextPaths(description, context.cwd) }
        : command
          ? { subtitle: sanitizeToolTextPaths(command, context.cwd), subtitleMono: true }
          : {}),
      ...(item.inputState ? { inputState: item.inputState } : {}),
      expandable: canExpandToolItem(item, Boolean(command || outputLines.length > 0)),
    },
    {
      kind: 'io',
      inputLabel: 'IN',
      inputText: sanitizeToolTextPaths(command, context.cwd),
      ...(outputLines.length > 0
        ? {
            outputLabel: 'OUT',
            outputLines,
          }
        : {}),
      status: toToolStatus(item.status),
    },
  ]
  return blocks
}

const globRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const pattern = params.find((param) => param.label === 'pattern')?.value
  const otherParams = params.filter((param) => param.label !== 'pattern')
  const paramsText = otherParams.length > 0 ? stringifyToolParams(otherParams) : undefined
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title: 'Glob',
      ...(pattern ? { subtitle: `pattern: ${JSON.stringify(pattern)}` } : {}),
      ...(paramsText ? { paramsText } : {}),
      ...(item.inputState ? { inputState: item.inputState } : {}),
      expandable: false,
    },
  ]
  return blocks
}

const searchRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const pattern = params.find((param) => param.label === 'pattern')?.value
  const title = item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'pattern')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    cwd: context.cwd,
    ...(pattern ? { subtitle: pattern } : {}),
    ...(paramsText ? { paramsText } : {}),
  })
}

const grepRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const pattern = params.find((param) => param.label === 'pattern')?.value
  const pathValue = params.find((param) => param.label === 'path')?.value
  const otherParams = params.filter((param) => param.label !== 'pattern' && param.label !== 'path')
  const paramsText = otherParams.length > 0 ? stringifyToolParams(otherParams) : undefined
  const subtitleParts: string[] = []
  if (pattern) subtitleParts.push(JSON.stringify(pattern))
  if (pathValue) subtitleParts.push(`(in ${pathValue})`)
  const outputLines =
    item.status === 'running'
      ? []
      : collectToolOutputLines({ item, cwd: context.cwd })

  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title: 'Grep',
      ...(subtitleParts.length > 0 ? { subtitle: subtitleParts.join(' ') } : {}),
      ...(paramsText ? { paramsText } : {}),
      ...(item.inputState ? { inputState: item.inputState } : {}),
      expandable: false,
    },
  ]

  if (item.status !== 'running' && outputLines.length > 0) {
    blocks.push({ kind: 'info', text: formatOutputLineCount(outputLines.length) })
  }

  return blocks
}

const WRITE_PARAM_STRING_CLIP_LEN = 120
const EDIT_DIFF_MAX_LINES = 400

function isLikelyTruncatedParamsText(paramsText: string | undefined): boolean {
  if (typeof paramsText !== 'string') return false
  return paramsText.trimEnd().endsWith('...')
}

function isLikelyClippedParamString(value: string, paramsText: string | undefined): boolean {
  if (typeof paramsText !== 'string') return false
  if (!value.endsWith('...')) return false
  return value.length === WRITE_PARAM_STRING_CLIP_LEN
}

function toWriteContentLines(content: string): string[] {
  if (content.length === 0) return []
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (normalized.endsWith('\n')) lines.pop()
  return lines
}

type EditDiffLineOp =
  | { kind: 'equal'; line: string }
  | { kind: 'delete'; line: string }
  | { kind: 'insert'; line: string }

function diffLines(oldLines: string[], newLines: string[]): EditDiffLineOp[] {
  const m = oldLines.length
  const n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0))

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const ops: EditDiffLineOp[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ kind: 'equal', line: oldLines[i] })
      i += 1
      j += 1
      continue
    }
    if (dp[i][j + 1] >= dp[i + 1][j]) {
      ops.push({ kind: 'insert', line: newLines[j] })
      j += 1
    } else {
      ops.push({ kind: 'delete', line: oldLines[i] })
      i += 1
    }
  }
  while (i < m) {
    ops.push({ kind: 'delete', line: oldLines[i] })
    i += 1
  }
  while (j < n) {
    ops.push({ kind: 'insert', line: newLines[j] })
    j += 1
  }
  return ops
}

function makeEditPatch(
  oldText: string,
  newText: string,
  startLineNumber?: number,
): { patch: string; additions: number; deletions: number } {
  const oldNormalized = oldText.replace(/\r\n/g, '\n')
  const newNormalized = newText.replace(/\r\n/g, '\n')
  const oldEndsWithNewline = oldNormalized.endsWith('\n')
  const newEndsWithNewline = newNormalized.endsWith('\n')
  const oldLines = toWriteContentLines(oldText)
  const newLines = toWriteContentLines(newText)
  const clippedOld = oldLines.slice(0, EDIT_DIFF_MAX_LINES)
  const clippedNew = newLines.slice(0, EDIT_DIFF_MAX_LINES)
  const ops = diffLines(clippedOld, clippedNew)
  if (oldEndsWithNewline !== newEndsWithNewline) {
    ops.push({
      kind: oldEndsWithNewline ? 'delete' : 'insert',
      line: '[EOF newline]',
    })
  }
  const additions = ops.reduce((count, op) => count + (op.kind === 'insert' ? 1 : 0), 0)
  const deletions = ops.reduce((count, op) => count + (op.kind === 'delete' ? 1 : 0), 0)
  const hasAnchoredStartLineNumber =
    typeof startLineNumber === 'number' && Number.isFinite(startLineNumber) && startLineNumber > 0
  const hunkStart = hasAnchoredStartLineNumber ? Math.floor(startLineNumber) : null
  const patchLines: string[] = [
    hunkStart === null ? '@@ @@' : `@@ -${hunkStart},${clippedOld.length} +${hunkStart},${clippedNew.length} @@`,
  ]
  for (const op of ops) {
    if (op.kind === 'equal') {
      patchLines.push(` ${op.line}`)
      continue
    }
    patchLines.push(`${op.kind === 'delete' ? '-' : '+'}${op.line}`)
  }
  if (oldLines.length > clippedOld.length || newLines.length > clippedNew.length) {
    patchLines.push(` ... diff truncated to first ${EDIT_DIFF_MAX_LINES} lines per side ...`)
  }
  const patch = patchLines.join('\n')
  return {
    patch,
    additions,
    deletions,
  }
}

function pickRawParam(parsed: ReturnType<typeof parseToolParamsText>, keys: string[]): string | undefined {
  for (const key of keys) {
    const hit = parsed.find((entry) => entry.label === key)
    if (hit) return hit.value
  }
  return undefined
}

function pickInputString(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!input) return undefined
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

const readRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const file = params.find((param) => param.label === 'file')?.value
  return [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title: 'Read',
      ...(file ? { subtitle: file, subtitleMono: true } : {}),
      ...(item.inputState ? { inputState: item.inputState } : {}),
      expandable: false,
    },
  ]
}

const writeRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const file = params.find((param) => param.label === 'file')?.value
  const paramsTextTruncated = isLikelyTruncatedParamsText(item.paramsText)
  const rawParams = parseToolParamsText(item.paramsText)
  const rawContent = pickRawParam(rawParams, ['content'])
  const contentTruncated =
    typeof rawContent === 'string' && isLikelyClippedParamString(rawContent, item.paramsText)
  const previewLines = typeof rawContent === 'string' ? toWriteContentLines(rawContent) : []
  const errorLines = item.status === 'error' ? collectToolOutputLines({ item, cwd: context.cwd }) : []
  const hasDeferredDetails = item.status !== 'running' &&
    (errorLines.length > 0 || paramsTextTruncated || contentTruncated || previewLines.length > 0)
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title: 'Write',
      ...(file ? { subtitle: file, subtitleMono: true } : {}),
      ...(item.inputState ? { inputState: item.inputState } : {}),
      expandable: canExpandToolItem(item, hasDeferredDetails),
    },
  ]
  if (errorLines.length > 0) {
    blocks.push({ kind: 'details', lines: errorLines })
  }
  if (item.status !== 'running') {
    if (paramsTextTruncated || contentTruncated) {
      blocks.push({
        kind: 'info',
        text: 'Preview unavailable (tool input was truncated).',
      })
    } else if (previewLines.length > 0) {
      blocks.push({
        kind: 'code_preview',
        lineCount: previewLines.length,
        lines: previewLines,
      })
    }
  }
  return blocks
}

const editRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const fileFromInput = pickInputString(item.input, ['file_path', 'path'])
  const rawFile = fileFromInput ?? params.find((param) => param.label === 'file')?.value
  const file = rawFile ? sanitizeToolTextPaths(rawFile, context.cwd) : undefined
  const rawParams = parseToolParamsText(item.paramsText)
  const inputOldString = pickInputString(item.input, ['old_string'])
  const inputNewString = pickInputString(item.input, ['new_string'])
  const rawOldString = inputOldString ?? pickRawParam(rawParams, ['old_string'])
  const rawNewString = inputNewString ?? pickRawParam(rawParams, ['new_string'])
  const hasEditDiff = item.status !== 'running' &&
    item.status !== 'error' &&
    (typeof rawOldString === 'string' || typeof rawNewString === 'string')
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title: 'Edit',
      ...(file ? { subtitle: file, subtitleMono: true } : {}),
      ...(item.inputState ? { inputState: item.inputState } : {}),
      expandable: canExpandToolItem(item, hasEditDiff),
    },
  ]

  if (item.status === 'error') return blocks

  if (item.status !== 'running') {
    const hasOld = typeof rawOldString === 'string'
    const hasNew = typeof rawNewString === 'string'
    if (hasOld || hasNew) {
      const patch = makeEditPatch(
        hasOld ? rawOldString : '',
        hasNew ? rawNewString : '',
        item.patchStartLineNumber,
      )
      blocks.push({
        kind: 'diff',
        files: [
          {
            path: file ?? 'file',
            additions: patch.additions,
            deletions: patch.deletions,
            patch: patch.patch,
          },
        ],
      })
    }
  }

  return blocks
}

const webSearchRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const query = params.find((param) => param.label === 'query')?.value
  const title = item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'query')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    cwd: context.cwd,
    ...(query ? { subtitle: query } : {}),
    ...(paramsText ? { paramsText } : {}),
  })
}

const webFetchRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const url = params.find((param) => param.label === 'url')?.value
  const title = item.toolName
  const paramsText = params.length > 0 ? stringifyToolParams(params.filter((param) => param.label !== 'url')) : item.paramsText
  return withStandardBlocks({
    item,
    title,
    summary: item.summary,
    cwd: context.cwd,
    ...(url ? { subtitle: url } : {}),
    ...(paramsText ? { paramsText } : {}),
  })
}

const taskRenderer: ToolBlockRenderer = (item, context) => {
  const params = formatToolParams({ toolName: item.toolName, paramsText: item.paramsText, cwd: context.cwd })
  const subagent = params.find((param) => param.label === 'subagent_type')?.value
  const description = params.find((param) => param.label === 'description')?.value
  const title = item.toolName
  const subtitle =
    subagent && description
      ? `${subagent}(${description})`
      : subagent
        ? subagent
        : description
          ? `(${description})`
          : undefined
  const paramsText =
    params.length > 0
      ? stringifyToolParams(params.filter((param) => param.label !== 'subagent_type' && param.label !== 'description'))
      : item.paramsText
  const maxDetailLines = item.status === 'running' ? 8 : 20
  const detailLines = item.detailLines.slice(-maxDetailLines)
  const expandable = canExpandToolItem(item, detailLines.length > 0)
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(paramsText ? { paramsText } : {}),
      ...(item.inputState ? { inputState: item.inputState } : {}),
      expandable,
    },
  ]
  if (expandable) {
    blocks.push({ kind: 'details', lines: detailLines.map((line) => sanitizeToolTextPaths(line, context.cwd)) })
  }
  return blocks
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
  const rawParams = parseToolParamsText(item.paramsText)
  const rawTodosParam = rawParams.find((param) => param.label === 'todos')
  const todosFromInput = toTodoItems(item.input?.todos, context.cwd)
  const todosFromParams = toTodoItems(parseJsonArray(rawTodosParam?.value), context.cwd)
  const todoItems = todosFromInput.length > 0 ? todosFromInput : todosFromParams
  const summary = summarizeTodoWriteStatus({
    status: toToolStatus(item.status),
    fallbackSummary: sanitizeToolTextPaths(item.summary, context.cwd),
  })
  const blocks: ToolUiBlock[] = [
    {
      kind: 'header',
      status: toToolStatus(item.status),
      title: 'Update Todos',
      ...(item.inputState ? { inputState: item.inputState } : {}),
      expandable: false,
    },
  ]
  if (todoItems.length > 0) {
    blocks.push({ kind: 'todo_list', items: todoItems })
    return blocks
  }
  if (summary.trim()) {
    blocks.push({ kind: 'info', text: summary })
  }
  return blocks
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
  Grep: grepRenderer,
  Search: searchRenderer,
  Read: readRenderer,
  Write: writeRenderer,
  Edit: editRenderer,
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
  const renderer = parseMcpToolName(item.toolName)
    ? mcpRenderer
    : semanticRenderers[semantic] ?? renderers[item.toolName] ?? defaultRenderer
  return renderer(item, {
    cwd: context.cwd,
    density: context.density ?? 'compact',
  })
}
