import fs from 'node:fs'
import path from 'node:path'
import { runNoClaudeCheck } from './check-no-claude.mjs'

const REPO_ROOT = process.cwd()

const ROOT_MARKDOWN_FILES = ['AGENTS.md', 'README.md', 'CODEMAP.md', 'CLAUDE.md', 'ARCHITECTURE.md', 'pitfalls.md']
const DOC_DIRS = ['docs', '.codex/skills']
const PLAN_DIR = 'plans'
const README_SCAN_DIRS = ['packages']
const PLAN_EXCLUDE_DIRS = new Set(['node_modules'])
const README_EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist'])

const LOCAL_PATH_PREFIXES = [
  '.codex/',
  'src/',
  'packages/',
  'docs/',
  'plans/',
  'scripts/',
  'AGENTS.md',
  'README.md',
  'CODEMAP.md',
  'CLAUDE.md',
  'ARCHITECTURE.md',
  'pitfalls.md',
]

function rel(absPath) {
  return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/')
}

function isMarkdownFile(fileName) {
  return fileName.toLowerCase().endsWith('.md')
}

function listMarkdownFilesUnder(absRoot, { readmeOnly = false, excludeDirs = new Set() } = {}) {
  if (!fs.existsSync(absRoot)) return []

  const out = []
  const stack = [absRoot]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!isMarkdownFile(entry.name)) continue
      if (readmeOnly && entry.name !== 'README.md') continue
      out.push(full)
    }
  }

  return out
}

function collectDocFiles() {
  const files = new Set()

  for (const relPath of ROOT_MARKDOWN_FILES) {
    const absPath = path.resolve(REPO_ROOT, relPath)
    if (fs.existsSync(absPath)) files.add(absPath)
  }

  for (const relDir of DOC_DIRS) {
    const absDir = path.resolve(REPO_ROOT, relDir)
    for (const absPath of listMarkdownFilesUnder(absDir)) files.add(absPath)
  }

  const planDirAbs = path.resolve(REPO_ROOT, PLAN_DIR)
  const planCandidates = listMarkdownFilesUnder(planDirAbs, { excludeDirs: PLAN_EXCLUDE_DIRS })
  for (const absPath of planCandidates) {
    const relPath = rel(absPath)
    const baseName = path.basename(absPath)
    if (
      /roadmap/i.test(baseName) ||
      baseName === 'README.md' ||
      baseName === 'TODO-INDEX.md' ||
      baseName === 'TASK-SOURCE.md' ||
      relPath === 'plans/directory-restructure-target.md'
    ) {
      files.add(absPath)
    }
  }

  for (const relDir of README_SCAN_DIRS) {
    const absDir = path.resolve(REPO_ROOT, relDir)
    for (const absPath of listMarkdownFilesUnder(absDir, { readmeOnly: true, excludeDirs: README_EXCLUDE_DIRS })) {
      files.add(absPath)
    }
  }

  return Array.from(files).sort((a, b) => rel(a).localeCompare(rel(b)))
}

function normalizeToken(rawToken) {
  let token = rawToken.trim()
  if (!token) return ''

  if (token.startsWith('<') && token.endsWith('>')) token = token.slice(1, -1).trim()
  if (!token) return ''

  if (/^(https?:|mailto:|tel:|data:)/i.test(token)) return ''
  if (token.startsWith('#')) return ''
  if (token.startsWith('/')) return ''

  const [withoutAnchor] = token.split('#')
  const [withoutQuery] = withoutAnchor.split('?')
  token = withoutQuery.trim()
  token = token.replace(/:\d+(?::\d+)?$/, '')

  return token
}

function hasPathPattern(token) {
  return /[*<>{}$]/.test(token)
}

function looksLikeLocalPath(token) {
  if (!token) return false
  if (token.startsWith('./') || token.startsWith('../')) return true
  return LOCAL_PATH_PREFIXES.some((prefix) => token === prefix || token.startsWith(prefix))
}

function resolvePath(refToken, sourceAbsPath) {
  if (refToken.startsWith('./') || refToken.startsWith('../')) {
    return path.resolve(path.dirname(sourceAbsPath), refToken)
  }
  return path.resolve(REPO_ROOT, refToken)
}

