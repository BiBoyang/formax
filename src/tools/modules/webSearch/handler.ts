import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'

type WebSearchResult = {
  title: string
  url: string
  snippet?: string
  domain?: string
}

export const WebSearchToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'WebSearch'
  },

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const input = call.input || {}
      const query = (input as any).query
      const allowedDomains = normalizeDomains((input as any).allowed_domains)
      const blockedDomains = normalizeDomains((input as any).blocked_domains)

      if (typeof query !== 'string' || !query.trim()) throw new Error('Missing query')

      const results = await duckDuckGoSearch(query, {
        signal: ctx.signal,
        allowedDomains,
        blockedDomains,
        maxResults: 5,
      })

      const lines: string[] = [`Found ${results.length} results`]
      results.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.title}`.trim())
        lines.push(`   ${r.url}`)
        if (r.snippet) lines.push(`   ${r.snippet}`)
      })

      return { tool_use_id: call.id, content: lines.join('\n') }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}

async function duckDuckGoSearch(
  query: string,
  opts: {
    signal?: AbortSignal
    allowedDomains: string[]
    blockedDomains: string[]
    maxResults: number
  },
): Promise<WebSearchResult[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'text/html',
      'user-agent': 'formax/0.1 (WebSearch)',
    },
    signal: opts.signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching search results`)
  const html = await res.text()

  const results = extractDuckDuckGoResults(html)
    .map((r) => ({
      ...r,
      domain: safeHostname(r.url),
    }))
    .filter((r) => isDomainAllowed(r.domain || '', opts.allowedDomains, opts.blockedDomains))

  return results.slice(0, opts.maxResults)
}

function extractDuckDuckGoResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = []
  const anchorRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi

  let match: RegExpExecArray | null
  while ((match = anchorRe.exec(html))) {
    const rawHref = match[1]
    const rawTitle = match[2]
    const title = decodeHtmlEntities(stripTags(rawTitle)).trim()
    const url = normalizeResultUrl(rawHref)
    if (!title || !url) continue

    const snippet = extractSnippetNear(html, match.index)
    results.push({ title, url, snippet })
    if (results.length >= 10) break
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  return results.filter((r) => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
}

function extractSnippetNear(html: string, anchorIndex: number): string | undefined {
  const window = html.slice(anchorIndex, anchorIndex + 2500)
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i
  const match = snippetRe.exec(window)
  if (!match) return undefined
  const snippet = decodeHtmlEntities(stripTags(match[1])).trim()
  return snippet || undefined
}

function normalizeResultUrl(href: string): string {
  const raw = (href || '').trim()
  if (!raw) return ''

  let normalized = raw
  if (normalized.startsWith('//')) normalized = `https:${normalized}`
  if (normalized.startsWith('/')) normalized = `https://duckduckgo.com${normalized}`

  try {
    const u = new URL(normalized)
    if (u.hostname.endsWith('duckduckgo.com') && u.pathname === '/l/') {
      const uddg = u.searchParams.get('uddg')
      if (uddg) return uddg
    }
    return u.toString()
  } catch {
    return normalized
  }
}

function normalizeDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => String(v || '').trim().toLowerCase())
    .filter((v) => v.length > 0)
}

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

function isDomainAllowed(hostname: string, allowed: string[], blocked: string[]): boolean {
  const host = (hostname || '').toLowerCase()
  if (!host) return true

  if (blocked.length > 0 && blocked.some((d) => domainMatches(host, d))) return false
  if (allowed.length > 0) return allowed.some((d) => domainMatches(host, d))
  return true
}

function domainMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase()
  if (host === d) return true
  return host.endsWith(`.${d}`)
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }

  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_m, code) => {
    const key = String(code)
    if (key[0] !== '#') {
      return named[key] ?? `&${key};`
    }

    const num = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10)
    if (!Number.isFinite(num)) return _m
    try {
      return String.fromCodePoint(num)
    } catch {
      return _m
    }
  })
}

