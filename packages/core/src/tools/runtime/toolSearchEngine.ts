import type { ToolDefinition } from '../types'

const DEFAULT_ENGINE: ToolSearchEngineMode = 'bm25'
const TOKEN_RE = /[a-z0-9_]+/g
const MAX_SCHEMA_ENTRIES = 300
const MAX_SCHEMA_DEPTH = 6
const BM25_K1 = 1.5
const BM25_B = 0.75

const NAME_WEIGHT = 6
const DESCRIPTION_WEIGHT = 2
const SCHEMA_WEIGHT = 1

export type ToolSearchEngineMode = 'keyword' | 'regex' | 'bm25' | 'hybrid'
export type ToolSearchQueryMode = ToolSearchEngineMode | 'select'

type IndexedToolDoc = {
  tool: ToolDefinition
  nameText: string
  descriptionText: string
  schemaText: string
  nameLower: string
  descriptionLower: string
  schemaLower: string
  haystackLower: string
  weightedTermFreq: Map<string, number>
  docLength: number
}

export type ToolSearchIndex = {
  docs: IndexedToolDoc[]
  avgDocLength: number
  docFreq: Map<string, number>
}

export type ParsedToolSearchQuery = {
  mode: ToolSearchQueryMode
  query: string
}

export type ToolSearchResult = {
  matches: ToolDefinition[]
  error?: string
}

type ParsedSearchTerms = {
  required: string
  terms: string[]
}

export function resolveToolSearchEngineMode(raw: unknown): ToolSearchEngineMode {
  const normalized = String(raw ?? '').trim().toLowerCase()
  if (normalized === 'keyword') return 'keyword'
  if (normalized === 'regex') return 'regex'
  if (normalized === 'bm25') return 'bm25'
  if (normalized === 'hybrid') return 'hybrid'
  return DEFAULT_ENGINE
}

export function parseToolSearchQuery(
  rawQuery: string,
  defaultMode: ToolSearchEngineMode,
): ParsedToolSearchQuery {
  const query = String(rawQuery || '').trim()
  const lower = query.toLowerCase()
  if (lower.startsWith('select:')) return { mode: 'select', query: query.slice('select:'.length).trim() }
  if (lower.startsWith('regex:')) return { mode: 'regex', query: query.slice('regex:'.length).trim() }
  if (lower.startsWith('bm25:')) return { mode: 'bm25', query: query.slice('bm25:'.length).trim() }
  if (lower.startsWith('keyword:')) return { mode: 'keyword', query: query.slice('keyword:'.length).trim() }
  if (lower.startsWith('hybrid:')) return { mode: 'hybrid', query: query.slice('hybrid:'.length).trim() }
  return { mode: defaultMode, query }
}

export function buildToolSearchIndex(tools: ToolDefinition[]): ToolSearchIndex {
  const docs: IndexedToolDoc[] = tools.map((tool) => {
    const nameText = String(tool.name || '')
    const descriptionText = String(tool.description || '')
    const schemaText = collectSchemaText(tool.input_schema)

    const nameLower = nameText.toLowerCase()
    const descriptionLower = descriptionText.toLowerCase()
    const schemaLower = schemaText.toLowerCase()
    const haystackLower = `${nameLower}\n${descriptionLower}\n${schemaLower}`

    const weightedTermFreq = new Map<string, number>()
    addWeightedTokens(weightedTermFreq, tokenize(nameText), NAME_WEIGHT)
    addWeightedTokens(weightedTermFreq, tokenize(descriptionText), DESCRIPTION_WEIGHT)
    addWeightedTokens(weightedTermFreq, tokenize(schemaText), SCHEMA_WEIGHT)
    const docLength = [...weightedTermFreq.values()].reduce((sum, value) => sum + value, 0)

    return {
      tool,
      nameText,
      descriptionText,
      schemaText,
      nameLower,
      descriptionLower,
      schemaLower,
      haystackLower,
      weightedTermFreq,
      docLength,
    }
  })

  const docFreq = new Map<string, number>()
  for (const doc of docs) {
    for (const term of new Set(doc.weightedTermFreq.keys())) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1)
    }
  }

  const totalLength = docs.reduce((sum, doc) => sum + doc.docLength, 0)
  const avgDocLength = docs.length > 0 ? totalLength / docs.length : 1
  return { docs, avgDocLength: avgDocLength || 1, docFreq }
}

export function searchToolsWithMode(args: {
  index: ToolSearchIndex
  mode: ToolSearchEngineMode
  query: string
  maxMatches: number
}): ToolSearchResult {
  switch (args.mode) {
    case 'regex':
      return searchRegex(args.index, args.query, args.maxMatches)
    case 'keyword':
      return { matches: searchKeyword(args.index, args.query, args.maxMatches) }
    case 'hybrid':
      return { matches: searchHybrid(args.index, args.query, args.maxMatches) }
    case 'bm25':
    default:
      return { matches: searchBm25(args.index, args.query, args.maxMatches) }
  }
}

function searchHybrid(index: ToolSearchIndex, query: string, maxMatches: number): ToolDefinition[] {
  const ranked = searchBm25(index, query, maxMatches)
  const fallback = searchKeyword(index, query, maxMatches)
  const seen = new Set<string>()
  const out: ToolDefinition[] = []

  for (const tool of [...ranked, ...fallback]) {
    if (seen.has(tool.name)) continue
    seen.add(tool.name)
    out.push(tool)
    if (out.length >= maxMatches) break
  }

  return out
}

