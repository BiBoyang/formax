import type { Msg } from '../../../../shared/toolMessageTypes'

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '"[unserializable]"'
  }
}

function areToolInfosEqual(a: Msg['toolInfo'] | undefined, b: Msg['toolInfo'] | undefined): boolean {
  if (!a || !b) return false
  if (a.name !== b.name) return false
  if (a.toolUseId !== b.toolUseId) return false
  if (a.status !== b.status) return false
  if (a.result !== b.result) return false

  if (safeJson(a.input) !== safeJson(b.input)) return false
  if (safeJson(a.middleLines) !== safeJson(b.middleLines)) return false
  if (safeJson(a.transcriptLines) !== safeJson(b.transcriptLines)) return false
  if (safeJson(a.nestedTools) !== safeJson(b.nestedTools)) return false
  if (a.toolUses !== b.toolUses) return false
  if (safeJson(a.usage) !== safeJson(b.usage)) return false
  if (a.durationMs !== b.durationMs) return false
  if (a.patchStartLineNumber !== b.patchStartLineNumber) return false
  if (safeJson(a.expandInfo) !== safeJson(b.expandInfo)) return false
  return true
}

function shouldKeepExistingStaticRow(existing: Msg | undefined, incoming: Msg): boolean {
  if (!existing) return false
  if (existing.surfaceOwner !== 'static' || incoming.surfaceOwner !== 'static') return false
  if (existing.id !== incoming.id) return false

  if (existing.role === incoming.role) {
    const existingUiKind = existing.ui?.kind ?? null
    const incomingUiKind = incoming.ui?.kind ?? null
    if (existing.role === 'tool') {
      return (
        existingUiKind === incomingUiKind &&
        existing.content === incoming.content &&
        !existing.isStreaming &&
        areToolInfosEqual(existing.toolInfo, incoming.toolInfo)
      )
    }

    if (existingUiKind === incomingUiKind && existing.content === incoming.content && !existing.isStreaming) {
      return true
    }
  }

  return false
}

function mergeProjectedStaticRows(args: {
  prev: Msg[]
  projectedStaticRows: Msg[]
  onNonAppendUpdate?: () => void
}): Msg[] {
  if (args.projectedStaticRows.length === 0) return args.prev
  const indexById = new Map<string, number>()
  for (let index = 0; index < args.prev.length; index += 1) {
    const message = args.prev[index]
    if (!message) continue
    indexById.set(message.id, index)
  }

  let next: Msg[] | null = null
  let didChange = false
  let timestampCursor: number | null = null

  const ensureNext = (): Msg[] => {
    if (next) return next
    next = [...args.prev]
    return next
  }

  const ensureTimestampCursor = (): number => {
    if (timestampCursor !== null) return timestampCursor
    const source = args.prev
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const message = source[index]
      if (!message) continue
      const ts = message.timestamp
      if (ts instanceof Date) {
        timestampCursor = ts.getTime()
        return timestampCursor
      }
    }
    timestampCursor = Date.now()
    return timestampCursor
  }

  for (const projectedRow of args.projectedStaticRows) {
    const existingIndex = indexById.get(projectedRow.id)
    if (existingIndex === undefined) {
      const list = ensureNext()
      indexById.set(projectedRow.id, list.length)
      let incoming: Msg = {
        ...projectedRow,
        surfaceOwner: 'static',
        isStreaming: false,
      }
      const cursor = ensureTimestampCursor()
      const raw = incoming.timestamp instanceof Date ? incoming.timestamp.getTime() : Number.NaN
      if (Number.isFinite(raw) && raw > cursor) {
        timestampCursor = raw
      } else {
        timestampCursor = cursor + 1
        incoming = { ...incoming, timestamp: new Date(timestampCursor) }
      }
      list.push(incoming)
      didChange = true
      continue
    }

    const source = next ?? args.prev
    const existing = source[existingIndex]
    if (shouldKeepExistingStaticRow(existing, projectedRow)) continue

    const list = ensureNext()
    list[existingIndex] = {
      ...projectedRow,
      surfaceOwner: 'static',
      isStreaming: false,
      timestamp: existing.timestamp,
    }
    args.onNonAppendUpdate?.()
    didChange = true
  }

  if (!didChange) return args.prev
  return next as Msg[]
}

export {
  safeJson,
  areToolInfosEqual,
  shouldKeepExistingStaticRow,
  mergeProjectedStaticRows,
}

