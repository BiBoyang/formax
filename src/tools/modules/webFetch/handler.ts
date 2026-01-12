import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import type { AnthropicStreamClient } from '../../../streaming/anthropic/StreamClient'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'

export function createWebFetchToolHandler(deps: {
  client: AnthropicStreamClient
  maxTokens?: number
  maxInputChars?: number
}): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'WebFetch'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      try {
        const input = requirePlainObject(call.input || {}, 'WebFetch.input')
        assertNoExtraKeys(input, ['url', 'prompt'], 'WebFetch.input')
        const urlRaw = (input as any).url
        const prompt = (input as any).prompt

        if (typeof urlRaw !== 'string' || !urlRaw.trim()) throw new Error('Missing url')
        if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Missing prompt')

        const url = normalizeUrl(urlRaw)
        const pageText = await fetchAsText(url, {
          signal: ctx.signal,
          maxChars: deps.maxInputChars ?? 120_000,
        })

        const contentForModel = buildWebFetchAnalyzerPrompt({
          url,
          prompt: prompt.trim(),
          content: pageText,
        })

        let answer = ''
        await deps.client.streamOnce({
          messages: [{ role: 'user', content: [{ type: 'text', text: contentForModel }] }],
          system: [],
          tools: [],
          onEvent: (ev) => {
            if (ev.type === 'assistant_delta' && typeof ev.text === 'string') answer += ev.text
          },
          executeTool: async (toolCall) => ({
            tool_use_id: toolCall.id,
            content: 'Tool use is disabled for WebFetch analysis',
            is_error: true,
          }),
          signal: ctx.signal,
          maxTokens: deps.maxTokens ?? 1024,
        })

        const trimmed = answer.trim()
        return { tool_use_id: call.id, content: trimmed || '(no output)' }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
      }
    },
  }
}

function normalizeUrl(urlRaw: string): string {
  const raw = urlRaw.trim()
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Invalid url')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http/https URLs are supported')
  }

  if (url.protocol === 'http:') url.protocol = 'https:'
  return url.toString()
}

async function fetchAsText(
  url: string,
  opts: { signal?: AbortSignal; maxChars: number },
): Promise<string> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': 'formax/0.1 (WebFetch)',
    },
    signal: opts.signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching url`)

  const contentType = res.headers.get('content-type') || ''
  const raw = await res.text()
  const limited = raw.length > opts.maxChars ? raw.slice(0, opts.maxChars) : raw

  if (contentType.includes('text/html') || looksLikeHtml(limited)) {
    return htmlToPlainText(limited)
  }

  return limited
}

function looksLikeHtml(text: string): boolean {
  const t = text.trim().slice(0, 500).toLowerCase()
  return t.includes('<html') || t.includes('<!doctype') || /<body[\s>]/.test(t)
}

function htmlToPlainText(html: string): string {
  let s = html

  // Remove scripts/styles
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')

  // Basic block-level newlines
  s = s.replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr)>/gi, '\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')

  // Strip remaining tags
  s = s.replace(/<[^>]*>/g, '')

  // Decode entities (minimal)
  s = decodeHtmlEntities(s)

  // Normalize whitespace
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  s = s.replace(/[ \t]+\n/g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
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

function buildWebFetchAnalyzerPrompt(args: {
  url: string
  prompt: string
  content: string
}): string {
  const intro =
    'You are a fast web content analyzer. Use the provided page content to answer the user prompt. Be concise and factual. If the page content is insufficient, say so.'

  return [
    intro,
    '',
    `URL: ${args.url}`,
    '',
    `User prompt: ${args.prompt}`,
    '',
    'Page content:',
    args.content,
  ].join('\n')
}
