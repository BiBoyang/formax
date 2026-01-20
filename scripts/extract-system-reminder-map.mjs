import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.argv[2] || '/Users/david/Documents/github/formax/proxy'

function walk(dir) {
  const out = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

function extractReminderBlocks(text) {
  const blocks = []
  const open = '<system-reminder>'
  const close = '</system-reminder>'
  let i = 0
  while (true) {
    const a = text.indexOf(open, i)
    if (a === -1) break
    const b = text.indexOf(close, a + open.length)
    if (b === -1) break
    const inner = text.slice(a + open.length, b)
    blocks.push(inner)
    i = b + close.length
  }
  return blocks
}

function normalize(s) {
  return s.replace(/\r\n/g, '\n').trim()
}

function isExcludedReminder(inner) {
  const t = normalize(inner)
  return t.startsWith('This is a reminder') || t.startsWith('As you answer the')
}

function truncate(s, max = 220) {
  const t = normalize(s).replace(/\n+/g, '\n')
  if (!t) return ''
  if (t.length <= max) return t
  return t.slice(0, max).trimEnd() + '…'
}

const files = walk(ROOT).filter((f) => /_v1_messages(\.simple)?\.json$/.test(f))

const toolUseNameById = new Map() // id -> name
const reminderEvents = []

for (const f of files) {
  let json
  try {
    json = JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    continue
  }

  // Our proxy captures often store the Anthropic payload under request.body
  // (and sometimes other nesting shapes). Find all message arrays defensively.
  const candidates = []
  if (Array.isArray(json?.messages)) candidates.push(json.messages)
  if (Array.isArray(json?.request?.body?.messages)) candidates.push(json.request.body.messages)
  if (Array.isArray(json?.body?.messages)) candidates.push(json.body.messages)
  if (Array.isArray(json?.data?.messages)) candidates.push(json.data.messages)

  // If still empty, do a shallow-ish recursive search for { messages: [...] }
  if (candidates.length === 0) {
    const seen = new Set()
    const stack = [json]
    while (stack.length) {
      const cur = stack.pop()
      if (!cur || typeof cur !== 'object') continue
      if (seen.has(cur)) continue
      seen.add(cur)
      if (Array.isArray(cur.messages)) candidates.push(cur.messages)
      for (const v of Object.values(cur)) {
        if (v && typeof v === 'object') stack.push(v)
      }
    }
  }

  const msgs = candidates.flat()

  // Pass 1: collect tool_use id -> name
  for (const m of msgs) {
    const content = Array.isArray(m?.content) ? m.content : []
    for (const item of content) {
      if (item?.type === 'tool_use' && typeof item?.id === 'string' && typeof item?.name === 'string') {
        toolUseNameById.set(item.id, item.name)
      }
    }
  }

  // Pass 2: find tool_result that contains system-reminder
  for (const m of msgs) {
    const content = Array.isArray(m?.content) ? m.content : []
    for (const item of content) {
      if (item?.type !== 'tool_result') continue
      const toolUseId = item?.tool_use_id
      const c = item?.content
      if (typeof c !== 'string') continue
      if (!c.includes('<system-reminder>')) continue

      const blocks = extractReminderBlocks(c)
      for (const inner of blocks) {
        if (isExcludedReminder(inner)) continue
        reminderEvents.push({
          file: f,
          tool_use_id: typeof toolUseId === 'string' ? toolUseId : null,
          tool_name: typeof toolUseId === 'string' ? toolUseNameById.get(toolUseId) ?? null : null,
          reminder: normalize(inner),
          tool_result_prefix: normalize(c.split('<system-reminder>')[0] ?? '').slice(0, 2000),
        })
      }
    }
  }
}

// Aggregate mapping: tool_name -> reminder -> occurrences
const agg = new Map() // toolName -> Map(reminder -> {count, examples})
for (const ev of reminderEvents) {
  const tool = ev.tool_name ?? '(unknown-tool)'
  if (!agg.has(tool)) agg.set(tool, new Map())
  const inner = agg.get(tool)
  const key = ev.reminder
  if (!inner.has(key)) inner.set(key, { count: 0, examples: [] })
  const cell = inner.get(key)
  cell.count++
  // Keep ALL examples; downstream output can decide how to summarize.
  cell.examples.push({
    file: ev.file,
    tool_use_id: ev.tool_use_id,
    tool_result_prefix: ev.tool_result_prefix,
  })
}

const outJson = {
  root: ROOT,
  scanned_files: files.length,
  reminder_events: reminderEvents.length,
  tools: Array.from(agg.entries()).map(([tool, byReminder]) => ({
    tool,
    reminders: Array.from(byReminder.entries()).map(([reminder, v]) => {
      // Deduplicate examples by tool_use_id, prefer non-.simple.json capture file when both exist.
      const byId = new Map()
      for (const ex of v.examples) {
        const id = ex.tool_use_id ?? 'unknown'
        const prev = byId.get(id)
        if (!prev) {
          byId.set(id, ex)
          continue
        }
        const prevIsSimple = typeof prev.file === 'string' && prev.file.endsWith('.simple.json')
        const curIsSimple = typeof ex.file === 'string' && ex.file.endsWith('.simple.json')
        if (prevIsSimple && !curIsSimple) byId.set(id, ex)
      }

      const examples = Array.from(byId.values())
      return {
        reminder,
        count: v.count,
        examples,
        examples_deduped_by_tool_use_id: examples.length,
      }
    }),
  })),
}

const outMdLines = []
outMdLines.push('### system-reminder 注入映射表（仅统计 tool_result 内的注入）')
outMdLines.push('')
outMdLines.push(`- **扫描目录**: \`${ROOT}\``)
outMdLines.push(`- **扫描文件数**: ${files.length}`)
outMdLines.push(`- **命中注入条数**: ${reminderEvents.length}`)
outMdLines.push('')
outMdLines.push('> 说明：本表只统计出现在 `type=tool_result` 的 `content` 里的 `<system-reminder>...</system-reminder>`（也就是“工具调用返回被注入”的情况）。')
outMdLines.push('')
outMdLines.push('| 工具名 (tool name) | reminder 内容（去掉标签、trim 后） | 次数 | tool_result 正文示例（reminder 之前，截断；去重+计数） | examples（全部在 JSON 里；这里列前 20 条） |')
outMdLines.push('| --- | --- | ---: | --- | --- |')

for (const [tool, byReminder] of Array.from(agg.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
  for (const [reminder, v] of Array.from(byReminder.entries()).sort((a, b) => b[1].count - a[1].count)) {
    const preview = reminder.replace(/\n+/g, '\\n')
    const prefixCounts = new Map()
    for (const ex of v.examples) {
      const key = truncate(ex.tool_result_prefix ?? '', 180) || '(empty)'
      prefixCounts.set(key, (prefixCounts.get(key) ?? 0) + 1)
    }
    const samplePrefix = Array.from(prefixCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([p, n]) => `${String(p).replace(/\n/g, '\\n').replace(/\|/g, '\\|')} (×${n})`)
      .join('<br/>')

    const examples = v.examples
      .slice(0, 20)
      .map((e) => `\`${path.relative(ROOT, e.file)}\` / \`${e.tool_use_id ?? 'unknown'}\``)
      .join('<br/>')
    outMdLines.push(`| \`${tool}\` | ${preview} | ${v.count} | ${samplePrefix} | ${examples} |`)
  }
}

const outMd = outMdLines.join('\n') + '\n'

const outMdPath = path.join(ROOT, 'system-reminder-tool-map.md')
const outJsonPath = path.join(ROOT, 'system-reminder-tool-map.json')

fs.writeFileSync(outMdPath, outMd, 'utf8')
fs.writeFileSync(outJsonPath, JSON.stringify(outJson, null, 2) + '\n', 'utf8')

console.log('Wrote:', outMdPath)
console.log('Wrote:', outJsonPath)
console.log('Scanned files:', files.length)
console.log('Reminder events:', reminderEvents.length)
console.log('Tools:', agg.size)
