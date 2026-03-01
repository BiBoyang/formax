import fsp from 'node:fs/promises'
import path from 'node:path'
import { wsWarn, wsError, wsInfo } from '../tui/consoleLogger'
import type { SubAgentConfig } from './types'
import { getBuiltinSubagents } from './builtins'

export interface SubAgentRegistry {
  loadFromDirectory(dir: string): Promise<void>
  loadFromDirectories(dirs: string[]): Promise<void>
  get(name: string): SubAgentConfig | undefined
  list(): Array<{ name: string; description: string }>
}

export function createSubAgentRegistry(args?: { includeBuiltins?: boolean }): SubAgentRegistry {
  const agents = new Map<string, SubAgentConfig>()
  const includeBuiltins = args?.includeBuiltins !== false

  const seedBuiltins = () => {
    if (!includeBuiltins) return
    for (const agent of getBuiltinSubagents()) {
      if (!agent?.name) continue
      agents.set(agent.name, agent)
    }
  }

  return {
    async loadFromDirectory(dir: string): Promise<void> {
      await this.loadFromDirectories([dir])
    },

    async loadFromDirectories(dirs: string[]): Promise<void> {
      agents.clear()
      seedBuiltins()

      const dirList = Array.isArray(dirs) ? dirs.filter((d) => Boolean((d || '').trim())) : []
      const loadedFrom: string[] = []

      for (const dir of dirList) {
        let entries: string[]
        try {
          entries = await fsp.readdir(dir)
        } catch (err) {
          if (isMissingDir(err)) continue
          wsWarn(`[SubAgentRegistry] Failed to read directory ${dir}:`, err)
          continue
        }

        loadedFrom.push(dir)

        await Promise.all(
          entries
            .filter((f) => f.endsWith('.md'))
            .map(async (file) => {
              const fullPath = path.join(dir, file)
              try {
                const raw = await fsp.readFile(fullPath, 'utf8')
                const parsed = parseFrontmatter(raw)

                const name = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : ''
                const description =
                  typeof parsed.data.description === 'string' ? parsed.data.description.trim() : ''

                const tools = parseToolsField(parsed.data.tools)
                const systemPrompt = parsed.content.trim()
                const model = typeof parsed.data.model === 'string' ? parsed.data.model.trim() : ''
                const color = typeof parsed.data.color === 'string' ? parsed.data.color.trim() : ''

                if (!name || !description || !systemPrompt) return
                agents.set(name, {
                  name,
                  description,
                  tools,
                  systemPrompt,
                  ...(model ? { model } : {}),
                  ...(color ? { color } : {}),
                })
              } catch (err) {
                wsWarn(`[SubAgentRegistry] Failed to parse ${file}:`, err)
              }
            }),
        )
      }

      const locations = loadedFrom.length > 0 ? loadedFrom.join(', ') : '(none)'
      wsInfo(
        `[SubAgentRegistry] Loaded ${agents.size} sub-agent(s) (builtins=${includeBuiltins}) from ${locations}`,
      )
    },

    get(name: string): SubAgentConfig | undefined {
      return agents.get(name)
    },

    list(): Array<{ name: string; description: string }> {
      return Array.from(agents.values()).map((a) => ({
        name: a.name,
        description: a.description,
      }))
    },
  }
}

function parseFrontmatter(input: string): { data: Record<string, unknown>; content: string } {
  const lines = input.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return { data: {}, content: input }
  }

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) {
    return { data: {}, content: input }
  }

  const fmLines = lines.slice(1, end)
  const content = lines.slice(end + 1).join('\n')
  const data = parseSimpleYaml(fmLines)
  return { data, content }
}

/**
 * Checks if a line starts a new top-level YAML key
 */
function isTopLevelKey(line: string): boolean {
  return /^[A-Za-z0-9_-]+\s*:/.test(line.trim())
}

/**
 * Parses a YAML list block (e.g., tools:\n  - Read\n  - Grep)
 */
function parseYamlList(lines: string[], startIndex: number): { items: string[]; nextIndex: number } {
  const items: string[] = []
  let i = startIndex

  while (i < lines.length) {
    const nextTrim = lines[i]?.trim()

    // Next top-level key
    if (isTopLevelKey(nextTrim || '')) break

    const itemMatch = /^-\s*(.+)$/.exec(nextTrim || '')
    if (itemMatch) items.push(unquote(itemMatch[1]))
    i++
  }

  return { items, nextIndex: i }
}

function parseSimpleYaml(lines: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i]?.trim() ?? ''
    i++

    if (!trimmed || trimmed.startsWith('#')) continue

    const keyMatch = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(trimmed)
    if (!keyMatch) continue

    const key = keyMatch[1]
    const rest = keyMatch[2] ?? ''

    if (rest) {
      data[key] = unquote(rest)
      continue
    }

    // Parse list block
    const { items, nextIndex } = parseYamlList(lines, i)
    data[key] = items
    i = nextIndex
  }

  return data
}

function unquote(value: string): string {
  const v = value.trim()
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1)
  }
  return v
}

function parseToolsField(raw: unknown): string[] {
  if (raw === undefined) return ['*']

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    if (trimmed === '*') return ['*']
    return trimmed
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  }

  if (Array.isArray(raw)) {
    const items = raw
      .filter((t: unknown) => typeof t === 'string')
      .map((t: string) => t.trim())
      .filter(Boolean)
    return items
  }

  return []
}

function isMissingDir(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  return (err as any).code === 'ENOENT'
}
