import type { CompactBoundarySummary } from '../../types'

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseKeepStrategy(value: unknown): CompactBoundarySummary['keepStrategy'] | undefined {
  const record = asOptionalRecord(value)
  if (!record) return undefined
  if (record.kind === 'keep_last_turns') {
    const keepLastTurns = asFiniteNumber(record.keepLastTurns)
    if (keepLastTurns == null) return undefined
    return { kind: 'keep_last_turns', keepLastTurns }
  }
  if (record.kind === 'keep_combo') {
    const keepLastTurns = asFiniteNumber(record.keepLastTurns)
    const keepMinTokens = asFiniteNumber(record.keepMinTokens)
    const keepMinUserTurns = asFiniteNumber(record.keepMinUserTurns)
    if (keepLastTurns == null || keepMinTokens == null || keepMinUserTurns == null) return undefined
    return { kind: 'keep_combo', keepLastTurns, keepMinTokens, keepMinUserTurns }
  }
  return undefined
}

function parseRehydrationPlan(value: unknown): CompactBoundarySummary['rehydrationPlan'] | undefined {
  const record = asOptionalRecord(value)
  if (!record || record.schemaVersion !== 1 || !Array.isArray(record.items)) return undefined
  const items: NonNullable<CompactBoundarySummary['rehydrationPlan']>['items'] = []
  for (const rawItem of record.items) {
    const item = asOptionalRecord(rawItem)
    if (!item) return undefined
    const kind =
      item.kind === 'recent_files' ||
      item.kind === 'plan_state' ||
      item.kind === 'todo_state' ||
      item.kind === 'mode_state'
        ? item.kind
        : null
    const priority = item.priority === 'high' || item.priority === 'medium' ? item.priority : null
    const status = item.status === 'planned' || item.status === 'applied' ? item.status : null
    if (!kind || !priority || !status) return undefined
    items.push({ kind, priority, status })
  }
  return { schemaVersion: 1, items }
}

function parseRehydrationCost(value: unknown): CompactBoundarySummary['rehydrationCost'] | undefined {
  const record = asOptionalRecord(value)
  if (!record) return undefined
  const sectionCount = asFiniteNumber(record.sectionCount)
  const estimatedTokens = asFiniteNumber(record.estimatedTokens)
  if (sectionCount == null || estimatedTokens == null) return undefined
  return { sectionCount, estimatedTokens }
}

function parsePreservedSegment(value: unknown): CompactBoundarySummary['preservedSegment'] | undefined {
  const record = asOptionalRecord(value)
  if (!record || record.schemaVersion !== 1) return undefined
  const continuationMessageCount = asFiniteNumber(record.continuationMessageCount)
  const preservedTailMessageCount = asFiniteNumber(record.preservedTailMessageCount)
  const summaryFingerprint =
    typeof record.summaryFingerprint === 'string' && record.summaryFingerprint.trim() ? record.summaryFingerprint : null
  const headFingerprint =
    record.headFingerprint === null
      ? null
      : typeof record.headFingerprint === 'string' && record.headFingerprint.trim()
        ? record.headFingerprint
        : undefined
  const tailFingerprint =
    record.tailFingerprint === null
      ? null
      : typeof record.tailFingerprint === 'string' && record.tailFingerprint.trim()
        ? record.tailFingerprint
        : undefined
  if (
    continuationMessageCount == null ||
    preservedTailMessageCount == null ||
    !summaryFingerprint ||
    headFingerprint === undefined ||
    tailFingerprint === undefined
  ) {
    return undefined
  }
  return {
    schemaVersion: 1,
    continuationMessageCount,
    preservedTailMessageCount,
    summaryFingerprint,
    headFingerprint,
    tailFingerprint,
  }
}

function parseCompactTriggerReason(value: unknown): CompactBoundarySummary['triggerReason'] | undefined {
  const record = asOptionalRecord(value)
  if (!record) return undefined
  const kind =
    record.kind === 'auto_threshold' || record.kind === 'manual' || record.kind === 'reactive_error'
      ? record.kind
      : null
  if (!kind) return undefined
  const detail =
    record.detail === undefined
      ? undefined
      : typeof record.detail === 'string' && record.detail.trim()
        ? record.detail
        : null
  if (detail === null) return undefined
  return detail ? { kind, detail } : { kind }
}

