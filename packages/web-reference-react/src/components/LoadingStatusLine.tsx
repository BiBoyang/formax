import { useEffect, useMemo, useState } from 'react'
import { cn } from '../lib/utils'

const DEFAULT_LOADING_WORDS: readonly string[] = [
  'Thinking',
  'Processing',
  'Considering',
  'Analyzing',
  'Synthesizing',
  'Reasoning',
  'Evaluating',
  'Planning',
]

function normalizeWords(words: readonly string[] | undefined): string[] {
  if (!words) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const word of words) {
    const trimmed = word.trim()
    if (!trimmed) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function withEllipsis(text: string): string {
  if (!text) return '...'
  if (text.endsWith('...')) return text
  if (text.endsWith('.')) return `${text.slice(0, -1)}...`
  return `${text}...`
}

function pickNextIndex(length: number, prevIndex: number | null, random: () => number): number {
  if (length <= 0) return -1
  if (length === 1) return 0
  const raw = random()
  const clamped = Number.isFinite(raw) && raw >= 0 ? Math.min(0.999999999999, raw) : 0
  let next = Math.floor(clamped * length)
  if (prevIndex !== null && prevIndex >= 0 && prevIndex < length && next === prevIndex) {
    next = (next + 1) % length
  }
  return next
}

export function LoadingStatusLine(props: {
  text?: string
  words?: readonly string[]
  cycleWords?: boolean
  wordIntervalMs?: number
  rng?: () => number
  prefix?: string
  className?: string
}) {
  const {
    text = 'Thinking',
    words,
    cycleWords = false,
    wordIntervalMs = 1800,
    rng = Math.random,
    prefix = '✻',
    className,
  } = props

  const wordList = useMemo(() => {
    if (!cycleWords) return []
    const source = words && words.length > 0 ? words : DEFAULT_LOADING_WORDS
    return normalizeWords(source)
  }, [cycleWords, words])

  const [wordIndex, setWordIndex] = useState(() => {
    if (!cycleWords || wordList.length === 0) return 0
    const next = pickNextIndex(wordList.length, null, rng)
    return next >= 0 ? next : 0
  })

  useEffect(() => {
    if (!cycleWords || wordList.length <= 1 || wordIntervalMs <= 0) return
    const timer = window.setInterval(() => {
      setWordIndex((prev) => pickNextIndex(wordList.length, prev, rng))
    }, wordIntervalMs)
    return () => {
      window.clearInterval(timer)
    }
  }, [cycleWords, wordIntervalMs, wordList.length, rng])

  const resolvedWord =
    cycleWords && wordList.length > 0
      ? wordList[Math.min(Math.max(0, wordIndex), wordList.length - 1)]
      : text
  const displayText = useMemo(() => withEllipsis(resolvedWord), [resolvedWord])

  return (
    <div className={cn('flex items-center gap-1.5 text-[11px] leading-none', className)}>
      <span className="text-muted-foreground/70">{prefix}</span>
      <span className="loading-shimmer">{displayText}</span>
    </div>
  )
}
