import type {
  HistoryStateRecord,
  SessionEventRecord,
  SessionMetaRecord,
  SessionRecord,
  UiMsgRecord,
} from './records'
import { isObject } from './validation'

function parseJsonLine(line: string): unknown | null {
  const trimmed = String(line).trimEnd()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function parseSessionMetaRecord(raw: unknown): SessionMetaRecord | null {
  if (!isObject(raw) || raw.type !== 'session_meta') return null
  return raw as SessionMetaRecord
}

function parseUiMsgRecord(raw: unknown): UiMsgRecord | null {
  if (!isObject(raw) || raw.type !== 'ui_msg') return null
  return raw as UiMsgRecord
}

function parseHistoryStateRecord(raw: unknown): HistoryStateRecord | null {
  if (!isObject(raw) || raw.type !== 'history_state') return null
  return raw as HistoryStateRecord
}

function parseSessionEventRecord(raw: unknown): SessionEventRecord | null {
  if (!isObject(raw) || raw.type !== 'event') return null
  return raw as SessionEventRecord
}

function parseSessionRecord(raw: unknown): SessionRecord | null {
  return (
    parseSessionMetaRecord(raw) ??
    parseUiMsgRecord(raw) ??
    parseHistoryStateRecord(raw) ??
    parseSessionEventRecord(raw)
  )
}

export {
  parseJsonLine,
  parseSessionMetaRecord,
  parseUiMsgRecord,
  parseHistoryStateRecord,
  parseSessionEventRecord,
  parseSessionRecord,
}

