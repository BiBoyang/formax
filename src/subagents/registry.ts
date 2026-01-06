import fsp from 'node:fs/promises'
import path from 'node:path'
import type { SubAgentConfig } from './types'

export interface SubAgentRegistry {
  loadFromDirectory(dir: string): Promise<void>
  get(name: string): SubAgentConfig | undefined
  list(): Array<{ name: string; description: string }>
}

export function createSubAgentRegistry(): SubAgentRegistry {
  const agents = new Map<string, SubAgentConfig>()

  return {
    async loadFromDirectory(dir: string): Promise<void> {
      agents.clear()

      let entries: string[]
      try {
        entries = await fsp.readdir(dir)
      } catch {
        return
      }

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
              const tools = Array.isArray(parsed.data.tools)
                ? parsed.data.tools.filter((t: unknown) => typeof t === 'string').map((t: string) => t.trim())
                : []
              const systemPrompt = parsed.content.trim()

              if (!name || !description || !systemPrompt) return
              agents.set(name, { name, description, tools, systemPrompt })
            } catch {
              // ignore invalid files
            }
          }),
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

function parseSimpleYaml(lines: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
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

    // Parse a simple list block:
    // tools:
    //   - Read
    //   - Grep
    const items: string[] = []
    while (i < lines.length) {
      const next = lines[i]
      const nextTrim = next.trim()

      // Next top-level key
      if (/^[A-Za-z0-9_-]+\s*:/.test(nextTrim)) break

      const itemMatch = /^-\s*(.+)$/.exec(nextTrim)
      if (itemMatch) items.push(unquote(itemMatch[1]))
      i++
    }

    data[key] = items
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

