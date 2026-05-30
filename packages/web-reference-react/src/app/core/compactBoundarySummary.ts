import type { CompactBoundarySummary, CompactPreservedMessageIdentity } from '../../types'

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

function parseOptionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) return undefined
    out.push(item)
  }
  return out
}

function parsePreservedMessageIdentity(value: unknown): CompactPreservedMessageIdentity | undefined {
  const record = asOptionalRecord(value)
  if (!record || record.schemaVersion !== 1) return undefined
  const source = record.source === 'explicit' || record.source === 'legacy_fallback' ? record.source : null
  if (
    typeof record.id !== 'string' ||
    !record.id.trim() ||
    !(record.parentId === null || typeof record.parentId === 'string') ||
    typeof record.fingerprint !== 'string' ||
    !record.fingerprint.trim() ||
    !source
  ) {
    return undefined
  }
  return {
    schemaVersion: 1,
    id: record.id,
    parentId: record.parentId,
    fingerprint: record.fingerprint,
    source,
  }
}

function parseOptionalIdentityArray(value: unknown): CompactPreservedMessageIdentity[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  const out: CompactPreservedMessageIdentity[] = []
  for (const item of value) {
    const parsed = parsePreservedMessageIdentity(item)
    if (!parsed) return undefined
    out.push(parsed)
  }
  return out
}

function parseOptionalNullableIdentity(value: unknown): CompactPreservedMessageIdentity | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return parsePreservedMessageIdentity(value)
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
  const messageFingerprints = parseOptionalStringArray(record.messageFingerprints)
  if (record.messageFingerprints !== undefined && !messageFingerprints) return undefined
  const messageIdentities = parseOptionalIdentityArray(record.messageIdentities)
  const summaryIdentity =
    record.summaryIdentity === undefined || record.summaryIdentity === null
      ? undefined
      : parsePreservedMessageIdentity(record.summaryIdentity)
  const headIdentity = parseOptionalNullableIdentity(record.headIdentity)
  const anchorIdentity = parseOptionalNullableIdentity(record.anchorIdentity)
  const tailIdentity = parseOptionalNullableIdentity(record.tailIdentity)
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
    ...(messageFingerprints ? { messageFingerprints } : {}),
    ...(messageIdentities ? { messageIdentities } : {}),
    ...(summaryIdentity ? { summaryIdentity } : {}),
    ...(headIdentity !== undefined ? { headIdentity } : {}),
    ...(anchorIdentity !== undefined ? { anchorIdentity } : {}),
    ...(tailIdentity !== undefined ? { tailIdentity } : {}),
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
    ...(typeof record.boundaryFingerprint === 'string' && record.boundaryFingerprint.trim()
      ? { boundaryFingerprint: record.boundaryFingerprint }
      : {}),
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
    (left.boundaryFingerprint ?? null) === (right.boundaryFingerprint ?? null) &&
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
    (left.preservedSegment?.tailFingerprint ?? null) === (right.preservedSegment?.tailFingerprint ?? null) &&
    JSON.stringify(left.preservedSegment?.messageFingerprints ?? null) ===
      JSON.stringify(right.preservedSegment?.messageFingerprints ?? null) &&
    JSON.stringify(left.preservedSegment?.messageIdentities ?? null) ===
      JSON.stringify(right.preservedSegment?.messageIdentities ?? null) &&
    JSON.stringify(left.preservedSegment?.summaryIdentity ?? null) ===
      JSON.stringify(right.preservedSegment?.summaryIdentity ?? null) &&
    JSON.stringify(left.preservedSegment?.headIdentity ?? null) ===
      JSON.stringify(right.preservedSegment?.headIdentity ?? null) &&
    JSON.stringify(left.preservedSegment?.anchorIdentity ?? null) ===
      JSON.stringify(right.preservedSegment?.anchorIdentity ?? null) &&
    JSON.stringify(left.preservedSegment?.tailIdentity ?? null) ===
      JSON.stringify(right.preservedSegment?.tailIdentity ?? null)
  )
}

export function isSameCompactBoundaryGenerationForCache(left: CompactBoundarySummary, right: CompactBoundarySummary): boolean {
  if (left.boundaryFingerprint && right.boundaryFingerprint) {
    return left.boundaryFingerprint === right.boundaryFingerprint
  }
  return false
}

export function mergeCompactBoundarySummaryForCache(
  current: CompactBoundarySummary | null | undefined,
  incoming: CompactBoundarySummary | null,
): CompactBoundarySummary | null {
  if (!incoming || !current || !isSameCompactBoundaryGenerationForCache(current, incoming)) return incoming
  const preservedSegment = mergePreservedSegmentForCache(current.preservedSegment, incoming.preservedSegment)
  return {
    ...incoming,
    ...(incoming.boundaryFingerprint === undefined && current.boundaryFingerprint ? { boundaryFingerprint: current.boundaryFingerprint } : {}),
    ...(incoming.trigger === undefined && current.trigger ? { trigger: current.trigger } : {}),
    ...(incoming.triggerReason === undefined && current.triggerReason ? { triggerReason: current.triggerReason } : {}),
    ...(incoming.preTokens === undefined && current.preTokens !== undefined ? { preTokens: current.preTokens } : {}),
    ...(incoming.summaryKind === undefined && current.summaryKind ? { summaryKind: current.summaryKind } : {}),
    ...(incoming.keepStrategy === undefined && current.keepStrategy ? { keepStrategy: current.keepStrategy } : {}),
    ...(incoming.rehydrationPlan === undefined && current.rehydrationPlan ? { rehydrationPlan: current.rehydrationPlan } : {}),
    ...(incoming.rehydrationCost === undefined && current.rehydrationCost ? { rehydrationCost: current.rehydrationCost } : {}),
    ...(preservedSegment ? { preservedSegment } : {}),
  }
}

function mergePreservedSegmentForCache(
  current: CompactBoundarySummary['preservedSegment'] | undefined,
  incoming: CompactBoundarySummary['preservedSegment'] | undefined,
): CompactBoundarySummary['preservedSegment'] | undefined {
  if (!incoming) return current
  if (!current || !isSamePreservedSegmentCore(current, incoming)) return incoming
  return {
    ...incoming,
    ...(incoming.messageFingerprints === undefined && current.messageFingerprints ? { messageFingerprints: current.messageFingerprints } : {}),
    ...(incoming.messageIdentities === undefined && current.messageIdentities ? { messageIdentities: current.messageIdentities } : {}),
    ...(incoming.summaryIdentity === undefined && current.summaryIdentity ? { summaryIdentity: current.summaryIdentity } : {}),
    ...(incoming.headIdentity === undefined && current.headIdentity !== undefined ? { headIdentity: current.headIdentity } : {}),
    ...(incoming.anchorIdentity === undefined && current.anchorIdentity !== undefined ? { anchorIdentity: current.anchorIdentity } : {}),
    ...(incoming.tailIdentity === undefined && current.tailIdentity !== undefined ? { tailIdentity: current.tailIdentity } : {}),
  }
}

function isSamePreservedSegmentCore(
  left: NonNullable<CompactBoundarySummary['preservedSegment']>,
  right: NonNullable<CompactBoundarySummary['preservedSegment']>,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.continuationMessageCount === right.continuationMessageCount &&
    left.preservedTailMessageCount === right.preservedTailMessageCount &&
    left.summaryFingerprint === right.summaryFingerprint &&
    left.headFingerprint === right.headFingerprint &&
    left.tailFingerprint === right.tailFingerprint
  )
}
