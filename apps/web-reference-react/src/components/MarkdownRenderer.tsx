import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react'
import {
  prepareMarkdownRender,
  renderHighlightedMarkdown,
  sanitizeMarkdownHtml,
  scheduleLowPriorityMarkdownTask,
  touchMarkdownCache,
} from '../app/core/markdownService'
import { cn } from '../lib/utils'

type MarkdownRendererProps = Omit<HTMLAttributes<HTMLDivElement>, 'dangerouslySetInnerHTML' | 'children'> & {
  text: string
  cacheKey?: string
}

export function MarkdownRenderer({ text, cacheKey, className, ...rest }: MarkdownRendererProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const prepared = useMemo(() => prepareMarkdownRender({ text, cacheKey }), [cacheKey, text])
  const [html, setHtml] = useState<string>(prepared.initialHtml)

  useEffect(() => {
    setHtml(prepared.initialHtml)
  }, [prepared])

  useEffect(() => {
    const { cached, hasCodeBlocks, key, hash, safeBaseHtml, rawHtml } = prepared

    if (cached) {
      touchMarkdownCache(key, cached)
      if (cached.highlightedHtml || !hasCodeBlocks) {
        return
      }
    } else {
      touchMarkdownCache(key, { hash, baseHtml: safeBaseHtml, rawHtml, hasCodeBlocks })
      if (!hasCodeBlocks) {
        return
      }
    }

    let cancelled = false
    const workerAbortController = new AbortController()
    const cancelScheduled = scheduleLowPriorityMarkdownTask(() => {
      void (async () => {
        let highlighted = ''
        try {
          highlighted = await renderHighlightedMarkdown({
            text,
            rawHtml,
            signal: workerAbortController.signal,
          })
        } catch {
          if (workerAbortController.signal.aborted) return
          return
        }
        if (cancelled) return
        const safeHighlighted = sanitizeMarkdownHtml(highlighted)
        touchMarkdownCache(key, {
          hash,
          baseHtml: safeBaseHtml,
          highlightedHtml: safeHighlighted,
          rawHtml,
          hasCodeBlocks,
        })
        setHtml(safeHighlighted)
      })()
    })

    return () => {
      cancelled = true
      workerAbortController.abort()
      cancelScheduled()
    }
  }, [prepared, text])

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
