import type { ChatHistory, Msg } from './types'

export type SessionRecord =
  | SessionMetaRecord
  | UiMsgRecord
  | HistoryStateRecord
  | SessionEventRecord

export type SessionMetaRecord = {
  type: 'session_meta'
  v: 1
  ts: string
  sessionId: string
  startedAt: string
  cwd: string
  cwdReal?: string
  gitBranch?: string
  provider: 'anthropic' | 'openai' | 'unknown'
  model?: string
}

export type UiMsgRecord = {
  type: 'ui_msg'
  v: 1
  ts: string
  msg: Msg
  truncated?: boolean
}

export type HistoryStateRecord = {
  type: 'history_state'
  v: 1
  ts: string
  seq: number
  messages: ChatHistory
  truncated?: boolean
}

export type SessionEventRecord = {
  type: 'event'
  v: 1
  ts: string
  name: string
  data?: Record<string, unknown>
}
