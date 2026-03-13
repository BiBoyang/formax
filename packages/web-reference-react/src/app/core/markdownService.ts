import DOMPurify from 'dompurify'
import { Marked, type Tokens } from 'marked'
import type { MarkdownShikiRuntime } from './markdownShikiRuntime'

export type MarkdownCacheEntry = {
  hash: string
  baseHtml: string
  sourceText?: string
  highlightedHtml?: string
  rawHtml?: string
  hasCodeBlocks?: boolean
}

export type PreparedMarkdownRender = {
  key: string
  hash: string
  cached: MarkdownCacheEntry | null
  rawHtml: string
  safeBaseHtml: string
  initialHtml: string
  hasCodeBlocks: boolean
}

type MarkdownWorkerRequest = {
  id: number
  text: string
}

type MarkdownWorkerResponse =
  | { id: number; ok: true; html: string }
  | { id: number; ok: false; error: string }

type WorkerPendingRequest = {
  resolve: (html: string) => void
  reject: (error: Error) => void
}

type SharedMarkdownWorkerClient = {
  worker: Worker
  nextRequestId: number
  pending: Map<number, WorkerPendingRequest>
}

const CACHE_LIMIT = 200
const markdownCache = new Map<string, MarkdownCacheEntry>()
const CODE_BLOCK_PATTERN = '<pre><code(?:\\s+class="language-([^"]*)")?>([\\s\\S]*?)<\\/code><\\/pre>'
const HAS_CODE_BLOCK_REGEX = new RegExp(CODE_BLOCK_PATTERN)
const SHIKI_THEME = 'github-light'

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

const sanitizeConfig = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ['style'],
  FORBID_CONTENTS: ['style', 'script'],
}

let sanitizeHookInitialized = false
let shikiRuntimePromise: Promise<MarkdownShikiRuntime> | null = null
let sharedMarkdownWorkerClient: SharedMarkdownWorkerClient | null = null

function initSanitizeHook() {
  if (sanitizeHookInitialized) return
  if (typeof window === 'undefined' || !DOMPurify.isSupported) return

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof HTMLAnchorElement)) return
    node.setAttribute('target', '_blank')

    const rel = node.getAttribute('rel') ?? ''
    const tokens = new Set(rel.split(/\s+/).filter(Boolean))
    tokens.add('noopener')
    tokens.add('noreferrer')
    node.setAttribute('rel', Array.from(tokens).join(' '))
  })

  sanitizeHookInitialized = true
}

