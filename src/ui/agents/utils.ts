import fsp from 'node:fs/promises'
import path from 'node:path'
import { COLOR_MAP } from './constants.js'
import type { ToolsSelectableRow } from './constants.js'

export function normalizeAgentName(raw: string): string {
  const s = String(raw || '').trim().toLowerCase()
  return s
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+/, '')
    .replace(/[-_]+$/, '')
}

export function buildManualSystemPrompt(args: { name: string; description: string }): string {
  return [
    `You are the ${args.name} agent.`,
    '',
    `When to use: ${args.description}`,
    '',
    'Be concise and helpful.',
  ].join('\n')
}

export function truncate(s: string, max: number): string {
  const str = String(s || '')
  if (str.length <= max) return str
  return str.slice(0, Math.max(0, max - 1)) + '…'
}

export function indent(s: string, spaces: number): string {
  const pad = ' '.repeat(Math.max(0, spaces))
  return s
    .split(/\r?\n/)
    .map((line) => (line ? pad + line : line))
    .join('\n')
}

export function colorToHex(color: string, fallback: string): string {
  const c = String(color || '').trim().toLowerCase()
  return COLOR_MAP[c] ?? fallback
}

export function getToolsSelectableRows(args: {
  toolGroupChecked: {
    all: boolean
    readOnly: boolean
    edit: boolean
    execution: boolean
    other: boolean
  }
  showAdvancedTools: boolean
  selectableToolNames: string[]
  selectedToolSet: Set<string>
}): ToolsSelectableRow[] {
  const rows: ToolsSelectableRow[] = []
  let cursor = 0

  rows.push({ type: 'continue', key: 'continue', cursor })
  cursor++

  rows.push({
    type: 'group',
    key: 'group-all',
    cursor,
    group: 'all',
    label: 'All tools',
    checked: args.toolGroupChecked.all,
  })
  cursor++

  rows.push({
    type: 'group',
    key: 'group-readonly',
    cursor,
    group: 'readOnly',
    label: 'Read-only tools',
    checked: args.toolGroupChecked.readOnly,
  })
  cursor++

  rows.push({
    type: 'group',
    key: 'group-edit',
    cursor,
    group: 'edit',
    label: 'Edit tools',
    checked: args.toolGroupChecked.edit,
  })
  cursor++

  rows.push({
    type: 'group',
    key: 'group-exec',
    cursor,
    group: 'execution',
    label: 'Execution tools',
    checked: args.toolGroupChecked.execution,
  })
  cursor++

  rows.push({
    type: 'group',
    key: 'group-other',
    cursor,
    group: 'other',
    label: 'Other tools',
    checked: args.toolGroupChecked.other,
  })
  cursor++

  rows.push({
    type: 'advanced',
    key: 'advanced',
    cursor,
    label: args.showAdvancedTools ? '[ Hide advanced options ]' : '[ Show advanced options ]',
  })
  cursor++

  if (args.showAdvancedTools) {
    for (const tool of args.selectableToolNames) {
      rows.push({
        type: 'tool',
        key: `tool-${tool}`,
        cursor,
        tool,
        checked: args.selectedToolSet.has(tool),
      })
      cursor++
    }
  }

  return rows
}

export function toggleToolGroupSelection(args: {
  group: 'all' | 'readOnly' | 'edit' | 'execution' | 'other'
  toolGroups: {
    all: Set<string>
    readOnly: Set<string>
    edit: Set<string>
    execution: Set<string>
    other: Set<string>
  }
  selectedToolSet: Set<string>
  onChange: (next: string[]) => void
}): void {
  const groupSet = args.toolGroups[args.group]
  const isOn = groupSet.size > 0 && Array.from(groupSet).every((t) => args.selectedToolSet.has(t))

  if (args.group === 'all') {
    args.onChange(isOn ? [] : Array.from(groupSet))
    return
  }

  const next = new Set(args.selectedToolSet)
  if (isOn) {
    for (const t of groupSet) next.delete(t)
  } else {
    for (const t of groupSet) next.add(t)
  }
  args.onChange(Array.from(next))
}

export async function readAgentDir(
  dir: string,
): Promise<Record<string, { name: string; model: string; filePath: string }>> {
  const out: Record<string, { name: string; model: string; filePath: string }> = {}
  if (!dir) return out

  let entries: string[] = []
  try {
    entries = await fsp.readdir(dir)
  } catch {
    return out
  }

  await Promise.all(
    entries
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .map(async (fileName) => {
        const filePath = path.join(dir, fileName)
        let raw = ''
        try {
          raw = await fsp.readFile(filePath, 'utf8')
        } catch {
          return
        }
        const fm = parseFrontmatter(raw)
        const name = String(fm.name || path.basename(fileName, '.md')).trim()
        const modelRaw = String(fm.model || '').trim()
        const model = modelRaw ? modelRaw.toLowerCase() : 'inherit'
        out[name.toLowerCase()] = { name, model, filePath }
      }),
  )

  return out
}

export function parseFrontmatter(raw: string): Record<string, string> {
  const text = String(raw || '').trim()
  if (!text) return {}
  const lines = text.split(/\r?\n/)
  if (lines[0] !== '---') return {}
  const out: Record<string, string> = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '---') break
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const k = line.slice(0, idx).trim()
    let v = line.slice(idx + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}
