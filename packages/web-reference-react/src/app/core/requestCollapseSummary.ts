import type { RequestCollapseSummary } from '../../types'

export function areRequestCollapseSummariesEqual(
  left: RequestCollapseSummary | null | undefined,
  right: RequestCollapseSummary | null | undefined,
): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return (
    left.phase === right.phase &&
    left.collapsedHeadMessageCount === right.collapsedHeadMessageCount &&
    left.estimatedTokensSaved === right.estimatedTokensSaved &&
    (left.recapFingerprint ?? null) === (right.recapFingerprint ?? null)
  )
}
