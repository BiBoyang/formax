import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Text } from 'ink'
import { getTheme } from '../../utils/theme'

const DEFAULT_LOADING_WORDS: readonly string[] = [
  'Accomplishing',
  'Actioning',
  'Actualizing',
  'Baking',
  'Booping',
  'Brewing',
  'Calculating',
  'Cerebrating',
  'Channelling',
  'Churning',
  'Clauding',
  'Coalescing',
  'Cogitating',
  'Combobulating',
  'Computing',
  'Concocting',
  'Conjuring',
  'Considering',
  'Contemplating',
  'Cooking',
  'Crafting',
  'Creating',
  'Crunching',
  'Deciphering',
  'Deliberating',
  'Determining',
  'Discombobulating',
  'Divining',
  'Doing',
  'Effecting',
  'Elucidating',
  'Enchanting',
  'Envisioning',
  'Finagling',
  'Flibbertigibbeting',
  'Forging',
  'Forming',
  'Frolicking',
  'Generating',
  'Germinating',
  'Hatching',
  'Herding',
  'Honking',
  'Hustling',
  'Ideating',
  'Imagining',
  'Incubating',
  'Inferring',
  'Jiving',
  'Manifesting',
  'Marinating',
  'Meandering',
  'Moseying',
  'Mulling',
  'Mustering',
  'Musing',
  'Noodling',
  'Percolating',
  'Perusing',
  'Philosophising',
  'Pondering',
  'Pontificating',
  'Processing',
  'Puttering',
  'Puzzling',
  'Reticulating',
  'Ruminating',
  'Scheming',
  'Schlepping',
  'Shimmying',
  'Shucking',
  'Simmering',
  'Smooshing',
  'Spelunking',
  'Spinning',
  'Stewing',
  'Sussing',
  'Synthesizing',
  'Thinking',
  'Tinkering',
  'Transmuting',
  'Unfurling',
  'Unravelling',
  'Vibing',
  'Wandering',
  'Whirring',
  'Wibbling',
  'Wizarding',
  'Working',
  'Wrangling',
]

export type ShimmerFrame = { start: number; length: number }

export function buildShimmerFrames(charCount: number): ShimmerFrame[] {
  if (charCount <= 0) return [{ start: 0, length: 0 }]
  if (charCount === 1) return [{ start: 0, length: 1 }, { start: 0, length: 0 }]
  if (charCount === 2) {
    return [
      { start: 1, length: 1 },
      { start: 0, length: 2 },
      { start: 0, length: 1 },
      { start: 0, length: 0 },
    ]
  }

  const frames: ShimmerFrame[] = []
  frames.push({ start: charCount - 1, length: 1 })
  frames.push({ start: charCount - 2, length: 2 })

  for (let start = charCount - 3; start >= 0; start--) {
    frames.push({ start, length: 3 })
  }

  frames.push({ start: 0, length: 2 })
  frames.push({ start: 0, length: 1 })
  frames.push({ start: 0, length: 0 })

  return frames
}

export function splitCharsByFrame(chars: string[], frame: ShimmerFrame): {
  before: string
  highlight: string
  after: string
} {
  const n = chars.length
  if (n === 0) return { before: '', highlight: '', after: '' }

  const safeStart = Math.max(0, Math.min(n, frame.start))
  const safeEnd = Math.max(safeStart, Math.min(n, safeStart + frame.length))

  return {
    before: chars.slice(0, safeStart).join(''),
    highlight: chars.slice(safeStart, safeEnd).join(''),
    after: chars.slice(safeEnd).join(''),
  }
}

function withEllipsis(text: string, enabled: boolean): string {
  if (!enabled) return text
  if (!text) return '…'
  if (text.endsWith('…')) return text
  if (text.endsWith('...')) return `${text.slice(0, -3)}…`
  if (text.endsWith('.')) return `${text.slice(0, -1)}…`
  return `${text}…`
}

