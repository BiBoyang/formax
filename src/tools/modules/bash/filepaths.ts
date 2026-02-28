export type FilepathsExtract = {
  isDisplayingContents: boolean
  filepaths: string[]
  source: 'rule'
  confidence: number
}

const NO_PATCH_GIT_DIFF_FLAGS = new Set([
  '--name-only',
  '--name-status',
  '--stat',
  '--shortstat',
  '--numstat',
  '--dirstat',
  '--summary',
  '--check',
])

const NO_PATCH_GIT_SHOW_FLAGS = new Set([
  '--name-only',
  '--name-status',
  '--stat',
  '--shortstat',
  '--numstat',
  '--dirstat',
  '--summary',
])

export function extractFilepathsFromCommandOutput(args: {
  command: string
  output: string
}): FilepathsExtract {
  const command = (args.command || '').trim()
  const output = args.output || ''

  const tokens = shellSplit(command)
  const isDisplayingContents = detectDisplayingContents({ command, tokens, output })
  if (!isDisplayingContents) {
    return { isDisplayingContents: false, filepaths: [], source: 'rule', confidence: 1 }
  }

  const filepaths: string[] = []
  const seen = new Set<string>()
  const add = (p: string) => {
    const next = normalizePathToken(p)
    if (!next) return
    if (seen.has(next)) return
    seen.add(next)
    filepaths.push(next)
  }

  for (const p of extractGitDiffPathsFromOutput(output)) add(p)
  for (const p of extractCatLikePathsFromCommand(tokens)) add(p)

  return {
    isDisplayingContents: true,
    filepaths,
    source: 'rule',
    confidence: filepaths.length > 0 ? 1 : 0.6,
  }
}

function detectDisplayingContents(args: {
  command: string
  tokens: string[]
  output: string
}): boolean {
  const cmd = args.command
  const tokens = args.tokens
  const output = args.output

  if (looksLikePatch(output)) return true

  const segments = splitSegments(tokens)
  for (const seg of segments) {
    const base = stripEnvAssignments(seg)
    const exe = (base[0] || '').toLowerCase()
    const rest = base.slice(1)

    if (!exe) continue

    if (exe === 'cat' || exe === 'bat') {
      if (extractCatBatFileArgs(rest).length > 0) return true
    }

    if (exe === 'head' || exe === 'tail') {
      if (extractHeadTailFileArgs(rest).length > 0) return true
    }

    if (exe === 'git') {
      const sub = (rest[0] || '').toLowerCase()
      const flags = rest.slice(1)
      if (sub === 'diff') return !hasAnyFlag(flags, NO_PATCH_GIT_DIFF_FLAGS)
      if (sub === 'show') return !hasAnyFlag(flags, NO_PATCH_GIT_SHOW_FLAGS)
      if (sub === 'log') return hasAnyFlag(flags, new Set(['-p', '--patch']))
      if (sub === 'blame') return true
    }

    if (exe === 'sed' || exe === 'awk' || exe === 'perl') {
      // These can print file contents, but are too ambiguous to treat as displaying contents by default.
      // We fall back to patch heuristics above for diff-like outputs.
      continue
    }
  }

  void cmd
  return false
}

function looksLikePatch(output: string): boolean {
  if (!output) return false
  if (/^diff --git\s/m.test(output)) return true
  if (/^\+\+\+ (?:a\/|b\/)?/m.test(output) || /^--- (?:a\/|b\/)?/m.test(output)) return true
  if (/^@@\s/m.test(output)) return true
  return false
}

function extractGitDiffPathsFromOutput(output: string): string[] {
  const out: string[] = []
  const lines = String(output || '').split('\n')

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const rest = line.slice('diff --git '.length)
      const parts = shellSplit(rest)
      if (parts.length >= 2) {
        out.push(stripDiffPrefix(parts[0]))
        out.push(stripDiffPrefix(parts[1]))
      }
      continue
    }

    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const p = line.slice(4).trim().split(/\s+/)[0] || ''
      out.push(stripDiffPrefix(p))
      continue
    }

    if (line.startsWith('rename from ')) {
      out.push(stripDiffPrefix(line.slice('rename from '.length).trim()))
      continue
    }

    if (line.startsWith('rename to ')) {
      out.push(stripDiffPrefix(line.slice('rename to '.length).trim()))
      continue
    }
  }

  return out
}