function listPathCandidates(absTarget) {
  const ext = path.extname(absTarget)
  if (ext) return [absTarget]

  return [
    absTarget,
    `${absTarget}.ts`,
    `${absTarget}.tsx`,
    `${absTarget}.js`,
    `${absTarget}.mjs`,
    `${absTarget}.md`,
    path.join(absTarget, 'index.ts'),
    path.join(absTarget, 'index.tsx'),
    path.join(absTarget, 'index.js'),
    path.join(absTarget, 'README.md'),
  ]
}

function pathExistsWithModuleFallback(absTarget) {
  for (const candidate of listPathCandidates(absTarget)) {
    if (fs.existsSync(candidate)) return true
  }

  // Transitional compatibility: docs may still point to legacy root src/,
  // but implementation has moved to packages/core/src.
  const targetRel = rel(absTarget)
  if (targetRel === 'src' || targetRel.startsWith('src/')) {
    const mappedRel = targetRel === 'src' ? 'packages/core/src' : `packages/core/${targetRel}`
    const mapped = path.resolve(REPO_ROOT, mappedRel)
    for (const candidate of listPathCandidates(mapped)) {
      if (fs.existsSync(candidate)) return true
    }
  }

  return false
}

function shouldCheckInlineCode(fileRelPath) {
  if (fileRelPath.startsWith('plans/')) return false
  if (fileRelPath.startsWith('docs/pitfalls/')) return false
  if (fileRelPath.startsWith('docs/learnings/')) return false
  return true
}

function extractLineRefs(line, { checkInlineCode }) {
  const refs = []
  const markdownLinkRe = /\[[^\]]*]\(([^)]+)\)/g

  if (checkInlineCode) {
    const inlineCodeRe = /`([^`\n]+)`/g
    let inlineMatch = inlineCodeRe.exec(line)
    while (inlineMatch) {
      refs.push({ raw: inlineMatch[1], kind: 'inline-code' })
      inlineMatch = inlineCodeRe.exec(line)
    }
  }

  let match = markdownLinkRe.exec(line)
  while (match) {
    const rawLink = match[1].trim()
    const linkPathMatch = rawLink.match(/^(\S+)(?:\s+".*")?$/)
    const linkPath = linkPathMatch ? linkPathMatch[1] : rawLink
    refs.push({ raw: linkPath, kind: 'markdown-link' })
    match = markdownLinkRe.exec(line)
  }

  return refs
}

function collectMissingRefs(files) {
  const missing = []
  let checkedRefs = 0

  for (const absFile of files) {
    const relPath = rel(absFile)
    const checkInlineCode = shouldCheckInlineCode(relPath)
    const raw = fs.readFileSync(absFile, 'utf8').replace(/\r\n/g, '\n')
    const lines = raw.split('\n')

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? ''
      const refs = extractLineRefs(line, { checkInlineCode })
      for (const ref of refs) {
        const normalized = normalizeToken(ref.raw)
        if (!looksLikeLocalPath(normalized)) continue
        if (hasPathPattern(normalized)) continue

        const absTarget = resolvePath(normalized, absFile)
        checkedRefs += 1
        if (pathExistsWithModuleFallback(absTarget)) continue

        missing.push({
          file: rel(absFile),
          line: i + 1,
          ref: normalized,
          kind: ref.kind,
        })
      }
    }
  }

  return { missing, checkedRefs }
}

function main() {
  runNoClaudeCheck({ repoRoot: REPO_ROOT })
  if (process.exitCode && process.exitCode !== 0) return

  const files = collectDocFiles()
  const { missing, checkedRefs } = collectMissingRefs(files)

  if (missing.length === 0) {
    console.log(`[doc-paths] check passed. files=${files.length}, refsChecked=${checkedRefs}, missing=0`)
    return
  }

  console.error(`[doc-paths] check failed. files=${files.length}, refsChecked=${checkedRefs}, missing=${missing.length}`)
  console.error('\nMissing local doc refs:')
  for (const item of missing) {
    console.error(`- ${item.file}:${item.line} (${item.kind}) -> ${item.ref}`)
  }
  console.error('\nFix by updating stale paths in docs/skills/plans/readme guidance to existing repository paths.')
  process.exitCode = 1
}

main()
