import { truncateUtf8WithMarker } from './truncate'
import type { HistoryStateRecord, SessionEventRecord, SessionRecord, UiMsgRecord } from './records'
import type { ChatHistory, Msg } from './types'

function safeStringify(record: SessionRecord): string {
  return JSON.stringify(record)
}

function cloneMsgForPersistence(msg: Msg): Msg {
  // Avoid mutating live UI state when we truncate oversized records for persistence.
  const toolInfo = msg.toolInfo
    ? {
        ...msg.toolInfo,
        ...(msg.toolInfo.nestedTools
          ? { nestedTools: msg.toolInfo.nestedTools.map((t) => ({ ...t })) }
          : {}),
      }
    : undefined
  return { ...msg, ...(toolInfo ? { toolInfo } : {}) }
}

function cloneHistoryForPersistence(history: ChatHistory): ChatHistory {
  return history.map((msg: any) => {
    if (!msg || typeof msg !== 'object') return msg
    const content = msg.content
    if (!Array.isArray(content)) return { ...msg }
    return { ...msg, content: content.map((b: any) => (b && typeof b === 'object' ? { ...b } : b)) }
  }) as any
}

function truncateMsgInPlace(args: { msg: Msg; maxContentBytes: number }): boolean {
  let didTruncate = false

  if (typeof args.msg.content === 'string') {
    const res = truncateUtf8WithMarker(args.msg.content, args.maxContentBytes)
    if (res.truncated) didTruncate = true
    args.msg.content = res.text
  }

  if (args.msg.role === 'tool' && args.msg.toolInfo) {
    if (typeof args.msg.toolInfo.result === 'string') {
      const res = truncateUtf8WithMarker(args.msg.toolInfo.result, args.maxContentBytes)
      if (res.truncated) didTruncate = true
      args.msg.toolInfo.result = res.text
    }
  }

  return didTruncate
}