function extractCatLikePathsFromCommand(tokens: string[]): string[] {
  const out: string[] = []
  const segments = splitSegments(tokens)

  for (const seg of segments) {
    const base = stripEnvAssignments(seg)
    const exe = (base[0] || '').toLowerCase()
    const rest = base.slice(1)

    if (exe === 'cat' || exe === 'bat') {
      for (const tok of extractCatBatFileArgs(rest)) out.push(tok)
      continue
    }

    if (exe === 'head' || exe === 'tail') {
      for (const tok of extractHeadTailFileArgs(rest)) out.push(tok)
    }
  }

  return out
}

function extractCatBatFileArgs(rest: string[]): string[] {
  const out: string[] = []
  for (const tok of rest) {
    if (tok === '-' || tok === '--') continue
    if (tok.startsWith('-')) continue
    if (isRedirectToken(tok)) continue
    out.push(tok)
  }
  return out
}

function extractHeadTailFileArgs(rest: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]

    if (tok === '-n' || tok === '--lines' || tok === '-c' || tok === '--bytes') {
      i++
      continue
    }

    if (tok === '-' || tok === '--') continue
    if (tok.startsWith('-')) continue
    if (isRedirectToken(tok)) continue
    out.push(tok)
  }
  return out
}

function splitSegments(tokens: string[]): string[][] {
  const segments: string[][] = []
  let current: string[] = []

  const push = () => {
    if (current.length > 0) segments.push(current)
    current = []
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '|' || t === '||' || t === '&&' || t === ';') {
      push()
      continue
    }
    current.push(t)
  }

  push()
  return segments
}

function stripEnvAssignments(tokens: string[]): string[] {
  const out: string[] = []
  let i = 0
  for (; i < tokens.length; i++) {
    const t = tokens[i]
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) break
  }
  for (; i < tokens.length; i++) out.push(tokens[i])
  return out
}

function hasAnyFlag(args: string[], flags: Set<string>): boolean {
  for (const a of args) {
    if (flags.has(a)) return true
  }
  return false
}

function stripDiffPrefix(p: string): string {
  const raw = normalizePathToken(p)
  if (!raw) return ''
  if (raw === '/dev/null') return ''
  if (raw.startsWith('a/') || raw.startsWith('b/')) return raw.slice(2)
  return raw
}

function normalizePathToken(token: string): string {
  const t = (token || '').trim()
  if (!t) return ''
  return t.replace(/^['"]|['"]$/g, '')
}

function isRedirectToken(token: string): boolean {
  if (token === '>' || token === '>>' || token === '<' || token === '<<') return true
  if (/^\d?>/.test(token) || /^\d?<\d?$/.test(token)) return true
  if (token === '2>&1' || token === '&>' || token === '>&') return true
  return false
}

function shellSplit(input: string): string[] {
  const s = input
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escape = false

  const push = () => {
    if (!current) return
    tokens.push(current)
    current = ''
  }

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const next = s[i + 1]

    if (escape) {
      current += ch
      escape = false
      continue
    }

    if (!quote && ch === '\\') {
      escape = true
      continue
    }

    if (quote) {
      if (ch === quote) {
        quote = null
        continue
      }
      current += ch
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch as any
      continue
    }

    if (/\s/.test(ch)) {
      push()
      continue
    }

    if (ch === '&' && next === '&') {
      push()
      tokens.push('&&')
      i++
      continue
    }

    if (ch === '|' && next === '|') {
      push()
      tokens.push('||')
      i++
      continue
    }

    if (ch === '|' || ch === ';') {
      push()
      tokens.push(ch)
      continue
    }

    current += ch
  }

  push()
  return tokens
}