function normalizeWords(words: readonly string[] | undefined): string[] {
  if (!words) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const w of words) {
    const trimmed = w.trim()
    if (!trimmed) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export function pickNextRandomIndex(
  length: number,
  prevIndex: number | null,
  random: () => number,
): number {
  if (length <= 0) return -1
  if (length === 1) return 0

  const raw = random()
  const clamped =
    Number.isFinite(raw) && raw >= 0 ? Math.min(0.999999999999, raw) : 0

  let next = Math.floor(clamped * length)
  if (prevIndex !== null && prevIndex >= 0 && prevIndex < length && next === prevIndex) {
    next = (next + 1) % length
  }
  return next
}

export function LoadingStatusLine({
  text,
  words,
  cycleWords = false,
  wordIntervalMs = 2000,
  rng = Math.random,
  prefix = '✻',
  animate = true,
  intervalMs = 200,
  baseColor = '#d77757',
  highlightColor = '#eb9f7f',
  hintColor,
  hint,
  showHint = true,
  ellipsis = true,
}: {
  text?: string
  words?: readonly string[]
  cycleWords?: boolean
  wordIntervalMs?: number
  rng?: () => number
  prefix?: string
  animate?: boolean
  intervalMs?: number
  baseColor?: string
  highlightColor?: string
  hintColor?: string
  hint?: React.ReactNode
  showHint?: boolean
  ellipsis?: boolean
}): React.ReactNode {
  const theme = getTheme()
  const resolvedHintColor = hintColor ?? theme.secondaryText

  const wordList = useMemo(() => {
    if (!cycleWords) return []
    const source = words && words.length > 0 ? words : DEFAULT_LOADING_WORDS
    return normalizeWords(source)
  }, [cycleWords, words])

  const hasInitializedWordCycle = useRef(false)
  const [wordIndex, setWordIndex] = useState(() => {
    if (!cycleWords || wordList.length === 0) return 0
    const idxFromText = text ? wordList.indexOf(text) : -1
    if (idxFromText >= 0) return idxFromText
    const next = pickNextRandomIndex(wordList.length, null, rng)
    return next >= 0 ? next : 0
  })

  useEffect(() => {
    if (!cycleWords || wordList.length === 0) {
      hasInitializedWordCycle.current = false
      return
    }

    const idxFromText = text ? wordList.indexOf(text) : -1
    if (idxFromText >= 0) {
      setWordIndex(idxFromText)
      hasInitializedWordCycle.current = true
      return
    }

    if (!hasInitializedWordCycle.current) {
      const next = pickNextRandomIndex(wordList.length, null, rng)
      setWordIndex(next >= 0 ? next : 0)
      hasInitializedWordCycle.current = true
      return
    }

    setWordIndex((prev) => {
      if (prev >= 0 && prev < wordList.length) return prev
      const next = pickNextRandomIndex(wordList.length, null, rng)
      return next >= 0 ? next : 0
    })
  }, [cycleWords, rng, text, wordList])

  useEffect(() => {
    if (!cycleWords) return
    if (wordList.length <= 1) return
    if (wordIntervalMs <= 0) return

    const timer = setInterval(() => {
      setWordIndex((prev) => pickNextRandomIndex(wordList.length, prev, rng))
    }, wordIntervalMs)
    ;(timer as any).unref?.()
    return () => clearInterval(timer)
  }, [cycleWords, rng, wordIntervalMs, wordList.length])

  const resolvedWord =
    cycleWords && wordList.length > 0
      ? wordList[Math.min(Math.max(0, wordIndex), wordList.length - 1)]
      : text ?? 'Cogitating'

  const displayText = useMemo(() => withEllipsis(resolvedWord, ellipsis), [ellipsis, resolvedWord])
  const chars = useMemo(() => Array.from(displayText), [displayText])
  const frames = useMemo(() => buildShimmerFrames(chars.length), [chars.length])

  const [phase, setPhase] = useState(() => Math.max(0, frames.length - 1))

  useEffect(() => {
    setPhase(Math.max(0, frames.length - 1))
  }, [displayText, frames.length])

  useEffect(() => {
    if (!animate) {
      setPhase(Math.max(0, frames.length - 1))
      return
    }
    if (frames.length <= 1) return

    const timer = setInterval(() => {
      setPhase((p) => (p + 1) % frames.length)
    }, intervalMs)
    ;(timer as any).unref?.()
    return () => clearInterval(timer)
  }, [animate, frames.length, intervalMs])

  const frame = frames[Math.min(Math.max(0, phase), frames.length - 1)]
  const parts = splitCharsByFrame(chars, frame)

  return (
    <Text>
      <Text color={baseColor}>{prefix} </Text>
      <Text color={baseColor}>{parts.before}</Text>
      {parts.highlight && <Text color={highlightColor}>{parts.highlight}</Text>}
      <Text color={baseColor}>{parts.after}</Text>
      {showHint &&
        (hint ?? (
          <>
            <Text color={resolvedHintColor}> (</Text>
            <Text color={resolvedHintColor} bold>
              esc
            </Text>
            <Text color={resolvedHintColor}> to interrupt)</Text>
          </>
        ))}
    </Text>
  )
}