function searchBm25(index: ToolSearchIndex, rawQuery: string, maxMatches: number): ToolDefinition[] {
  const query = String(rawQuery || '').trim()
  if (!query) return []
  const parsed = parseSearchTerms(query)
  if (parsed.terms.length === 0 && !parsed.required) return []

  const totalDocs = index.docs.length
  if (totalDocs === 0) return []

  const scored: Array<{ tool: ToolDefinition; score: number }> = []

  for (const doc of index.docs) {
    if (parsed.required && !doc.haystackLower.includes(parsed.required)) continue

    let score = 0
    const uniqueTerms = new Set(parsed.terms)
    for (const term of uniqueTerms) {
      const tf = doc.weightedTermFreq.get(term) || 0
      if (tf <= 0) continue

      const df = index.docFreq.get(term) || 0
      const idf = Math.log(1 + ((totalDocs - df + 0.5) / (df + 0.5)))
      const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.docLength / index.avgDocLength))
      score += idf * ((tf * (BM25_K1 + 1)) / denom)
    }

    const queryLower = query.toLowerCase()
    if (doc.nameLower === queryLower) score += 6
    else if (doc.nameLower.includes(queryLower)) score += 1.5

    if (score > 0) scored.push({ tool: doc.tool, score })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.tool.name.localeCompare(b.tool.name)
  })
  return scored.slice(0, maxMatches).map((item) => item.tool)
}

function searchKeyword(index: ToolSearchIndex, rawQuery: string, maxMatches: number): ToolDefinition[] {
  const query = String(rawQuery || '').trim().toLowerCase()
  if (!query) return []

  const parsed = parseSearchTerms(query)
  const scored: Array<{ tool: ToolDefinition; score: number }> = []
  for (const doc of index.docs) {
    if (parsed.required && !doc.haystackLower.includes(parsed.required)) continue
    let score = 0
    for (const term of parsed.terms) {
      if (!doc.haystackLower.includes(term)) continue
      score += doc.nameLower === term ? 6 : 1
    }
    if (score <= 0 && parsed.terms.length > 0) continue
    if (score <= 0 && parsed.terms.length === 0 && doc.haystackLower.includes(query)) score = 1
    if (score > 0) scored.push({ tool: doc.tool, score })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.tool.name.localeCompare(b.tool.name)
  })
  return scored.slice(0, maxMatches).map((item) => item.tool)
}

function searchRegex(index: ToolSearchIndex, rawQuery: string, maxMatches: number): ToolSearchResult {
  const query = String(rawQuery || '').trim()
  if (!query) return { matches: [] }
  const compiled = compileRegex(query)
  if (!compiled.regex) return { matches: [], error: compiled.error || `Invalid regex query: ${query}` }

  const regex = compiled.regex
  const scored: Array<{ tool: ToolDefinition; score: number }> = []
  for (const doc of index.docs) {
    let score = 0
    if (regex.test(doc.nameText)) score += 6
    if (regex.test(doc.descriptionText)) score += 2
    if (regex.test(doc.schemaText)) score += 1
    if (score > 0) scored.push({ tool: doc.tool, score })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.tool.name.localeCompare(b.tool.name)
  })
  return { matches: scored.slice(0, maxMatches).map((item) => item.tool) }
}

function parseSearchTerms(rawQuery: string): ParsedSearchTerms {
  const query = String(rawQuery || '').trim().toLowerCase()
  if (!query) return { required: '', terms: [] }

  const required = query.startsWith('+') ? query.slice(1).split(/\s+/)[0] || '' : ''
  const terms = tokenize(query.replace(/^\+/, ''))
  return { required, terms }
}

function addWeightedTokens(target: Map<string, number>, tokens: string[], weight: number): void {
  if (weight <= 0) return
  for (const token of tokens) {
    target.set(token, (target.get(token) || 0) + weight)
  }
}

function tokenize(raw: string): string[] {
  const normalized = String(raw || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[\r\n\t]+/g, ' ')
    .toLowerCase()

  return normalized.match(TOKEN_RE) || []
}

function collectSchemaText(schema: unknown): string {
  const out: string[] = []
  const seen = new Set<unknown>()
  const walk = (value: unknown, depth: number): void => {
    if (depth > MAX_SCHEMA_DEPTH) return
    if (out.length >= MAX_SCHEMA_ENTRIES) return
    if (value === null || value === undefined) return
    if (typeof value === 'string') {
      if (value.trim()) out.push(value)
      return
    }
    if (typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, depth + 1)
        if (out.length >= MAX_SCHEMA_ENTRIES) break
      }
      return
    }

    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (out.length >= MAX_SCHEMA_ENTRIES) break
      if (key.trim()) out.push(key)
      walk(nested, depth + 1)
    }
  }

  walk(schema, 0)
  return out.join(' ')
}

function compileRegex(rawPattern: string): { regex: RegExp | null; error?: string } {
  const raw = String(rawPattern || '').trim()
  if (!raw) return { regex: null, error: 'Regex query must be non-empty.' }

  try {
    if (raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
      const last = raw.lastIndexOf('/')
      const body = raw.slice(1, last)
      const flags = raw.slice(last + 1).replace(/[gy]/g, '')
      return { regex: new RegExp(body, flags) }
    }
    return { regex: new RegExp(raw, 'i') }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { regex: null, error: `Invalid regex query: ${msg}` }
  }
}
