import DOMPurify from 'dompurify'
import { Marked, type Tokens } from 'marked'
import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react'
import { cn } from '../lib/utils'

type MarkdownRendererProps = Omit<HTMLAttributes<HTMLDivElement>, 'dangerouslySetInnerHTML' | 'children'> & {
  text: string
  cacheKey?: string
}

type CacheEntry = {
  hash: string
  baseHtml: string
  highlightedHtml?: string
}

const CACHE_LIMIT = 200
const markdownCache = new Map<string, CacheEntry>()
const CODE_BLOCK_PATTERN = '<pre><code(?:\\s+class="language-([^"]*)")?>([\\s\\S]*?)<\\/code><\\/pre>'
const HAS_CODE_BLOCK_REGEX = new RegExp(CODE_BLOCK_PATTERN)
const SHIKI_THEME = 'github-light'
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  shell: 'bash',
  sh: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  plaintext: 'text',
  txt: 'text',
}

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
let shikiRuntimePromise: Promise<ShikiRuntime> | null = null
let highlighterPromise: Promise<ShikiHighlighter> | null = null
let sharedMarkdownWorkerClient: SharedMarkdownWorkerClient | null = null

type ShikiRuntime = {
  bundledLanguages: Record<string, unknown>
  createHighlighter: (options: { themes: string[]; langs: string[] }) => Promise<ShikiHighlighter>
}

