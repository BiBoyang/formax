import fs from 'node:fs'
import path from 'node:path'
import { extractFirstMeaningfulLine, parseMarkdownFrontmatter } from '../shared/frontmatter'
import { resolveFormaxProjectRoot } from '../adapters/fs/projectRoot.js'

export type CommandScope = 'project' | 'user'

export type CommandMeta = {
  id: string
  scope: CommandScope
  filePath: string
  description: string
  argumentHint?: string
  disableModelInvocation?: boolean
  hasDescriptionFrontmatter: boolean
  body: string
}

export type CommandStore = {
  list: () => CommandMeta[]
  listAll: () => CommandMeta[]
  get: (id: string) => CommandMeta | undefined
}

export function createCommandStore(args: { cwd: string; globalConfigDir: string }): CommandStore {
  const projectRoot = resolveFormaxProjectRoot(args.cwd)
  const projectDir = path.join(projectRoot, '.formax', 'commands')
  const userDir = path.join(args.globalConfigDir, 'commands')

  const userCommands = scanDir(userDir, 'user')
  const projectCommands = scanDir(projectDir, 'project')

  // Lower precedence first (user), then project overrides.
  const effectiveById = new Map<string, CommandMeta>()
  for (const meta of userCommands) effectiveById.set(meta.id, meta)
  for (const meta of projectCommands) effectiveById.set(meta.id, meta)

  const list = () =>
    Array.from(effectiveById.values()).sort((a, b) => a.id.localeCompare(b.id))

  const listAll = () =>
    [...userCommands, ...projectCommands].sort(
      (a, b) => a.id.localeCompare(b.id) || scopeRank(a.scope) - scopeRank(b.scope),
    )

  return {
    list,
    listAll,
    get: (id: string) => effectiveById.get(normalizeCommandId(id)),
  }
}

function scopeRank(scope: CommandScope): number {
  return scope === 'user' ? 0 : 1
}

function scanDir(dir: string, scope: CommandScope): CommandMeta[] {
  try {
    if (!fs.existsSync(dir)) return []
    if (!fs.statSync(dir).isDirectory()) return []
  } catch {
    return []
  }

  const files = walkMarkdownFiles(dir)
  return files
    .map((filePath) => buildMeta({ baseDir: dir, filePath, scope }))
    .filter((v): v is CommandMeta => Boolean(v))
}

function walkMarkdownFiles(rootDir: string): string[] {
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
      if (!entry.name.endsWith('.md')) continue
      out.push(fullPath)
    }
  }

  return out
}

function buildMeta(args: { baseDir: string; filePath: string; scope: CommandScope }): CommandMeta | null {
  let raw: string
  try {
    raw = fs.readFileSync(args.filePath, 'utf8')
  } catch {
    return null
  }

  const parsed = parseMarkdownFrontmatter(raw)
  const body = (parsed?.body ?? raw).trim()
  if (!body) return null

  const id = filePathToCommandId(args.baseDir, args.filePath)
  if (!id) return null

  const attrs = parsed?.attributes ?? {}
  const descriptionFromFrontmatter = String(attrs.description ?? '').trim()
  const hasDescriptionFrontmatter = Boolean(descriptionFromFrontmatter)
  const description = (descriptionFromFrontmatter || extractFirstMeaningfulLine(body) || 'Custom command').trim()

  const argumentHint = String(attrs['argument-hint'] ?? '').trim() || undefined

  const disableModelInvocationRaw = String(attrs['disable-model-invocation'] ?? '').trim().toLowerCase()
  const disableModelInvocation =
    disableModelInvocationRaw === 'true' ||
    disableModelInvocationRaw === '1' ||
    disableModelInvocationRaw === 'yes'

  return {
    id,
    scope: args.scope,
    filePath: args.filePath,
    description,
    argumentHint,
    disableModelInvocation: disableModelInvocation ? true : undefined,
    hasDescriptionFrontmatter,
    body,
  }
}

function filePathToCommandId(baseDir: string, filePath: string): string | null {
  const rel = path.relative(baseDir, filePath)
  if (!rel || rel.startsWith('..')) return null

  const noExt = rel.replace(/\.md$/i, '')
  const parts = noExt.split(/[\\/]/g).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.some((p) => !isSafeSegment(p))) return null
  return '/' + parts.join(':')
}

function isSafeSegment(seg: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(seg)
}

function normalizeCommandId(id: string): string {
  const raw = String(id ?? '').trim()
  if (!raw) return raw
  if (!raw.startsWith('/')) return '/' + raw
  return raw
}
