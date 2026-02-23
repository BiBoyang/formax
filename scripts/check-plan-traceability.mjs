import fs from 'node:fs'
import path from 'node:path'
import { runNoClaudeCheck } from './check-no-claude.mjs'

const REPO_ROOT = process.cwd()
const TODO_REL_PATH = 'plans/harness-refactor-loop/TODO-INDEX.md'
const SOURCE_REL_PATH = 'plans/harness-refactor-loop/TASK-SOURCE.md'
const TODO_ENTRY_RE = /^- \[(?: |x|X)\] `([^`]+)` \| source=`([^`]+)` \| acceptance=`([^`]+)`\s*$/
const SOURCE_ID_RE = /^\s*-\s*`([A-Z0-9-]+)`:/

function toAbs(relPath) {
  return path.resolve(REPO_ROOT, relPath)
}

function readLines(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8')
  return raw.replace(/\r\n/g, '\n').split('\n')
}

function sectionLines(lines, heading) {
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start < 0) return []

  const out = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/^##\s+/.test(line.trim())) break
    out.push({ lineNo: i + 1, text: line })
  }
  return out
}

function main() {
  runNoClaudeCheck({ repoRoot: REPO_ROOT })

  const todoAbs = toAbs(TODO_REL_PATH)
  const sourceAbs = toAbs(SOURCE_REL_PATH)
  const errors = []

  if (!fs.existsSync(todoAbs)) errors.push(`missing file: ${TODO_REL_PATH}`)
  if (!fs.existsSync(sourceAbs)) errors.push(`missing file: ${SOURCE_REL_PATH}`)
  if (errors.length > 0) {
    for (const error of errors) console.error(`[plan-traceability] ${error}`)
    process.exitCode = 1
    return
  }

  const todoLines = readLines(todoAbs)
  const sourceLines = readLines(sourceAbs)
  const todoText = todoLines.join('\n')

  if (!todoText.includes(`- \`${SOURCE_REL_PATH}\``)) {
    errors.push(`${TODO_REL_PATH}: task source declaration must point to ${SOURCE_REL_PATH}`)
  }

  const sourceIds = new Set()
  for (let i = 0; i < sourceLines.length; i += 1) {
    const line = sourceLines[i] ?? ''
    const match = line.match(SOURCE_ID_RE)
    if (!match) continue
    sourceIds.add(match[1])
  }
  if (sourceIds.size === 0) {
    errors.push(`${SOURCE_REL_PATH}: no source ids found (expected lines like - \`ID\`:)`)
  }

  const currentSection = sectionLines(todoLines, '## 当前待办')
  if (currentSection.length === 0) {
    errors.push(`${TODO_REL_PATH}: missing section "## 当前待办"`)
  }

  const parsedEntries = []
  let hasNoTaskMarker = false
  for (const line of currentSection) {
    const text = line.text.trim()
    if (!text) continue
    if (/^-\s*(无|暂无未完成项|暂无待办)/.test(text)) {
      hasNoTaskMarker = true
      continue
    }
    if (!text.startsWith('- [')) continue

    const match = text.match(TODO_ENTRY_RE)
    if (!match) {
      errors.push(
        `${TODO_REL_PATH}:${line.lineNo}: invalid TODO format; expected "- [ ] \`ID\` | source=\`SRC\` | acceptance=\`CMD\`"`,
      )
      continue
    }

    const [, taskId, sourceId, acceptance] = match
    parsedEntries.push({ lineNo: line.lineNo, taskId, sourceId, acceptance })
  }

  if (parsedEntries.length === 0 && !hasNoTaskMarker) {
    errors.push(`${TODO_REL_PATH}: current todo section has no tasks and no explicit "无" marker`)
  }

  const seenTaskIds = new Set()
  for (const entry of parsedEntries) {
    if (seenTaskIds.has(entry.taskId)) {
      errors.push(`${TODO_REL_PATH}:${entry.lineNo}: duplicated task id "${entry.taskId}"`)
    }
    seenTaskIds.add(entry.taskId)

    if (!sourceIds.has(entry.sourceId)) {
      errors.push(
        `${TODO_REL_PATH}:${entry.lineNo}: source id "${entry.sourceId}" not found in ${SOURCE_REL_PATH}`,
      )
    }

    if (!entry.acceptance.trim()) {
      errors.push(`${TODO_REL_PATH}:${entry.lineNo}: acceptance command is empty`)
    }
  }

  if (errors.length > 0) {
    console.error('[plan-traceability] check failed:')
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }

  console.log(
    `[plan-traceability] check passed. sourceIds=${sourceIds.size}, currentTodos=${parsedEntries.length}, source=${SOURCE_REL_PATH}`,
  )
}

main()