type ShikiHighlighter = {
  getLoadedLanguages: () => string[]
  loadLanguage: (lang: string) => Promise<unknown>
  codeToHtml: (code: string, options: { lang: string; theme: string }) => string
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

function sanitizeHtml(html: string) {
  initSanitizeHook()
  if (!DOMPurify.isSupported) return escapeHtml(html)
  return DOMPurify.sanitize(html, sanitizeConfig)
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

function touchCache(key: string, value: CacheEntry) {
  markdownCache.delete(key)
  markdownCache.set(key, value)
  if (markdownCache.size <= CACHE_LIMIT) return
  const first = markdownCache.keys().next().value
  if (!first) return
  markdownCache.delete(first)
}

function scheduleLowPriorityTask(run: () => void): () => void {
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

function normalizeLanguage(raw: string | undefined, bundledLanguages: Record<string, unknown>): string {
  const normalized = (raw ?? '').trim().toLowerCase()
  if (!normalized) return 'text'
  const aliased = LANGUAGE_ALIASES[normalized] ?? normalized
  if (aliased in bundledLanguages) {
    return aliased
  }
  return 'text'
}

async function getShikiRuntime(): Promise<ShikiRuntime> {
  if (!shikiRuntimePromise) {
    shikiRuntimePromise = import('shiki')
      .then((mod) => ({
        bundledLanguages: mod.bundledLanguages as Record<string, unknown>,
        createHighlighter: (options: { themes: string[]; langs: string[] }) => mod.createHighlighter(options) as Promise<ShikiHighlighter>,
      }))
      .catch((error) => {
        shikiRuntimePromise = null
        throw error
      })
  }
  return shikiRuntimePromise
}

async function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = getShikiRuntime()
      .then((runtime) =>
        runtime.createHighlighter({
          themes: [SHIKI_THEME],
          langs: ['text'],
        }),
      )
      .catch((error) => {
        highlighterPromise = null
        throw error
      })
  }
  return highlighterPromise
}

function parseMarkdown(text: string): string {
  const parsed = markedParser.parse(text)
  return typeof parsed === 'string' ? parsed : ''
}

function wrapCodeBlock(codeHtml: string): string {
  return `<div data-component="markdown-code">${codeHtml}<button type="button" data-copy-code aria-label="Copy code" title="Copy code">Copy</button></div>`
}

async function highlightCodeBlocks(html: string): Promise<string> {
  const codeBlockRegex = new RegExp(CODE_BLOCK_PATTERN, 'g')
  const matches = [...html.matchAll(codeBlockRegex)]
  if (matches.length === 0) return html

  let runtime: ShikiRuntime
  let highlighter: ShikiHighlighter
  try {
    runtime = await getShikiRuntime()
    highlighter = await getHighlighter()
  } catch {
    return html.replace(new RegExp(CODE_BLOCK_PATTERN, 'g'), (full) => wrapCodeBlock(full))
  }

  let result = ''
  let cursor = 0
  for (const match of matches) {
    const full = match[0]
    const language = normalizeLanguage(match[1], runtime.bundledLanguages)
    const escapedCode = match[2] ?? ''
    const index = match.index ?? 0

    result += html.slice(cursor, index)

    const code = decodeHtmlEntities(escapedCode)
    let highlighted = ''
    try {
      if (!highlighter.getLoadedLanguages().includes(language)) {
        await highlighter.loadLanguage(language)
      }
      highlighted = highlighter.codeToHtml(code, { lang: language, theme: SHIKI_THEME })
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
  if (typeof window === 'undefined' || typeof window.Worker !== 'function') {
    throw new Error('worker_unavailable')
  }
  if (sharedMarkdownWorkerClient) return sharedMarkdownWorkerClient

  const worker = new window.Worker(new URL('../workers/markdownRender.worker.ts', import.meta.url), {
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

export function MarkdownRenderer({ text, cacheKey, className, ...rest }: MarkdownRendererProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hash = useMemo(() => checksum(text), [text])
  const key = cacheKey ?? hash
  const cached = useMemo(() => {
    const entry = markdownCache.get(key)
    if (!entry || entry.hash !== hash) return null
    return entry
  }, [hash, key])
  const rawHtml = useMemo(() => parseMarkdown(text), [text])
  const safeBaseHtml = useMemo(() => cached?.baseHtml ?? sanitizeHtml(rawHtml), [cached, rawHtml])
  const [html, setHtml] = useState<string>(cached?.highlightedHtml ?? cached?.baseHtml ?? safeBaseHtml)

  useEffect(() => {
    setHtml(cached?.highlightedHtml ?? cached?.baseHtml ?? safeBaseHtml)
  }, [cached, safeBaseHtml])

  useEffect(() => {
    const hasCodeBlocks = HAS_CODE_BLOCK_REGEX.test(rawHtml)
    if (cached) {
      touchCache(key, cached)
      if (cached.highlightedHtml || !hasCodeBlocks) {
        return
      }
    } else {
      touchCache(key, { hash, baseHtml: safeBaseHtml })
      if (!hasCodeBlocks) {
        return
      }
    }

    let cancelled = false
    const workerAbortController = new AbortController()
    const cancelScheduled = scheduleLowPriorityTask(() => {
      void (async () => {
        let highlighted = ''
        try {
          highlighted = await renderMarkdownInWorker(text, workerAbortController.signal)
        } catch {
          if (workerAbortController.signal.aborted) return
          highlighted = await highlightCodeBlocks(rawHtml)
        }
        if (cancelled) return
        const safeHighlighted = sanitizeHtml(highlighted)
        touchCache(key, { hash, baseHtml: safeBaseHtml, highlightedHtml: safeHighlighted })
        setHtml(safeHighlighted)
      })()
    })

    return () => {
      cancelled = true
      workerAbortController.abort()
      cancelScheduled()
    }
  }, [cached, hash, key, rawHtml, safeBaseHtml, text])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const timeouts = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()
    const onClick = async (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const button = target.closest('[data-copy-code]')
      if (!(button instanceof HTMLButtonElement)) return

      const code = button.closest('[data-component="markdown-code"]')?.querySelector('pre code')?.textContent ?? ''
      if (!code) return
      if (!navigator.clipboard) return

      try {
        await navigator.clipboard.writeText(code)
      } catch {
        return
      }

      button.dataset.copied = 'true'
      button.textContent = 'Copied'
      button.setAttribute('aria-label', 'Copied')
      button.setAttribute('title', 'Copied')

      const existing = timeouts.get(button)
      if (existing) clearTimeout(existing)
      const timeout = setTimeout(() => {
        button.dataset.copied = 'false'
        button.textContent = 'Copy'
        button.setAttribute('aria-label', 'Copy code')
        button.setAttribute('title', 'Copy code')
      }, 2000)
      timeouts.set(button, timeout)
    }

    root.addEventListener('click', onClick)
    return () => {
      root.removeEventListener('click', onClick)
      for (const timeout of timeouts.values()) {
        clearTimeout(timeout)
      }
    }
  }, [html])

  return (
    <div
      ref={rootRef}
      className={cn('markdown-body', className)}
      {...rest}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
