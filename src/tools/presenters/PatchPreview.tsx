import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'

const MAX_LINE_DP_CELLS = 60_000
const MAX_TOKEN_DP_CELLS = 30_000
const MAX_INPUT_LINES_PER_SIDE = 400
const MAX_RENDER_ROWS = 180

type DiffOp =
  | { kind: 'equal'; line: string }
  | { kind: 'delete'; line: string }
  | { kind: 'insert'; line: string }

type Seg = { text: string; changed: boolean }

type Row =
  | { kind: 'equal'; lineNo: number; text: string }
  | { kind: 'delete'; lineNo: number; text: string; segments?: Seg[] }
  | { kind: 'insert'; lineNo: number; text: string; segments?: Seg[] }
  | { kind: 'ellipsis' }

function tokenizeForIntralineDiff(text: string): string[] {
  const s = String(text ?? '')
  const tokens = s.match(/[A-Za-z0-9_]+|\s+|[^\w\s]+/g)
  return tokens ?? [s]
}

function buildLcsMatrix(a: string[], b: string[], maxCells: number): number[][] | null {
  const cells = a.length * b.length
  if (cells > maxCells) return null
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp
}

function diffTokens(aTokens: string[], bTokens: string[]): { aChanged: boolean[]; bChanged: boolean[] } {
  const dp = buildLcsMatrix(aTokens, bTokens, MAX_TOKEN_DP_CELLS)
  if (!dp) {
    return {
      aChanged: Array(aTokens.length).fill(false),
      bChanged: Array(bTokens.length).fill(false),
    }
  }
  const aChanged = Array(aTokens.length).fill(true)
  const bChanged = Array(bTokens.length).fill(true)

  let i = aTokens.length
  let j = bTokens.length
  while (i > 0 && j > 0) {
    if (aTokens[i - 1] === bTokens[j - 1]) {
      aChanged[i - 1] = false
      bChanged[j - 1] = false
      i--
      j--
      continue
    }
    if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }

  // Avoid speckle: never highlight pure whitespace.
  for (let k = 0; k < aTokens.length; k++) {
    if (/^\s+$/.test(aTokens[k])) aChanged[k] = false
  }
  for (let k = 0; k < bTokens.length; k++) {
    if (/^\s+$/.test(bTokens[k])) bChanged[k] = false
  }

  return { aChanged, bChanged }
}

function buildSegments(tokens: string[], changed: boolean[]): Seg[] {
  const out: Seg[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const c = Boolean(changed[i])
    const last = out[out.length - 1]
    if (last && last.changed === c) last.text += t
    else out.push({ text: t, changed: c })
  }
  return out
}

function intralineSegments(a: string, b: string): { a: Seg[]; b: Seg[] } {
  const aTokens = tokenizeForIntralineDiff(a)
  const bTokens = tokenizeForIntralineDiff(b)
  const { aChanged, bChanged } = diffTokens(aTokens, bTokens)
  return { a: buildSegments(aTokens, aChanged), b: buildSegments(bTokens, bChanged) }
}

function diffLines(a: string[], b: string[]): DiffOp[] {
  const dp = buildLcsMatrix(a, b, MAX_LINE_DP_CELLS)
  if (!dp) return diffLinesFallback(a, b)
  const ops: DiffOp[] = []

  let i = a.length
  let j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ kind: 'equal', line: a[i - 1] })
      i--
      j--
      continue
    }
    if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ kind: 'insert', line: b[j - 1] })
      j--
      continue
    }
    ops.push({ kind: 'delete', line: a[i - 1] })
    i--
  }

  return ops.reverse()
}

function diffLinesFallback(a: string[], b: string[]): DiffOp[] {
  const ops: DiffOp[] = []
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const av = i < a.length ? a[i] : null
    const bv = i < b.length ? b[i] : null
    if (av !== null && bv !== null) {
      if (av === bv) ops.push({ kind: 'equal', line: av })
      else {
        ops.push({ kind: 'delete', line: av })
        ops.push({ kind: 'insert', line: bv })
      }
      continue
    }
    if (av !== null) ops.push({ kind: 'delete', line: av })
    else if (bv !== null) ops.push({ kind: 'insert', line: bv })
  }
  return ops
}

