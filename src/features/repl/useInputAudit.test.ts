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
    const root = path.join(process.cwd(), 'src')
    const files = await listSourceFiles(root)

    const matches: Match[] = []
    const re = /\buseInput\s*\(/g
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8')
      const count = Array.from(text.matchAll(re)).length
      if (count > 0) {
        matches.push({ file: normalizeRel(path.relative(process.cwd(), file)), count })
      }
    }

    const allowed = new Set([
      'src/components/ui/TextInput.tsx',
      'src/features/repl/inputScopeContext.tsx',
      'src/screens/LoadingExampleScreen.tsx',
      'src/screens/REPL.tsx',
      'src/screens/ToolExamplesScreen.tsx',
    ])

    const unexpected = matches.filter((m) => !allowed.has(m.file))
    expect(unexpected).toEqual([])

    const present = matches.map((m) => m.file).sort()
    const expectedPresent = Array.from(allowed).sort()
    expect(present).toEqual(expectedPresent)
  })
})
