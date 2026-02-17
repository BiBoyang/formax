import type { Msg } from '../../../../components/tool/ToolMessage'
import type { TranscriptSegment } from '../../../semantics/transcriptProjection'
import { parseToolParamsText } from '../../../tools/presentation/paramsText'
import { formatDuration, formatTokenTotal, formatToolUses } from '../shared/utils'
import { formatToolResult } from '../../../../utils/toolFormatting'
import { parseBackgroundTaskId, parseTaskTranscript } from '../send/taskResult'

function decodeParamValue(value: string, valueType: 'string' | 'json'): unknown {
  if (valueType === 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function parseToolInputFromParamsText(paramsText: string | undefined): Record<string, unknown> {
  const parsed = parseToolParamsText(paramsText)
  if (parsed.length === 0) return {}
  const out: Record<string, unknown> = {}
  for (const entry of parsed) {
    out[entry.label] = decodeParamValue(entry.value, entry.valueType)
  }
  return out
}

function splitSummaryLines(summary: string): { firstLine: string; remainingLines: string[] } {
  const lines = String(summary ?? '').split(/\r?\n/)
  const firstLine = String(lines[0] ?? '')
  const remainingLines = lines.slice(1).map((line) => String(line ?? '')).filter((line) => line.length > 0)
  return { firstLine, remainingLines }
}

export function canonicalTurnSegmentsToMessages(args: {
  turnId: string
  segments: TranscriptSegment[]
  transientOnly?: boolean
  openAssistantSegmentId?: string
  includeAssistantStreaming?: boolean
  includeUserSystem?: boolean
}): Msg[] {
  const turnSegments = args.segments.filter((segment) => segment.turnId === args.turnId)
  if (turnSegments.length === 0) return []

  const mapped = turnSegments.map((segment): Msg | null => {
    if (segment.kind === 'user') {
      if (args.includeUserSystem === false) return null
      if (args.transientOnly) return null
      return {
        id: `canonical:${segment.id}`,
        role: 'user' as const,
        content: segment.text,
        timestamp: new Date(0),
        ...(segment.uiKind ? { ui: { kind: segment.uiKind } } : {}),
      }
    }

    if (segment.kind === 'system') {
      if (args.includeUserSystem === false) return null
      if (args.transientOnly) return null
      return {
        id: `canonical:${segment.id}`,
        role: segment.role,
        content: segment.text,
        timestamp: new Date(0),
        ...(segment.uiKind ? { ui: { kind: segment.uiKind } } : {}),
      }
    }

    if (segment.kind === 'assistant') {
      const allowAssistantStreaming = args.includeAssistantStreaming ?? true
      if (args.transientOnly && !allowAssistantStreaming) return null
      if (args.transientOnly && segment.id !== args.openAssistantSegmentId) return null
      return {
        id: `canonical:${segment.id}`,
        role: 'assistant' as const,
        content: segment.text,
        timestamp: new Date(0),
        ...(args.transientOnly ? { isStreaming: true } : {}),
      }
    }

    if (segment.kind === 'thinking') {
      if (args.transientOnly) return null
      return {
        id: `canonical:${segment.id}`,
        role: 'assistant' as const,
        ui: { kind: 'thinking_block' as const },
        content: segment.text,
        timestamp: new Date(0),
      }
    }

    if (segment.kind !== 'tool') return null
    if (args.transientOnly && segment.status !== 'running') return null
    const input = segment.input ?? parseToolInputFromParamsText(segment.paramsText)
    const rawResult = segment.result
    const isError = segment.status === 'error'
    const summaryParts = splitSummaryLines(segment.summary)
    const normalizedErrorSummary = summaryParts.firstLine.startsWith('Error: ')
      ? summaryParts.firstLine.slice('Error: '.length)
      : summaryParts.firstLine

    if (segment.toolName === 'Task') {
      const tokens = formatTokenTotal(segment.usage)
      const backgroundTaskId = parseBackgroundTaskId(rawResult ?? '')
      const summaryText =
        segment.status === 'running'
          ? summaryParts.firstLine || 'Task running'
          : isError
            ? normalizedErrorSummary || 'Error'
            : backgroundTaskId
                ? `Started (task_id: ${backgroundTaskId})`
                : `Done (${formatToolUses(segment.toolUses ?? 0)}${tokens ? ` · ${tokens} tokens` : ''} · ${formatDuration(
                  segment.durationMs ?? 0,
                )})`
      const transcriptLines = parseTaskTranscript(rawResult ?? '') ?? segment.transcriptLines ?? undefined
      return {
        id: `canonical:${segment.id}`,
        role: 'tool' as const,
        content: summaryText,
        timestamp: new Date(0),
        toolInfo: {
          name: segment.toolName,
          toolUseId: segment.toolUseId,
          input,
          status: segment.status,
          result: rawResult ?? segment.summary,
          ...(transcriptLines ? { transcriptLines } : {}),
          ...(segment.nestedTools ? { nestedTools: segment.nestedTools } : {}),
          ...(segment.toolUses !== undefined ? { toolUses: segment.toolUses } : {}),
          ...(segment.usage ? { usage: segment.usage } : {}),
          ...(segment.durationMs !== undefined ? { durationMs: segment.durationMs } : {}),
          ...(segment.middleLines ? { middleLines: segment.middleLines } : {}),
          ...(segment.expandInfo ? { expandInfo: segment.expandInfo } : {}),
        },
      }
    }

    const displayResult =
      isError && typeof rawResult === 'string' && rawResult.startsWith('Error: ')
        ? rawResult.slice('Error: '.length)
        : rawResult
    const formatted = typeof displayResult === 'string' ? formatToolResult(segment.toolName, displayResult, isError) : null
    const firstLine = formatted?.summary ?? summaryParts.firstLine
    const middleLines =
      segment.middleLines ??
      formatted?.middleLines ??
      (segment.detailLines.length > 0 ? segment.detailLines : summaryParts.remainingLines)
    const resultLines = (formatted?.lines ?? segment.resultLines ?? [firstLine, ...middleLines].join('\n').split(/\r?\n/).length)
    const hideSummaryContent = Boolean(
      segment.hideSummaryContent ?? (segment.toolName === 'Skill' && segment.status === 'completed' && !isError),
    )
    const content = hideSummaryContent ? '' : firstLine
    const patchStartLineNumber = segment.patchStartLineNumber ?? null

    return {
      id: `canonical:${segment.id}`,
      role: 'tool' as const,
      content,
      timestamp: new Date(0),
      toolInfo: {
        name: segment.toolName,
        toolUseId: segment.toolUseId,
        input,
        status: segment.status,
        result: rawResult ?? [firstLine, ...middleLines].filter((line) => line.length > 0).join('\n'),
        middleLines,
        ...(formatted?.expandInfo || segment.expandInfo ? { expandInfo: segment.expandInfo ?? formatted?.expandInfo } : {}),
        ...(resultLines !== undefined ? { resultLines } : {}),
        ...(segment.transcriptLines ? { transcriptLines: segment.transcriptLines } : {}),
        ...(segment.nestedTools ? { nestedTools: segment.nestedTools } : {}),
        ...(segment.toolUses !== undefined ? { toolUses: segment.toolUses } : {}),
        ...(segment.usage ? { usage: segment.usage } : {}),
        ...(segment.durationMs !== undefined ? { durationMs: segment.durationMs } : {}),
        ...(patchStartLineNumber !== null ? { patchStartLineNumber } : {}),
      },
    }
  })

  return mapped.filter((message): message is Msg => message !== null)
}

export function tailSegmentsForTurn(segments: TranscriptSegment[], turnId: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  let seenTurn = false

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (!segment) continue
    if (segment.turnId === turnId) {
      out.push(segment)
      seenTurn = true
      continue
    }
    if (seenTurn) break
  }

  return out.reverse()
}

export type CanonicalTurnOutcome = 'completed' | 'aborted' | 'failed'

export function resolveCanonicalTurnTailInsertIndex(args: {
  tail: Msg[]
  turnOutcome: CanonicalTurnOutcome
  isFailureSubline: (message: Msg | undefined) => boolean
}): number {
  if (args.turnOutcome === 'aborted') {
    const firstToolIndex = args.tail.findIndex((message) => message.role === 'tool')
    if (firstToolIndex >= 0) return firstToolIndex
  }

  if (args.turnOutcome === 'failed') {
    let insertAtTail = args.tail.length
    while (insertAtTail > 0) {
      const maybeSubline = args.tail[insertAtTail - 1]
      if (args.isFailureSubline(maybeSubline)) {
        insertAtTail -= 1
        continue
      }
      break
    }
    return insertAtTail
  }

  return args.tail.length
}

export function computeCanonicalTurnAppend(args: {
  turnOutcome: CanonicalTurnOutcome
  canonicalFinalMessages: Msg[]
}): {
  canonicalRowsForAppend: Msg[]
  shouldAppendCanonicalFinal: boolean
} {
  const canonicalRowsForAppend =
    args.turnOutcome === 'aborted'
      ? args.canonicalFinalMessages.filter((message) => message.role !== 'tool')
      : args.canonicalFinalMessages
  const hasStableCanonicalOutput = canonicalRowsForAppend.some((message) => {
    if (message.role === 'assistant' && message.ui?.kind !== 'thinking_block') {
      return String(message.content || '').trim().length > 0
    }
    return false
  })
  const shouldAppendCanonicalFinal = args.turnOutcome !== 'aborted' || hasStableCanonicalOutput
  return {
    canonicalRowsForAppend,
    shouldAppendCanonicalFinal,
  }
}

export function mergeCanonicalTurnIntoMessages(args: {
  messages: Msg[]
  userMessageId: string
  canonicalRowsForAppend: Msg[]
  turnOutcome: CanonicalTurnOutcome
  isFailureSubline: (message: Msg | undefined) => boolean
}): Msg[] {
  if (!args.userMessageId || args.canonicalRowsForAppend.length === 0) return args.messages
  const userIndex = args.messages.findIndex((message) => message.id === args.userMessageId)
  if (userIndex < 0) return args.messages

  const head = args.messages.slice(0, userIndex + 1)
  const tail = args.messages.slice(userIndex + 1)
  const legacyToolByUseId = new Map<string, Msg>()
  for (const message of tail) {
    if (message.role !== 'tool') continue
    const toolUseId = String(message.toolInfo?.toolUseId || '').trim()
    if (!toolUseId) continue
    legacyToolByUseId.set(toolUseId, message)
  }

  const canonicalToolUseIds = new Set(
    args.canonicalRowsForAppend
      .filter((message) => message.role === 'tool')
      .map((message) => String(message.toolInfo?.toolUseId || '').trim())
      .filter((id) => id.length > 0),
  )

  const canonicalRows = args.canonicalRowsForAppend.map((message) => {
    const baseMessage: Msg = {
      ...message,
      isStreaming: false,
      timestamp: message.timestamp,
    }
    if (baseMessage.role !== 'tool') return baseMessage
    const toolUseId = String(baseMessage.toolInfo?.toolUseId || '').trim()
    if (!toolUseId) return baseMessage
    const legacyTool = legacyToolByUseId.get(toolUseId)
    const canonicalToolInfo = baseMessage.toolInfo
    return {
      ...baseMessage,
      id: legacyTool?.id ?? baseMessage.id,
      timestamp: legacyTool?.timestamp ?? baseMessage.timestamp,
      content: legacyTool?.content || baseMessage.content,
      isStreaming: false,
      ...(canonicalToolInfo ? { toolInfo: canonicalToolInfo } : {}),
    }
  })

  const isReplacedLegacyRow = (message: Msg): boolean => {
    if (message.role !== 'tool') return false
    const toolUseId = String(message.toolInfo?.toolUseId || '').trim()
    if (!toolUseId) return false
    return canonicalToolUseIds.has(toolUseId)
  }

  const mergedTail: Msg[] = []
  for (const message of tail) {
    if (isReplacedLegacyRow(message)) continue
    mergedTail.push(message)
  }
  const insertAtTail = resolveCanonicalTurnTailInsertIndex({
    tail: mergedTail,
    turnOutcome: args.turnOutcome,
    isFailureSubline: args.isFailureSubline,
  })

  const anchorBefore = insertAtTail > 0 ? mergedTail[insertAtTail - 1] : head[head.length - 1]
  const anchorBeforeTs = anchorBefore?.timestamp instanceof Date ? anchorBefore.timestamp.getTime() : Date.now() - 1
  let canonicalTsCursor = anchorBeforeTs
  const datedCanonicalRows = canonicalRows.map((message) => {
    if (message.role === 'tool') {
      const rawTs = message.timestamp instanceof Date ? message.timestamp.getTime() : Number.NaN
      if (Number.isFinite(rawTs) && rawTs > anchorBeforeTs) {
        canonicalTsCursor = Math.max(canonicalTsCursor, rawTs)
        return message
      }
      canonicalTsCursor += 1
      return { ...message, timestamp: new Date(canonicalTsCursor) }
    }
    canonicalTsCursor += 1
    return { ...message, timestamp: new Date(canonicalTsCursor) }
  })

  const mergedMessages = [
    ...head,
    ...mergedTail.slice(0, insertAtTail),
    ...datedCanonicalRows,
    ...mergedTail.slice(insertAtTail),
  ]
  let lastTs =
    head.length > 0 && head[head.length - 1]?.timestamp instanceof Date ? head[head.length - 1]!.timestamp.getTime() : 1
  const normalizedMessages = mergedMessages.map((message, index) => {
    if (index <= userIndex) {
      const raw = message.timestamp instanceof Date ? message.timestamp.getTime() : lastTs
      lastTs = Math.max(lastTs, raw)
      return message
    }
    if (message.role === 'tool') {
      const raw = message.timestamp instanceof Date ? message.timestamp.getTime() : lastTs
      lastTs = Math.max(lastTs, raw)
      return message
    }
    const raw = message.timestamp instanceof Date ? message.timestamp.getTime() : lastTs + 1
    const normalized = Math.max(lastTs + 1, raw)
    lastTs = normalized
    if (message.timestamp instanceof Date && message.timestamp.getTime() === normalized) return message
    return { ...message, timestamp: new Date(normalized) }
  })
  assertNoDuplicateToolUseIdsInTurn({ messages: normalizedMessages, userIndex })
  return normalizedMessages
}

export function appendCanonicalTurnFinalRows(args: {
  messages: Msg[]
  userMessageId: string | null
  turnId: string
  turnOutcome: CanonicalTurnOutcome
  projectionSegments: TranscriptSegment[]
  isFailureSubline: (message: Msg | undefined) => boolean
}): Msg[] {
  if (!args.userMessageId) return args.messages

  const turnSegments = tailSegmentsForTurn(args.projectionSegments, args.turnId)
  const canonicalFinalMessages = canonicalTurnSegmentsToMessages({
    turnId: args.turnId,
    segments: turnSegments,
    includeUserSystem: false,
  })
  const { canonicalRowsForAppend, shouldAppendCanonicalFinal } = computeCanonicalTurnAppend({
    turnOutcome: args.turnOutcome,
    canonicalFinalMessages,
  })
  if (!shouldAppendCanonicalFinal || canonicalRowsForAppend.length === 0) {
    return args.messages
  }

  return mergeCanonicalTurnIntoMessages({
    messages: args.messages,
    userMessageId: args.userMessageId,
    canonicalRowsForAppend,
    turnOutcome: args.turnOutcome,
    isFailureSubline: args.isFailureSubline,
  })
}

export function assertNoDuplicateToolUseIdsInTurn(args: {
  messages: Msg[]
  userIndex: number
}): void {
  if (process.env.NODE_ENV === 'production') return

  const seenToolUseIds = new Set<string>()
  const duplicatedToolUseIds: string[] = []
  for (let index = args.userIndex + 1; index < args.messages.length; index += 1) {
    const message = args.messages[index]
    if (!message) continue
    if (message.role === 'user') break
    if (message.role !== 'tool') continue
    const toolUseId = String(message.toolInfo?.toolUseId || '').trim()
    if (!toolUseId) continue
    if (seenToolUseIds.has(toolUseId)) duplicatedToolUseIds.push(toolUseId)
    else seenToolUseIds.add(toolUseId)
  }

  if (duplicatedToolUseIds.length === 0) return

  throw new Error(
    `Invariant violation: duplicate tool rows in one turn (${Array.from(new Set(duplicatedToolUseIds)).join(', ')})`,
  )
}

export function replaceTurnTailWithCanonicalMessages(args: {
  messages: Msg[]
  userMessageId: string
  canonicalTurnMessages: Msg[]
}): Msg[] {
  if (!args.userMessageId || args.canonicalTurnMessages.length === 0) return args.messages
  const userIndex = args.messages.findIndex((message) => message.id === args.userMessageId)
  if (userIndex < 0) return args.messages

  const head = args.messages.slice(0, userIndex + 1)
  const tail = args.messages.slice(userIndex + 1)
  const usedTailIndexes = new Set<number>()

  const isAuxiliaryAssistantMessage = (message: Msg): boolean =>
    message.role === 'assistant' &&
    (message.ui?.kind === 'command_subline' ||
      message.ui?.kind === 'compact_boundary' ||
      message.ui?.kind === 'compact_banner')
  const normalizeAssistantText = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim()
  const matchesCanonicalAssistantMessage = (message: Msg, canonicalMessage: Msg): boolean => {
    const canonicalText = normalizeAssistantText(canonicalMessage.content)
    if (!canonicalText) return false
    return normalizeAssistantText(message.content) === canonicalText
  }
  const shouldKeepLeftoverMessage = (message: Msg): boolean =>
    !(message.role === 'tool') && (message.role !== 'assistant' || isAuxiliaryAssistantMessage(message))

  const takeTailMessage = (predicate: (message: Msg) => boolean): Msg | null => {
    for (let index = 0; index < tail.length; index += 1) {
      if (usedTailIndexes.has(index)) continue
      const candidate = tail[index]
      if (!candidate || !predicate(candidate)) continue
      usedTailIndexes.add(index)
      return candidate
    }
    return null
  }

  const reorderedTail: Msg[] = []
  for (const canonicalMessage of args.canonicalTurnMessages) {
    if (canonicalMessage.role === 'tool') {
      const toolUseId = canonicalMessage.toolInfo?.toolUseId
      const legacyTool =
        toolUseId && toolUseId.length > 0
          ? takeTailMessage((message) => message.role === 'tool' && message.toolInfo?.toolUseId === toolUseId)
          : null
      reorderedTail.push(mergeCanonicalToolMessage(canonicalMessage, legacyTool))
      continue
    }

    if (canonicalMessage.role === 'assistant' && canonicalMessage.ui?.kind === 'thinking_block') {
      const legacyThinking = takeTailMessage(
        (message) => message.role === 'assistant' && message.ui?.kind === 'thinking_block',
      )
      reorderedTail.push(mergeCanonicalAssistantMessage(canonicalMessage, legacyThinking))
      continue
    }

    const legacyAssistant = takeTailMessage(
      (message) =>
        message.role === 'assistant' &&
        message.ui?.kind !== 'thinking_block' &&
        message.ui?.kind !== 'command_subline' &&
        message.ui?.kind !== 'compact_boundary' &&
        message.ui?.kind !== 'compact_banner' &&
        matchesCanonicalAssistantMessage(message, canonicalMessage),
    )
    reorderedTail.push(mergeCanonicalAssistantMessage(canonicalMessage, legacyAssistant))
  }

  if (usedTailIndexes.size === 0) {
    const auxiliaryTail = tail.filter((message) => shouldKeepLeftoverMessage(message))
    return normalizeTailTimestamps([...head, ...auxiliaryTail, ...reorderedTail], userIndex)
  }

  const firstConsumedIndex = Math.min(...Array.from(usedTailIndexes))
  const leftoverPrefix = tail
    .slice(0, firstConsumedIndex)
    .filter((message, index) => !usedTailIndexes.has(index) && shouldKeepLeftoverMessage(message))
  const leftoverSuffix = tail
    .slice(firstConsumedIndex)
    .filter(
      (message, offset) =>
        !usedTailIndexes.has(firstConsumedIndex + offset) && shouldKeepLeftoverMessage(message),
    )
  return normalizeTailTimestamps([...head, ...leftoverPrefix, ...reorderedTail, ...leftoverSuffix], userIndex)
}

function mergeCanonicalAssistantMessage(canonical: Msg, legacy: Msg | null): Msg {
  if (!legacy) return { ...canonical, isStreaming: false }
  const legacyUiKind = legacy.ui?.kind
  const canonicalUiKind = canonical.ui?.kind
  const nextContent = canonical.content ?? legacy.content
  // Avoid rewriting stable assistant rows; Ink Static is append-only and would duplicate lines.
  if (!legacy.isStreaming && nextContent === legacy.content && legacyUiKind === canonicalUiKind) {
    return legacy
  }
  return {
    ...legacy,
    ...canonical,
    id: legacy.id,
    timestamp: legacy.timestamp,
    content: nextContent,
    isStreaming: false,
  }
}

function mergeCanonicalToolMessage(canonical: Msg, legacy: Msg | null): Msg {
  if (!legacy) return { ...canonical }
  // Keep completed/error legacy tool rows immutable in TUI.
  // Rewriting static rows causes duplicate append artifacts in Ink <Static>.
  if (legacy.toolInfo?.status === 'completed' || legacy.toolInfo?.status === 'error') {
    return legacy
  }
  const canonicalToolInfo = canonical.toolInfo ?? undefined
  const legacyToolInfo = legacy.toolInfo ?? undefined
  const canonicalInput = canonicalToolInfo?.input
  const canonicalInputHasKeys =
    canonicalInput && typeof canonicalInput === 'object' && Object.keys(canonicalInput).length > 0
  const mergedName = canonicalToolInfo?.name ?? legacyToolInfo?.name
  const mergedStatus = canonicalToolInfo?.status ?? legacyToolInfo?.status
  const mergedToolInfo =
    mergedName && mergedStatus
      ? {
          ...(legacyToolInfo ?? {}),
          ...(canonicalToolInfo ?? {}),
          name: mergedName,
          status: mergedStatus,
          input: canonicalInputHasKeys ? canonicalInput : legacyToolInfo?.input ?? canonicalInput ?? {},
          result: legacyToolInfo?.result ?? canonicalToolInfo?.result,
          middleLines: legacyToolInfo?.middleLines ?? canonicalToolInfo?.middleLines,
          expandInfo: legacyToolInfo?.expandInfo ?? canonicalToolInfo?.expandInfo,
          resultLines: legacyToolInfo?.resultLines ?? canonicalToolInfo?.resultLines,
          transcriptLines: legacyToolInfo?.transcriptLines ?? canonicalToolInfo?.transcriptLines,
          nestedTools: legacyToolInfo?.nestedTools ?? canonicalToolInfo?.nestedTools,
          toolUses: legacyToolInfo?.toolUses ?? canonicalToolInfo?.toolUses,
          usage: legacyToolInfo?.usage ?? canonicalToolInfo?.usage,
          durationMs: legacyToolInfo?.durationMs ?? canonicalToolInfo?.durationMs,
          patchStartLineNumber: legacyToolInfo?.patchStartLineNumber ?? canonicalToolInfo?.patchStartLineNumber,
        }
      : undefined
  return {
    ...legacy,
    ...canonical,
    id: legacy.id,
    timestamp: legacy.timestamp,
    content: legacy.content ?? canonical.content,
    ...(mergedToolInfo ? { toolInfo: mergedToolInfo } : {}),
  }
}

function normalizeTailTimestamps(messages: Msg[], anchorIndex: number): Msg[] {
  let lastTimestamp = 1
  return messages.map((message, index) => {
    const rawTimestamp = message.timestamp instanceof Date ? message.timestamp.getTime() : lastTimestamp
    if (index <= anchorIndex) {
      lastTimestamp = Math.max(lastTimestamp, rawTimestamp)
      return message
    }

    const normalizedTimestamp = Math.max(lastTimestamp, rawTimestamp, 1)
    lastTimestamp = normalizedTimestamp
    if (rawTimestamp === normalizedTimestamp) return message
    return { ...message, timestamp: new Date(normalizedTimestamp) }
  })
}