export function parseCompactBoundarySummary(value: unknown): CompactBoundarySummary | null {
  if (value == null) return null
  const record = asOptionalRecord(value)
  if (!record || record.schemaVersion !== 1) return null
  const keepStrategy = parseKeepStrategy(record.keepStrategy)
  const rehydrationPlan = parseRehydrationPlan(record.rehydrationPlan)
  const rehydrationCost = parseRehydrationCost(record.rehydrationCost)
  const preservedSegment = parsePreservedSegment(record.preservedSegment)
  const triggerReason = record.triggerReason == null ? undefined : parseCompactTriggerReason(record.triggerReason)
  if (record.triggerReason != null && !triggerReason) return null
  const trigger =
    record.trigger === 'manual' || record.trigger === 'auto' || record.trigger === 'reactive' ? record.trigger : undefined
  const summaryKind =
    record.summaryKind === 'model_summary' || record.summaryKind === 'session_memory'
      ? record.summaryKind
      : undefined

  return {
    schemaVersion: 1,
    ...(trigger ? { trigger } : {}),
    ...(triggerReason ? { triggerReason } : {}),
    ...(asFiniteNumber(record.preTokens) != null ? { preTokens: asFiniteNumber(record.preTokens)! } : {}),
    ...(summaryKind ? { summaryKind } : {}),
    ...(keepStrategy ? { keepStrategy } : {}),
    ...(rehydrationPlan ? { rehydrationPlan } : {}),
    ...(rehydrationCost ? { rehydrationCost } : {}),
    ...(preservedSegment ? { preservedSegment } : {}),
  }
}

export function areCompactBoundarySummariesEqual(
  left: CompactBoundarySummary | null | undefined,
  right: CompactBoundarySummary | null | undefined,
): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  const leftKeepMinTokens = left.keepStrategy?.kind === 'keep_combo' ? left.keepStrategy.keepMinTokens : null
  const rightKeepMinTokens = right.keepStrategy?.kind === 'keep_combo' ? right.keepStrategy.keepMinTokens : null
  const leftKeepMinUserTurns = left.keepStrategy?.kind === 'keep_combo' ? left.keepStrategy.keepMinUserTurns : null
  const rightKeepMinUserTurns = right.keepStrategy?.kind === 'keep_combo' ? right.keepStrategy.keepMinUserTurns : null
  return (
    left.schemaVersion === right.schemaVersion &&
    (left.trigger ?? null) === (right.trigger ?? null) &&
    (left.triggerReason?.kind ?? null) === (right.triggerReason?.kind ?? null) &&
    (left.triggerReason?.detail ?? null) === (right.triggerReason?.detail ?? null) &&
    (left.preTokens ?? null) === (right.preTokens ?? null) &&
    (left.summaryKind ?? null) === (right.summaryKind ?? null) &&
    (left.keepStrategy?.kind ?? null) === (right.keepStrategy?.kind ?? null) &&
    (left.keepStrategy?.keepLastTurns ?? null) === (right.keepStrategy?.keepLastTurns ?? null) &&
    leftKeepMinTokens === rightKeepMinTokens &&
    leftKeepMinUserTurns === rightKeepMinUserTurns &&
    (left.rehydrationCost?.sectionCount ?? null) === (right.rehydrationCost?.sectionCount ?? null) &&
    (left.rehydrationCost?.estimatedTokens ?? null) === (right.rehydrationCost?.estimatedTokens ?? null) &&
    JSON.stringify(left.rehydrationPlan?.items ?? null) === JSON.stringify(right.rehydrationPlan?.items ?? null) &&
    (left.preservedSegment?.continuationMessageCount ?? null) ===
      (right.preservedSegment?.continuationMessageCount ?? null) &&
    (left.preservedSegment?.preservedTailMessageCount ?? null) ===
      (right.preservedSegment?.preservedTailMessageCount ?? null) &&
    (left.preservedSegment?.summaryFingerprint ?? null) === (right.preservedSegment?.summaryFingerprint ?? null) &&
    (left.preservedSegment?.headFingerprint ?? null) === (right.preservedSegment?.headFingerprint ?? null) &&
    (left.preservedSegment?.tailFingerprint ?? null) === (right.preservedSegment?.tailFingerprint ?? null)
  )
}