function checksum(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

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

function wrapCodeBlock(codeHtml: string): string {
  return `<div data-component="markdown-code">${codeHtml}<button type="button" data-copy-code aria-label="Copy code" title="Copy code">Copy</button></div>`
}

async function getShikiRuntime(): Promise<MarkdownShikiRuntime> {
  if (!shikiRuntimePromise) {
    shikiRuntimePromise = import('./markdownShikiRuntime')
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

function resetSharedMarkdownWorkerClient(client: SharedMarkdownWorkerClient): void {
  if (sharedMarkdownWorkerClient !== client) return
  sharedMarkdownWorkerClient = null
  client.worker.terminate()
}

function getSharedMarkdownWorkerClient(): SharedMarkdownWorkerClient {
  if (typeof window === 'undefined' || typeof Worker !== 'function') {
    throw new Error('worker_unavailable')
  }
  if (sharedMarkdownWorkerClient) return sharedMarkdownWorkerClient

  const worker = new Worker(new URL('../../workers/markdownRender.worker.ts', import.meta.url), {
    type: 'module',
  })
  const client: SharedMarkdownWorkerClient = {
    worker,
    nextRequestId: 1,
    pending: new Map(),
  }

  worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
    const payload = event.data
    if (!payload || typeof payload.id !== 'number') return
    const pending = client.pending.get(payload.id)
    if (!pending) return
    client.pending.delete(payload.id)

    if (payload.ok === true && typeof payload.html === 'string') {
      pending.resolve(payload.html)
      return
    }

    pending.reject(new Error(payload.ok === false ? payload.error : 'worker_render_failed'))
  }

  worker.onerror = () => {
    const pending = Array.from(client.pending.values())
    client.pending.clear()
    resetSharedMarkdownWorkerClient(client)
    for (const request of pending) {
      request.reject(new Error('worker_render_error'))
    }
  }

  sharedMarkdownWorkerClient = client
  return client
}

async function renderMarkdownInWorker(text: string, signal?: AbortSignal): Promise<string> {
  const client = getSharedMarkdownWorkerClient()
  const requestId = client.nextRequestId
  client.nextRequestId += 1

  return new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
    }

    const resolvePending = (html: string) => {
      cleanup()
      resolve(html)
    }

    const rejectPending = (error: Error) => {
      cleanup()
      reject(error)
    }

    const onAbort = () => {
      if (!client.pending.delete(requestId)) return
      rejectPending(new Error('worker_aborted'))
    }

    client.pending.set(requestId, { resolve: resolvePending, reject: rejectPending })

    if (signal) {
      if (signal.aborted) {
        client.pending.delete(requestId)
        rejectPending(new Error('worker_aborted'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      const message: MarkdownWorkerRequest = { id: requestId, text }
      client.worker.postMessage(message)
    } catch (error) {
      client.pending.delete(requestId)
      rejectPending(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export function sanitizeMarkdownHtml(html: string): string {
  initSanitizeHook()
  if (!DOMPurify.isSupported) return escapeHtml(html)
  return DOMPurify.sanitize(html, sanitizeConfig)
}

export function touchMarkdownCache(key: string, value: MarkdownCacheEntry): void {
  markdownCache.delete(key)
  markdownCache.set(key, value)
  if (markdownCache.size <= CACHE_LIMIT) return
  const first = markdownCache.keys().next().value
  if (!first) return
  markdownCache.delete(first)
}

function isSourceTextCompatible(entry: MarkdownCacheEntry, text: string): boolean {
  if (typeof entry.sourceText === 'string') {
    return entry.sourceText === text
  }
  return true
}

function findCachedEntryByHash(hash: string, text: string): MarkdownCacheEntry | null {
  for (const entry of markdownCache.values()) {
    if (entry.hash === hash && typeof entry.sourceText === 'string' && entry.sourceText === text) {
      return entry
    }
  }
  return null
}

function hasReusableMarkdownPayload(
  entry: MarkdownCacheEntry | null,
): entry is MarkdownCacheEntry & { rawHtml: string; hasCodeBlocks: boolean } {
  return Boolean(entry && typeof entry.rawHtml === 'string' && typeof entry.hasCodeBlocks === 'boolean')
}

export function prepareMarkdownRender(args: { text: string; cacheKey?: string }): PreparedMarkdownRender {
  const hash = checksum(args.text)
  const key = args.cacheKey ?? hash
  const keyEntry = markdownCache.get(key)
  const keyCached =
    keyEntry && keyEntry.hash === hash && isSourceTextCompatible(keyEntry, args.text) ? keyEntry : null
  const cached = keyCached ?? findCachedEntryByHash(hash, args.text)
  if (hasReusableMarkdownPayload(cached)) {
    return {
      key,
      hash,
      cached,
      rawHtml: cached.rawHtml,
      safeBaseHtml: cached.baseHtml,
      initialHtml: cached.highlightedHtml ?? cached.baseHtml,
      hasCodeBlocks: cached.hasCodeBlocks,
    }
  }

  const rawHtml = parseMarkdown(args.text)
  const safeBaseHtml = cached?.baseHtml ?? sanitizeMarkdownHtml(rawHtml)
  const hasCodeBlocks =
    typeof cached?.hasCodeBlocks === 'boolean' ? cached.hasCodeBlocks : HAS_CODE_BLOCK_REGEX.test(rawHtml)
  return {
    key,
    hash,
    cached,
    rawHtml,
    safeBaseHtml,
    initialHtml: cached?.highlightedHtml ?? cached?.baseHtml ?? safeBaseHtml,
    hasCodeBlocks,
  }
}

export function scheduleLowPriorityMarkdownTask(run: () => void): () => void {
  const schedulerLike = globalThis as typeof globalThis & {
    scheduler?: {
      postTask?: (callback: () => void, options?: { priority?: 'user-blocking' | 'user-visible' | 'background' }) => unknown
    }
  }
  if (schedulerLike.scheduler?.postTask) {
    let cancelled = false
    const task = schedulerLike.scheduler.postTask(
      () => {
        if (!cancelled) run()
      },
      { priority: 'background' },
    ) as { cancel?: () => void } | undefined
    return () => {
      cancelled = true
      task?.cancel?.()
    }
  }

  if (typeof window !== 'undefined') {
    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback) => number
      cancelIdleCallback?: (handle: number) => void
    }
    if (typeof win.requestIdleCallback === 'function') {
      const handle = win.requestIdleCallback(() => run())
      return () => {
        win.cancelIdleCallback?.(handle)
      }
    }
  }

  const timeout = setTimeout(run, 0)
  return () => {
    clearTimeout(timeout)
  }
}

export async function renderHighlightedMarkdown(args: {
  text: string
  rawHtml: string
  signal?: AbortSignal
}): Promise<string> {
  try {
    return await renderMarkdownInWorker(args.text, args.signal)
  } catch {
    if (args.signal?.aborted) {
      throw new Error('worker_aborted')
    }
    return highlightCodeBlocks(args.rawHtml)
  }
}

export function resetMarkdownServiceForTests(): void {
  markdownCache.clear()
  shikiRuntimePromise = null
  if (sharedMarkdownWorkerClient) {
    sharedMarkdownWorkerClient.worker.terminate()
    sharedMarkdownWorkerClient = null
  }
  sanitizeHookInitialized = false
}
