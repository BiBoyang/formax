import fs from 'node:fs'
import path from 'node:path'
import { extractFirstMeaningfulLine, parseMarkdownFrontmatter } from '../shared/frontmatter'
import { resolveFormaxProjectRoot } from '../adapters/fs/projectRoot.js'

export type SkillScope = 'project' | 'user'

export type SkillMeta = {
  name: string
  scope: SkillScope
  filePath: string
  description: string
  argumentHint?: string
  disableModelInvocation?: boolean
}

export type SkillStore = {
  list: () => SkillMeta[]
  get: (name: string) => SkillMeta | undefined
}

type SkillStoreCacheEntry = {
  expiresAt: number
  store: SkillStore
}

const DEFAULT_SKILL_STORE_CACHE_TTL_MS = 5000
const SKILL_STORE_CACHE = new Map<string, SkillStoreCacheEntry>()

function getSkillStoreCacheTtlMs(): number {
  const raw = String(process.env.FORMAX_SKILL_STORE_CACHE_TTL_MS ?? '').trim()
  if (!raw) return DEFAULT_SKILL_STORE_CACHE_TTL_MS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SKILL_STORE_CACHE_TTL_MS
  return n
}

export function createSkillStore(args: { cwd: string; globalConfigDir: string }): SkillStore {
  const projectRoot = resolveFormaxProjectRoot(args.cwd)
  const globalConfigDir = path.resolve(args.globalConfigDir)

  const ttlMs = getSkillStoreCacheTtlMs()
  if (ttlMs > 0) {
    const now = Date.now()
    const cacheKey = `${projectRoot}\n${globalConfigDir}`
    const cached = SKILL_STORE_CACHE.get(cacheKey)
    if (cached && cached.expiresAt > now) return cached.store

    // Opportunistic cleanup of expired entries.
    for (const [k, v] of SKILL_STORE_CACHE.entries()) {
      if (v.expiresAt <= now) SKILL_STORE_CACHE.delete(k)
    }

    const store = createSkillStoreUncached({ projectRoot, globalConfigDir })
    SKILL_STORE_CACHE.set(cacheKey, { store, expiresAt: now + ttlMs })
    return store
  }

  return createSkillStoreUncached({ projectRoot, globalConfigDir })
}

function createSkillStoreUncached(args: { projectRoot: string; globalConfigDir: string }): SkillStore {
  const projectDir = path.join(args.projectRoot, '.formax', 'skills')
  const projectCompatDir = path.join(args.projectRoot, '.skills')
  const userDir = path.join(args.globalConfigDir, 'skills')

  const skillsByName = new Map<string, SkillMeta>()

  // Lower precedence first, then stronger project-local overrides.
  for (const meta of scanDir(userDir, 'user')) skillsByName.set(meta.name, meta)
  for (const meta of scanDir(projectCompatDir, 'project')) skillsByName.set(meta.name, meta)
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
  const rawPrefix = readTextPrefixUtf8(args.filePath, 64 * 1024)
  if (!rawPrefix) return null

  const parsed = parseMarkdownFrontmatter(rawPrefix)
  const attrs = parsed?.attributes ?? {}
  const descriptionFromFrontmatter = String(attrs.description ?? '').trim()
  const descBody = (parsed?.body ?? rawPrefix).trim()
  if (!descBody && !descriptionFromFrontmatter) return null
  const description = (descriptionFromFrontmatter || extractFirstMeaningfulLine(descBody) || 'Custom skill').trim()

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
  }
}

function readTextPrefixUtf8(filePath: string, maxBytes: number): string | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.allocUnsafe(maxBytes)
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0)
    if (bytesRead <= 0) return ''
    return buf.subarray(0, bytesRead).toString('utf8')
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        // ignore close errors
      }
    }
  }
}

function dirToSkillName(baseDir: string, filePath: string): string | null {
  const skillDir = path.dirname(filePath)
  const rel = path.relative(baseDir, skillDir)
  if (!rel || rel.startsWith('..')) return null
  const parts = rel.split(/[\\/]/g).filter(Boolean)
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

export const __testOnlySkillStore = {
  getSkillStoreCacheTtlMs,
  walkSkillFiles,
  buildMeta,
  readTextPrefixUtf8,
  dirToSkillName,
  isSafeSkillName,
  isSafeSegment,
  normalizeSkillName,
}