function formatLineNo(n: number, width = 4): string {
  return String(n).padStart(width, ' ')
}

function normalizeLines(text: string): string[] {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

export function PatchPreview({
  oldText,
  newText,
  startLineNumber = 1,
}: {
  oldText: string
  newText: string
  startLineNumber?: number
}): React.ReactNode {
  const theme = getTheme()

  const linesOld = useMemo(() => normalizeLines(oldText).slice(0, MAX_INPUT_LINES_PER_SIDE), [oldText])
  const linesNew = useMemo(() => normalizeLines(newText).slice(0, MAX_INPUT_LINES_PER_SIDE), [newText])

  const ops = useMemo(() => diffLines(linesOld, linesNew), [linesOld, linesNew])

  const rendered = useMemo(() => {
    const rows: Row[] = []

    let oldNo = startLineNumber
    let newNo = startLineNumber

    let idx = 0
    while (idx < ops.length) {
      const op = ops[idx]
      if (op.kind === 'equal') {
        rows.push({ kind: 'equal', lineNo: newNo, text: op.line })
        oldNo++
        newNo++
        idx++
        continue
      }

      const group: DiffOp[] = []
      while (idx < ops.length && ops[idx].kind !== 'equal') {
        group.push(ops[idx])
        idx++
      }

      const deletes = group.filter((g) => g.kind === 'delete')
      const inserts = group.filter((g) => g.kind === 'insert')

      const paired = Math.min(deletes.length, inserts.length)
      const pairedSegs: Array<{ del: Seg[]; ins: Seg[] }> = []
      for (let i = 0; i < paired; i++) {
        const seg = intralineSegments(deletes[i].line, inserts[i].line)
        pairedSegs.push({ del: seg.a, ins: seg.b })
      }

      for (let i = 0; i < deletes.length; i++) {
        const segs = i < paired ? pairedSegs[i].del : undefined
        rows.push({ kind: 'delete', lineNo: oldNo, text: deletes[i].line, segments: segs })
        oldNo++
      }
      for (let i = 0; i < inserts.length; i++) {
        const segs = i < paired ? pairedSegs[i].ins : undefined
        rows.push({ kind: 'insert', lineNo: newNo, text: inserts[i].line, segments: segs })
        newNo++
      }
    }

    if (rows.length <= MAX_RENDER_ROWS) return rows

    const head = rows.slice(0, MAX_RENDER_ROWS - 1)
    head.push({ kind: 'ellipsis' })
    return head
  }, [ops, startLineNumber])

  return (
    <Box flexDirection="column">
      {rendered.map((row, i) => {
        if (row.kind === 'ellipsis') {
          return (
            <Box key={`ellipsis-${i}`}>
              <Text color={theme.secondaryText}> …</Text>
            </Box>
          )
        }

        if (row.kind === 'equal') {
          return (
            <Box key={`eq-${i}`}>
              <Text color={theme.secondaryText}>{formatLineNo(row.lineNo)} </Text>
              {/* Align content with +/- rows. */}
              <Text color={theme.secondaryText}>   </Text>
              <Text color={theme.text}>{row.text}</Text>
            </Box>
          )
        }

        const baseBg = row.kind === 'insert' ? theme.diff.addedDimmed : theme.diff.removedDimmed
        const highlightBg = row.kind === 'insert' ? theme.diff.added : theme.diff.removed
        const sign = row.kind === 'insert' ? '+' : '-'
        const segs = row.segments ?? [{ text: row.text, changed: false }]

        return (
          <Box key={`${row.kind}-${i}`}>
            <Text color={theme.secondaryText}>{formatLineNo(row.lineNo)} </Text>
            <Text color={theme.secondaryText}>{sign}  </Text>
            <Text>
              {segs.map((seg, j) => (
                <Text
                  key={`${row.kind}-${i}-${j}`}
                  backgroundColor={seg.changed ? highlightBg : baseBg}
                  color={theme.text}
                >
                  {seg.text}
                </Text>
              ))}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