function truncateHistoryInPlace(args: { history: ChatHistory; maxTextBytes: number }): boolean {
  let didTruncate = false
  for (const msg of args.history as any[]) {
    if (!msg || typeof msg !== 'object') continue
    if (!Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (!block || typeof block !== 'object') continue
      if ((block as any).type !== 'text') continue
      if (typeof (block as any).text !== 'string') continue
      const res = truncateUtf8WithMarker((block as any).text, args.maxTextBytes)
      if (res.truncated) didTruncate = true
      ;(block as any).text = res.text
    }
  }
  return didTruncate
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function truncateTextValue(value: unknown, maxBytes: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return truncateUtf8WithMarker(value, maxBytes).text
}

function compactInputObjectForEvent(args: {
  input: Record<string, unknown>
  maxEntries: number
  maxStringBytes: number
}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let count = 0
  for (const [rawKey, rawValue] of Object.entries(args.input)) {
    if (count >= args.maxEntries) break
    const key = truncateUtf8WithMarker(String(rawKey), 96).text
    if (!key) continue
    if (typeof rawValue === 'string') {
      out[key] = truncateUtf8WithMarker(rawValue, args.maxStringBytes).text
      count += 1
      continue
    }
    if (typeof rawValue === 'number' || typeof rawValue === 'boolean' || rawValue === null) {
      out[key] = rawValue
      count += 1
      continue
    }
    if (Array.isArray(rawValue) || (rawValue && typeof rawValue === 'object')) {
      out[key] = truncateUtf8WithMarker(JSON.stringify(rawValue), args.maxStringBytes).text
      count += 1
      continue
    }
  }
  return out
}

function sanitizeAppToolEventData(args: {
  data: Record<string, unknown>
  maxStringBytes: number
  maxLineBytes: number
  maxLines: number
  dropInput: boolean
}): Record<string, unknown> {
  const next: Record<string, unknown> = { ...args.data }

  const longStringKeys = ['threadId', 'turnId', 'toolUseId', 'toolName', 'phase', 'status', 'summary', 'paramsText', 'line']
  for (const key of longStringKeys) {
    const value = truncateTextValue(next[key], args.maxStringBytes)
    if (value !== undefined) next[key] = value
  }

  if (Array.isArray(next.lines)) {
    const lines = next.lines
      .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
      .slice(0, args.maxLines)
      .map((line) => truncateUtf8WithMarker(line, args.maxLineBytes).text)
    if (lines.length > 0) next.lines = lines
    else delete next.lines
  }

  if (args.dropInput) {
    delete next.input
  } else if (isPlainObject(next.input)) {
    next.input = compactInputObjectForEvent({
      input: next.input,
      maxEntries: 24,
      maxStringBytes: args.maxStringBytes,
    })
  } else {
    delete next.input
  }

  if (typeof next.patchStartLineNumber === 'number' && Number.isFinite(next.patchStartLineNumber)) {
    next.patchStartLineNumber = Math.max(1, Math.floor(next.patchStartLineNumber))
  } else {
    delete next.patchStartLineNumber
  }

  return next
}

function buildEssentialAppToolEventData(data: Record<string, unknown>, maxStringBytes: number): Record<string, unknown> {
  const phaseRaw = truncateTextValue(data.phase, 24)
  const phase = phaseRaw === 'start' || phaseRaw === 'update' || phaseRaw === 'end' ? phaseRaw : 'update'
  const statusRaw = truncateTextValue(data.status, 16)
  const status =
    statusRaw === 'running' || statusRaw === 'completed' || statusRaw === 'error' ? statusRaw : undefined
  const summaryFromData = truncateTextValue(data.summary, maxStringBytes)
  const summary =
    summaryFromData ??
    (phase === 'start' ? 'Tool running' : phase === 'end' ? (status === 'error' ? 'Tool failed' : 'Tool completed') : undefined)

  return {
    ...(truncateTextValue(data.threadId, 96) ? { threadId: truncateTextValue(data.threadId, 96) } : {}),
    ...(truncateTextValue(data.turnId, 96) ? { turnId: truncateTextValue(data.turnId, 96) } : {}),
    ...(truncateTextValue(data.toolUseId, 96) ? { toolUseId: truncateTextValue(data.toolUseId, 96) } : {}),
    ...(truncateTextValue(data.toolName, 80) ? { toolName: truncateTextValue(data.toolName, 80) } : {}),
    phase,
    ...(status ? { status } : {}),
    ...(summary ? { summary } : {}),
    ...(truncateTextValue(data.line, maxStringBytes) ? { line: truncateTextValue(data.line, maxStringBytes) } : {}),
  }
}

function buildAppToolEventTrimCandidates(args: {
  record: SessionEventRecord
  maxLineBytes: number
}): SessionEventRecord[] {
  if (!isPlainObject(args.record.data)) return []

  const medium = sanitizeAppToolEventData({
    data: args.record.data,
    maxStringBytes: Math.max(160, Math.floor(args.maxLineBytes * 0.08)),
    maxLineBytes: Math.max(160, Math.floor(args.maxLineBytes * 0.08)),
    maxLines: 24,
    dropInput: false,
  })
  const aggressive = sanitizeAppToolEventData({
    data: args.record.data,
    maxStringBytes: Math.max(96, Math.floor(args.maxLineBytes * 0.05)),
    maxLineBytes: Math.max(96, Math.floor(args.maxLineBytes * 0.05)),
    maxLines: 8,
    dropInput: true,
  })
  const essential = buildEssentialAppToolEventData(args.record.data, Math.max(80, Math.floor(args.maxLineBytes * 0.04)))

  return [
    { ...args.record, data: medium },
    { ...args.record, data: aggressive },
    { ...args.record, data: essential },
  ]
}

function encodeRecord(record: SessionRecord, maxLineBytes: number): { line: string; truncated: boolean } {
  const tryEncode = (rec: SessionRecord): { json: string; bytes: number } => {
    const json = safeStringify(rec)
    return { json, bytes: Buffer.byteLength(json, 'utf8') }
  }

  let { json, bytes } = tryEncode(record)
  if (bytes <= maxLineBytes) return { line: json + '\n', truncated: false }

  // Ensure we never write invalid JSON. If a record is too large, truncate
  // known-large fields and, as a last resort, drop oldest history items.
  if (record.type === 'ui_msg') {
    const rec: UiMsgRecord = { ...record, msg: cloneMsgForPersistence((record as any).msg) }
    // Allocate ~60% of the budget to message text/result; leave room for JSON overhead.
    const budget = Math.max(1, Math.floor(maxLineBytes * 0.6))
    truncateMsgInPlace({ msg: rec.msg, maxContentBytes: budget })
    rec.truncated = true
    ;({ json, bytes } = tryEncode(rec))
    if (bytes <= maxLineBytes) return { line: json + '\n', truncated: true }
  }

  if (record.type === 'history_state') {
    const rec: HistoryStateRecord = { ...record, messages: cloneHistoryForPersistence((record as any).messages) }
    const perBlockBudget = Math.max(256, Math.floor(maxLineBytes * 0.1))
    truncateHistoryInPlace({ history: rec.messages, maxTextBytes: perBlockBudget })
    rec.truncated = true
    ;({ json, bytes } = tryEncode(rec))
    if (bytes <= maxLineBytes) return { line: json + '\n', truncated: true }

    // Still too large; drop oldest messages until it fits.
    while (rec.messages.length > 0) {
      rec.messages = rec.messages.slice(1)
      ;({ json, bytes } = tryEncode(rec))
      if (bytes <= maxLineBytes) return { line: json + '\n', truncated: true }
    }
  }

  if (record.type === 'event' && record.name === 'app_tool_event') {
    const candidates = buildAppToolEventTrimCandidates({ record, maxLineBytes })
    for (const candidate of candidates) {
      ;({ json, bytes } = tryEncode(candidate))
      if (bytes <= maxLineBytes) return { line: json + '\n', truncated: true }
    }
  }

  // Fallback: emit a small event that we had to drop an oversized record.
  const ev: SessionEventRecord = {
    type: 'event',
    v: 1,
    ts: new Date().toISOString(),
    name: 'line_truncated',
    data: { originalType: (record as any).type, maxLineBytes },
  }
  ;({ json } = tryEncode(ev))
  return { line: json + '\n', truncated: true }
}

export {
  safeStringify,
  cloneMsgForPersistence,
  cloneHistoryForPersistence,
  truncateMsgInPlace,
  truncateHistoryInPlace,
  isPlainObject,
  truncateTextValue,
  compactInputObjectForEvent,
  sanitizeAppToolEventData,
  buildEssentialAppToolEventData,
  buildAppToolEventTrimCandidates,
  encodeRecord,
}

