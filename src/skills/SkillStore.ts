import fs from 'node:fs'
import path from 'node:path'
import { extractFirstMeaningfulLine, parseMarkdownFrontmatter } from '../shared/frontmatter'

export type SkillScope = 'project' | 'user'

export type SkillMeta = {
  name: string
  scope: SkillScope
  filePath: string
  description: string
  argumentHint?: string
  disableModelInvocation?: boolean
  hasDescriptionFrontmatter: boolean
  body: string
}

export type SkillStore = {
  list: () => SkillMeta[]
  get: (name: string) => SkillMeta | undefined
}

export function createSkillStore(args: { cwd: string; globalConfigDir: string }): SkillStore {
  const projectDir = path.join(args.cwd, '.formax', 'skills')
  const userDir = path.join(args.globalConfigDir, 'skills')

  const skillsByName = new Map<string, SkillMeta>()

  // Lower precedence first (user), then project overrides.
  for (const meta of scanDir(userDir, 'user')) skillsByName.set(meta.name, meta)
  for (const meta of scanDir(projectDir, 'project')) skillsByName.set(meta.name, meta)

  const list = () =>
    Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name))

  return {
    list,
    get: (name) => skillsByName.get(normalizeSkillName(name)),
  }
}

function scanDir(dir: string, scope: SkillScope): SkillMeta[] {
  try {
    if (!fs.existsSync(dir)) return []
    if (!fs.statSync(dir).isDirectory()) return []
  } catch {
    return []
  }

  const files = walkSkillFiles(dir)
  return files
    .map((filePath) => buildMeta({ baseDir: dir, filePath, scope }))
    .filter((v): v is SkillMeta => Boolean(v))
}

function walkSkillFiles(rootDir: string): string[] {
  const out: string[] = []
  const stack: string[] = [rootDir]

  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name.toLowerCase() !== 'skill.md') continue
      out.push(fullPath)
    }
  }

  return out
}

function buildMeta(args: { baseDir: string; filePath: string; scope: SkillScope }): SkillMeta | null {
  let raw: string
  try {
    raw = fs.readFileSync(args.filePath, 'utf8')
  } catch {
    return null
  }

  const parsed = parseMarkdownFrontmatter(raw)
  const body = (parsed?.body ?? raw).trim()
  if (!body) return null

  const attrs = parsed?.attributes ?? {}
  const descriptionFromFrontmatter = String(attrs.description ?? '').trim()
  const hasDescriptionFrontmatter = Boolean(descriptionFromFrontmatter)
  const description = (descriptionFromFrontmatter || extractFirstMeaningfulLine(body) || 'Custom skill').trim()

  const argumentHint = String(attrs['argument-hint'] ?? '').trim() || undefined

  const disableModelInvocationRaw = String(attrs['disable-model-invocation'] ?? '').trim().toLowerCase()
  const disableModelInvocation =
    disableModelInvocationRaw === 'true' ||
    disableModelInvocationRaw === '1' ||
    disableModelInvocationRaw === 'yes'

  const nameFromFrontmatter = String(attrs.name ?? '').trim()
  const derived = dirToSkillName(args.baseDir, args.filePath)
  const name = normalizeSkillName(nameFromFrontmatter || derived || '')
  if (!name) return null
  if (!isSafeSkillName(name)) return null

  return {
    name,
    scope: args.scope,
    filePath: args.filePath,
    description,
    argumentHint,
    disableModelInvocation: disableModelInvocation ? true : undefined,
    hasDescriptionFrontmatter,
    body,
  }
}

function dirToSkillName(baseDir: string, filePath: string): string | null {
  const skillDir = path.dirname(filePath)
  const rel = path.relative(baseDir, skillDir)
  if (!rel || rel.startsWith('..')) return null
  const parts = rel.split(/[\\/]/g).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.some((p) => !isSafeSegment(p))) return null
  return parts.join(':')
}

function isSafeSkillName(name: string): boolean {
  const raw = String(name || '').trim()
  if (!raw) return false
  if (raw.startsWith('/')) return false
  if (raw.includes('..')) return false
  if (raw.includes('\\')) return false
  if (raw.includes('/')) return false
  return raw.split(':').every((seg) => isSafeSegment(seg))
}

function isSafeSegment(seg: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(seg)
}

function normalizeSkillName(name: string): string {
  return String(name ?? '').trim()
}

