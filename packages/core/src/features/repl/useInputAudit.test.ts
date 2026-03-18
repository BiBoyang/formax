import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type Match = { file: string; count: number }

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...(await listSourceFiles(full)))
      continue
    }
    if (!ent.isFile()) continue
    if (!/\.(ts|tsx)$/.test(ent.name)) continue
    if (/\.test\.(ts|tsx)$/.test(ent.name)) continue
    out.push(full)
  }
  return out
}

function normalizeRel(p: string): string {
  return p.split(path.sep).join('/')
}

describe('useInput audit', () => {
  it('keeps raw useInput() call sites on an allow-list', async () => {
    const root = path.join(process.cwd(), 'packages', 'core', 'src')
    const files = await listSourceFiles(root)

    const re = /\buseInput\s*\(/g
    const maybeMatches = await Promise.all(
      files.map(async (file): Promise<Match | null> => {
        const text = await fs.readFile(file, 'utf8')
        if (!text.includes('useInput')) return null
        const count = Array.from(text.matchAll(re)).length
        if (count === 0) return null
        return { file: normalizeRel(path.relative(process.cwd(), file)), count }
      }),
    )
    const matches = maybeMatches.filter((m): m is Match => m !== null)

    const allowed = new Set([
      'packages/core/src/components/ui/TextInput.tsx',
      'packages/core/src/features/repl/inputScopeContext.tsx',
      'packages/core/src/screens/repl/hotkeys.ts',
    ])

    const unexpected = matches.filter((m) => !allowed.has(m.file))
    expect(unexpected).toEqual([])

    const present = matches.map((m) => m.file).sort()
    const expectedPresent = Array.from(allowed).sort()
    expect(present).toEqual(expectedPresent)
  }, 120000)
})
