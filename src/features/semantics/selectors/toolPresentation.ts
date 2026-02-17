import type { ToolSegment } from '../projection/transcriptProjection'

export type ToolPresentation = {
  summary: string
  firstLine: string
  remainingSummaryLines: string[]
  detailLines: string[]
}

export function selectToolPresentation(segment: Pick<ToolSegment, 'summary' | 'detailLines'>): ToolPresentation {
  const summary = String(segment.summary ?? '')
  const lines = summary.split(/\r?\n/)
  const firstLine = String(lines[0] ?? '')
  const remainingSummaryLines = lines.slice(1).map((line) => String(line ?? '')).filter((line) => line.length > 0)
  return {
    summary,
    firstLine,
    remainingSummaryLines,
    detailLines: segment.detailLines,
  }
}
