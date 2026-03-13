import { Marked, type Tokens } from 'marked'
import type { MarkdownShikiRuntime } from '../app/core/markdownShikiRuntime'

const CODE_BLOCK_PATTERN = '<pre><code(?:\\s+class="language-([^"]*)")?>([\\s\\S]*?)<\\/code><\\/pre>'
const SHIKI_THEME = 'github-light'

type WorkerRequest = {
  id: number
  text: string
}

type WorkerResponse =
  | { id: number; ok: true; html: string }
  | { id: number; ok: false; error: string }

const markedParser = new Marked({
  gfm: true,
  breaks: true,
})
markedParser.use({
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text)
    },
  },
})

let shikiRuntimePromise: Promise<MarkdownShikiRuntime> | null = null

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseMarkdown(text: string): string {
  const parsed = markedParser.parse(text)
  return typeof parsed === 'string' ? parsed : ''
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function wrapCodeBlock(codeHtml: string): string {
  return `<div data-component="markdown-code">${codeHtml}<button type="button" data-copy-code aria-label="Copy code" title="Copy code">Copy</button></div>`
}

async function getShikiRuntime(): Promise<MarkdownShikiRuntime> {
  if (!shikiRuntimePromise) {
    shikiRuntimePromise = import('../app/core/markdownShikiRuntime')
      .then((mod) => mod.createMarkdownShikiRuntime())
      .catch((error) => {
        shikiRuntimePromise = null
        throw error
      })
  }
  return shikiRuntimePromise
}

async function highlightCodeBlocks(html: string): Promise<string> {
  const codeBlockRegex = new RegExp(CODE_BLOCK_PATTERN, 'g')
  const matches = [...html.matchAll(codeBlockRegex)]
  if (matches.length === 0) return html

  let runtime: MarkdownShikiRuntime
  try {
    runtime = await getShikiRuntime()
  } catch {
    return html.replace(new RegExp(CODE_BLOCK_PATTERN, 'g'), (full) => wrapCodeBlock(full))
  }

  let result = ''
  let cursor = 0
  for (const match of matches) {
    const full = match[0]
    const language = runtime.normalizeLanguage(match[1])
    const escapedCode = match[2] ?? ''
    const index = match.index ?? 0

    result += html.slice(cursor, index)

    const code = decodeHtmlEntities(escapedCode)
    let highlighted = ''
    try {
      await runtime.ensureLanguageLoaded(language)
      highlighted = runtime.highlighter.codeToHtml(code, { lang: language, theme: SHIKI_THEME })
    } catch {
      highlighted = `<pre><code>${escapedCode}</code></pre>`
    }
    result += wrapCodeBlock(highlighted)
    cursor = index + full.length
  }

  result += html.slice(cursor)
  return result
}

async function renderMarkdown(text: string): Promise<string> {
  const rawHtml = parseMarkdown(text)
  return highlightCodeBlocks(rawHtml)
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const id = typeof event.data?.id === 'number' && Number.isFinite(event.data.id) ? event.data.id : -1
  if (id < 0) return
  const text = typeof event.data?.text === 'string' ? event.data.text : ''
  void renderMarkdown(text)
    .then((html) => {
      const response: WorkerResponse = { id, ok: true, html }
      self.postMessage(response)
    })
    .catch((error) => {
      const response: WorkerResponse = { id, ok: false, error: error instanceof Error ? error.message : String(error) }
      self.postMessage(response)
    })
}
