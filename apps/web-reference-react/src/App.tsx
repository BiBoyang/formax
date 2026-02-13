import { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { LeftRail } from './components/LeftRail'
import { InputApprovalDock } from './components/InputApprovalDock'
import { TranscriptPane } from './components/TranscriptPane'
import { RpcClient, RpcRequestError } from './rpcClient'
import { PanelLeft } from 'lucide-react'
import { appReducer, initialAppState } from './store'
import type { PendingInput, ResolvedInput, RpcNotification, ThreadMessage, ThreadSummary, TranscriptItem } from './types'
import { cn } from './lib/utils'
import { Button } from './components/ui/button'
import { formatToolInputAsParamsText, mapHistoryToolToTranscript } from './toolEventNormalizer'
import { createTurnEventCursorState, shouldAcceptSequencedNotification } from './turnEventCursor'
import { WorktreeDiffPane, type DiffSnapshot } from './components/WorktreeDiffPane'
import {
  createInitialThreadRuntimeState,
  extractThreadIdFromNotificationParams,
  reduceThreadRuntimeState,
  type ThreadRuntimeState,
} from '../../../src/features/semantics/threadRuntimeState'
import type { TranscriptSegment } from '../../../src/features/semantics/transcriptProjection'
import { resolveCommandRouting } from '../../../src/features/semantics/commandRouting'
import { isReplMode, type ReplMode } from '../../../src/features/semantics/replModeTransition'
import {
  isCanonicalEventSource,
  type CanonicalEventSource,
} from '../../../src/features/semantics/canonicalEvents'

const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:3777'
const RIGHT_RAIL_MIN_WIDTH = 280
const RIGHT_RAIL_MAX_WIDTH = 680
const CENTER_MIN_WIDTH = 560
const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 520
const SIDEBAR_DEFAULT_WIDTH = 260
const DIVIDER_WIDTH = 1
const SEEN_EVENT_CAP = 2000
const WEB_SUPPORTED_SLASH_COMMANDS = new Set(['/init', '/clear', '/compact', '/todos'])
const SIDEBAR_WIDTH_STORAGE_KEY = 'formax:web:sidebar-width'
const RIGHT_RAIL_WIDTH_STORAGE_KEY = 'formax:web:right-rail-width'

function resolveBridgeUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_BRIDGE_URL
  const fromRuntimeConfig = (window as Window & { __FORMAX_BRIDGE_URL__?: unknown }).__FORMAX_BRIDGE_URL__
  if (typeof fromRuntimeConfig === 'string' && fromRuntimeConfig.trim()) {
    return fromRuntimeConfig
  }
  return DEFAULT_BRIDGE_URL
}

function readStoredPaneWidth(storageKey: string): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function writeStoredPaneWidth(storageKey: string, width: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, String(Math.round(width)))
  } catch {
    // best-effort only
  }
}

function clampSidebarWidth(desiredWidth: number, viewportWidth: number, rightRailWidth: number): number {
  const available = viewportWidth - rightRailWidth - DIVIDER_WIDTH - DIVIDER_WIDTH - CENTER_MIN_WIDTH
  if (!Number.isFinite(available) || available <= 0) return SIDEBAR_MIN_WIDTH
  const maxByViewport = Math.min(SIDEBAR_MAX_WIDTH, available)
  const minByViewport = Math.min(SIDEBAR_MIN_WIDTH, maxByViewport)
  return Math.max(minByViewport, Math.min(maxByViewport, desiredWidth))
}

function clampRightRailWidth(
  desiredWidth: number,
  viewportWidth: number,
  isSidebarOpen: boolean,
  sidebarWidth: number,
): number {
  const leftReserved = isSidebarOpen ? sidebarWidth + DIVIDER_WIDTH : 0
  const available = viewportWidth - leftReserved - DIVIDER_WIDTH - CENTER_MIN_WIDTH
  if (!Number.isFinite(available) || available <= 0) return 0
  const maxByViewport = Math.min(RIGHT_RAIL_MAX_WIDTH, available)
  const minByViewport = Math.min(RIGHT_RAIL_MIN_WIDTH, maxByViewport)
  return Math.max(minByViewport, Math.min(maxByViewport, desiredWidth))
}

type RpcErrorDetails = {
  at: string
  method: string
  message: string
  code?: number
  data?: unknown
}
type SubmitUiStatus = {
  kind: 'success' | 'error'
  message: string
}

type ReplayNotification = {
  replaySeq: number
  method: string
  params?: unknown
}

type ReplayStateSnapshot = {
  mode: ReplMode
  activeTurnId: string | null
  lastTurnId: string | null
  lastTurnStatus: ThreadRuntimeState['lastTurnStatus']
  pendingInputCount: number
  pendingInputs: PendingInput[]
  projection: {
    segments: TranscriptSegment[]
    lastReplaySeq: number
    toolNameByUseId: Record<string, string>
    openAssistantSegmentIdByTurn: Record<string, string>
    openThinkingSegmentIdByTurn: Record<string, string>
  } | null
  toolNameByUseId: Record<string, string>
  updatedAt: string
}

type ThreadTranscriptSource = 'replay' | 'history'

function asThreadSummaries(value: unknown): ThreadSummary[] {
  if (!value || typeof value !== 'object') return []
  const data = (value as { data?: unknown }).data
  return Array.isArray(data) ? (data as ThreadSummary[]) : []
}

function displayThreadTitle(thread: ThreadSummary | undefined): string {
  if (!thread) return 'New Thread'
  const label = thread.label?.trim()
  if (label) return label
  const prompt = thread.lastUserPrompt?.trim()
  if (prompt) return prompt
  return 'New Thread'
}

function asThreadMessages(value: unknown): { data: ThreadMessage[]; nextCursor: string | null } {
  if (!value || typeof value !== 'object') return { data: [], nextCursor: null }
  const raw = Array.isArray((value as { data?: unknown }).data) ? ((value as { data: unknown[] }).data ?? []) : []
  const data: ThreadMessage[] = raw
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const kind = record.kind
      if (kind === 'tool') {
        if (typeof record.toolName !== 'string') return null
        const status =
          record.status === 'error'
            ? 'error'
            : record.status === 'running'
              ? 'running'
              : 'completed'
        const summary = typeof record.summary === 'string' ? record.summary : `${record.toolName} completed`
        return {
          id: typeof record.id === 'string' ? record.id : `tool-${index}`,
          kind: 'tool' as const,
          toolName: record.toolName,
          status,
          summary,
          ...(typeof record.toolUseId === 'string' ? { toolUseId: record.toolUseId } : {}),
          ...(typeof record.paramsText === 'string' ? { paramsText: record.paramsText } : {}),
          ...(Array.isArray(record.detailLines)
            ? { detailLines: record.detailLines.filter((line): line is string => typeof line === 'string') }
            : {}),
        }
      }

      const role = record.role
      if (role !== 'user' && role !== 'assistant') return null
      if (typeof record.text !== 'string') return null
      return {
        id: typeof record.id === 'string' ? record.id : `msg-${index}`,
        kind: 'message' as const,
        role,
        text: record.text,
      }
    })
    .filter((entry): entry is ThreadMessage => Boolean(entry))
  const nextCursorRaw = (value as { nextCursor?: unknown }).nextCursor
  const nextCursor = typeof nextCursorRaw === 'string' ? nextCursorRaw : null
  return { data, nextCursor }
}

function parseProjectionSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return []
  const out: TranscriptSegment[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const segment = raw as Record<string, unknown>
    const kind = segment.kind
    const id = typeof segment.id === 'string' ? segment.id : null
    const turnId = typeof segment.turnId === 'string' ? segment.turnId : null
    if (!id || !turnId) continue

    if (kind === 'assistant') {
      if (typeof segment.text !== 'string') continue
      out.push({ id, kind: 'assistant', turnId, text: segment.text })
      continue
    }
    if (kind === 'thinking') {
      if (typeof segment.text !== 'string') continue
      if (segment.status !== 'running' && segment.status !== 'finalized') continue
      out.push({
        id,
        kind: 'thinking',
        turnId,
        text: segment.text,
        status: segment.status,
      })
      continue
    }
    if (kind === 'tool') {
      if (typeof segment.toolUseId !== 'string' || typeof segment.toolName !== 'string' || typeof segment.summary !== 'string') {
        continue
      }
      if (segment.status !== 'running' && segment.status !== 'completed' && segment.status !== 'error') continue
      const detailLines = Array.isArray(segment.detailLines)
        ? segment.detailLines.filter((line): line is string => typeof line === 'string')
        : []
      const inputStateRaw = segment.inputState
      const inputState:
        | {
            kind: 'approval' | 'ask_user_question'
            status: 'pending' | 'submitted' | 'canceled' | 'expired' | 'failed'
          }
        | null =
        inputStateRaw && typeof inputStateRaw === 'object'
          ? (() => {
              const row = inputStateRaw as Record<string, unknown>
              const kind = row.kind === 'approval' || row.kind === 'ask_user_question' ? row.kind : null
              const status =
                row.status === 'pending' ||
                row.status === 'submitted' ||
                row.status === 'canceled' ||
                row.status === 'expired' ||
                row.status === 'failed'
                  ? row.status
                  : null
              if (!kind || !status) return null
              return { kind, status }
            })()
          : null
      out.push({
        id,
        kind: 'tool',
        turnId,
        toolUseId: segment.toolUseId,
        toolName: segment.toolName,
        status: segment.status,
        summary: segment.summary,
        detailLines,
        ...(typeof segment.paramsText === 'string' ? { paramsText: segment.paramsText } : {}),
        ...(inputState ? { inputState } : {}),
      })
      continue
    }
    if (kind === 'turn_footer') {
      if (segment.status !== 'completed' && segment.status !== 'failed' && segment.status !== 'interrupted') continue
      out.push({
        id,
        kind: 'turn_footer',
        turnId,
        status: segment.status,
        ...(typeof segment.message === 'string' ? { message: segment.message } : {}),
      })
    }
  }
  return out
}

function parseStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) continue
    if (typeof raw !== 'string') continue
    const text = raw.trim()
    if (!text) continue
    out[key] = text
  }
  return out
}

function asThreadReplay(value: unknown): {
  data: ReplayNotification[]
  nextCursor: number
  latestCursor: number
  hasGap: boolean
  state: ReplayStateSnapshot | null
} {
  if (!value || typeof value !== 'object') {
    return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false, state: null }
  }
  const record = value as Record<string, unknown>
  const rawData = Array.isArray(record.data) ? record.data : []
  const data = rawData
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const row = entry as Record<string, unknown>
      if (typeof row.replaySeq !== 'number' || !Number.isFinite(row.replaySeq)) return null
      if (typeof row.method !== 'string' || !row.method.trim()) return null
      return {
        replaySeq: row.replaySeq,
        method: row.method,
        ...(row.params !== undefined ? { params: row.params } : {}),
      } satisfies ReplayNotification
    })
    .filter((entry): entry is ReplayNotification => Boolean(entry))
  const nextCursor = typeof record.nextCursor === 'number' && Number.isFinite(record.nextCursor) ? record.nextCursor : 0
  const latestCursor =
    typeof record.latestCursor === 'number' && Number.isFinite(record.latestCursor) ? record.latestCursor : nextCursor
  const hasGap = Boolean(record.hasGap)
  const rawState = record.state
  let state: ReplayStateSnapshot | null = null
  if (rawState && typeof rawState === 'object') {
    const stateRecord = rawState as Record<string, unknown>
    const mode = isReplMode(stateRecord.mode) ? stateRecord.mode : 'normal'
    const activeTurnId = typeof stateRecord.activeTurnId === 'string' ? stateRecord.activeTurnId : null
    const lastTurnId = typeof stateRecord.lastTurnId === 'string' ? stateRecord.lastTurnId : null
    const lastTurnStatusRaw = stateRecord.lastTurnStatus
    const lastTurnStatus =
      lastTurnStatusRaw === 'running' ||
      lastTurnStatusRaw === 'completed' ||
      lastTurnStatusRaw === 'failed' ||
      lastTurnStatusRaw === 'interrupted'
        ? lastTurnStatusRaw
        : null
    const pendingInputCount =
      typeof stateRecord.pendingInputCount === 'number' && Number.isFinite(stateRecord.pendingInputCount)
        ? Math.max(0, stateRecord.pendingInputCount)
        : 0
    const pendingInputs: PendingInput[] = Array.isArray(stateRecord.pendingInputs)
      ? stateRecord.pendingInputs
          .map((rawInput): PendingInput | null => {
            if (!rawInput || typeof rawInput !== 'object') return null
            const record = rawInput as Record<string, unknown>
            const inputId = typeof record.inputId === 'string' && record.inputId.trim() ? record.inputId : null
            const threadId = typeof record.threadId === 'string' && record.threadId.trim() ? record.threadId : null
            const turnId = typeof record.turnId === 'string' && record.turnId.trim() ? record.turnId : null
            const toolUseId =
              typeof record.toolUseId === 'string' && record.toolUseId.trim() ? record.toolUseId : null
            const kind = record.kind === 'approval' || record.kind === 'ask_user_question' ? record.kind : null
            const status = record.status === 'pending' ? 'pending' : null
            const createdAt = typeof record.createdAt === 'string' ? record.createdAt : null
            const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt : null
            if (
              !inputId ||
              !threadId ||
              !turnId ||
              !toolUseId ||
              !kind ||
              !status ||
              !createdAt ||
              !expiresAt
            ) {
              return null
            }
            const payload = record.payload && typeof record.payload === 'object' ? record.payload : {}
            return {
              inputId,
              threadId,
              turnId,
              toolUseId,
              kind,
              status,
              createdAt,
              expiresAt,
              payload,
            }
          })
          .filter((input): input is PendingInput => Boolean(input))
      : []
    const projectionRaw = hasGap ? stateRecord.projection : null
    const projection =
      projectionRaw && typeof projectionRaw === 'object'
        ? (() => {
            const record = projectionRaw as Record<string, unknown>
            const segments = parseProjectionSegments(record.segments)
            const lastReplaySeq =
              typeof record.lastReplaySeq === 'number' && Number.isFinite(record.lastReplaySeq) ? record.lastReplaySeq : 0
            if (segments.length === 0 && lastReplaySeq <= 0) return null
            return {
              segments,
              lastReplaySeq,
              toolNameByUseId: parseStringRecord(record.toolNameByUseId),
              openAssistantSegmentIdByTurn: parseStringRecord(record.openAssistantSegmentIdByTurn),
              openThinkingSegmentIdByTurn: parseStringRecord(record.openThinkingSegmentIdByTurn),
            }
          })()
        : null
    const toolNameByUseId = parseStringRecord(stateRecord.toolNameByUseId)
    const updatedAt = typeof stateRecord.updatedAt === 'string' ? stateRecord.updatedAt : new Date(0).toISOString()
    state = {
      mode,
      activeTurnId,
      lastTurnId,
      lastTurnStatus,
      pendingInputCount,
      pendingInputs,
      projection,
      toolNameByUseId,
      updatedAt,
    }
  }
  return { data, nextCursor, latestCursor, hasGap, state }
}

function asResolvedInputs(value: unknown): ResolvedInput[] {
  if (!value || typeof value !== 'object') return []
  const raw = (value as { staleInputs?: unknown }).staleInputs
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const inputId = typeof record.inputId === 'string' ? record.inputId : null
      const threadId = typeof record.threadId === 'string' ? record.threadId : null
      const turnId = typeof record.turnId === 'string' ? record.turnId : null
      const toolUseId = typeof record.toolUseId === 'string' ? record.toolUseId : null
      const kind = record.kind === 'approval' || record.kind === 'ask_user_question' ? record.kind : null
      const status =
        record.status === 'submitted' ||
        record.status === 'canceled' ||
        record.status === 'expired' ||
        record.status === 'failed'
          ? record.status
          : null
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : null
      const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt : null
      const resolvedAt = typeof record.resolvedAt === 'string' ? record.resolvedAt : null
      if (!inputId || !threadId || !turnId || !toolUseId || !kind || !status || !createdAt || !expiresAt || !resolvedAt) {
        return null
      }
      const reason = typeof record.reason === 'string' ? record.reason : undefined
      return {
        inputId,
        threadId,
        turnId,
        toolUseId,
        kind,
        status,
        createdAt,
        expiresAt,
        resolvedAt,
        ...(reason ? { reason } : {}),
      } satisfies ResolvedInput
    })
    .filter((entry): entry is ResolvedInput => Boolean(entry))
}

function mapThreadHistoryToLogs(threadId: string, messages: ThreadMessage[]): TranscriptItem[] {
  return messages.map((message) =>
    message.kind === 'tool'
      ? mapHistoryToolToTranscript({
          id: `history-${threadId}-${message.id}`,
          tool: message,
        })
      : {
          id: `history-${threadId}-${message.id}`,
          kind: 'message' as const,
          role: message.role,
          text: message.text,
        },
  )
}

function toRuntimePendingInputsById(pendingInputs: PendingInput[]): ThreadRuntimeState['pendingInputs'] {
  const next: ThreadRuntimeState['pendingInputs'] = {}
  for (const input of pendingInputs) {
    next[input.inputId] = {
      inputId: input.inputId,
      threadId: input.threadId,
      turnId: input.turnId,
      toolUseId: input.toolUseId,
      kind: input.kind,
      status: 'pending',
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      payload: input.payload,
    }
  }
  return next
}

function summarizeToolEvent(event: any): string {
  if (!event || typeof event !== 'object') return 'tool event'
  if (event.type === 'tool_start') return ''
  if (event.type === 'tool_input') return ''
  if (event.type === 'tool_end') {
    const content = typeof event?.result?.content === 'string' ? event.result.content.trim() : ''
    return content || 'completed'
  }
  if (event.type === 'tool_update') {
    const middleLines = Array.isArray(event.middleLines) ? event.middleLines : []
    const transcriptLines = Array.isArray(event.transcriptLines) ? event.transcriptLines : []
    const line = transcriptLines[transcriptLines.length - 1] ?? middleLines[middleLines.length - 1]
    if (line && String(line).trim()) return String(line)
    if (typeof event.toolUses === 'number') return `tool uses ${event.toolUses}`
    return ''
  }
  return String(event.type ?? 'tool event')
}

function toToolUseId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toRpcError(method: string, error: unknown): RpcErrorDetails {
  const at = new Date().toISOString()
  if (error instanceof RpcRequestError) {
    return {
      at,
      method,
      message: error.message,
      code: error.code,
      data: error.data,
    }
  }
  if (error instanceof Error) {
    return {
      at,
      method,
      message: error.message,
    }
  }
  return {
    at,
    method,
    message: String(error),
  }
}

function toSubmitUiStatus(status: string): SubmitUiStatus {
  switch (status) {
    case 'accepted':
      return { kind: 'success', message: 'Accepted' }
    case 'already_submitted_same':
      return { kind: 'success', message: 'Same answer already accepted' }
    case 'conflict_already_submitted':
      return { kind: 'error', message: 'Different answer conflicts with previous submission' }
    case 'not_pending':
      return { kind: 'error', message: 'Input is no longer pending; refresh or re-run the action' }
    case 'expired':
      return { kind: 'error', message: 'Input expired; trigger the action again' }
    case 'canceled':
      return { kind: 'error', message: 'Input was canceled; trigger the action again' }
    default:
      return { kind: 'error', message: status }
  }
}

function toTurnFooterStatus(errorMessage: string | null | undefined): 'failed' | 'interrupted' {
  const normalized = String(errorMessage ?? '').toLowerCase()
  if (normalized.includes('interrupt') || normalized.includes('aborted') || normalized.includes('cancel')) {
    return 'interrupted'
  }
  return 'failed'
}

export function App() {
  const [bridgeUrl] = useState(resolveBridgeUrl)
  const [inputText, setInputText] = useState('')
  const [submitStatusByInputId, setSubmitStatusByInputId] = useState<
    Record<string, { status: string; kind: 'success' | 'error'; message?: string }>
  >({})
  const [lastRpcError, setLastRpcError] = useState<RpcErrorDetails | null>(null)
  const [diffSnapshot, setDiffSnapshot] = useState<DiffSnapshot | null>(null)
  const [state, dispatch] = useReducer(appReducer, initialAppState)
  const [isThreadActionBusy, setIsThreadActionBusy] = useState(false)
  const [isSendingTurn, setIsSendingTurn] = useState(false)
  const [isInterruptingTurn, setIsInterruptingTurn] = useState(false)
  const [isSubmittingInput, setIsSubmittingInput] = useState(false)
  const [isRefreshingDiff, setIsRefreshingDiff] = useState(false)
  const [askDockOpenByInputId, setAskDockOpenByInputId] = useState<Record<string, boolean>>({})
  const [askDraftByInputId, setAskDraftByInputId] = useState<Record<string, Record<string, string>>>({})
  const [askPageIndexByInputId, setAskPageIndexByInputId] = useState<Record<string, number>>({})
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [mode, setMode] = useState<ReplMode>('normal')
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    (() => {
      const viewportWidth = typeof window === 'undefined' ? 1600 : window.innerWidth
      const storedRightRailWidth = readStoredPaneWidth(RIGHT_RAIL_WIDTH_STORAGE_KEY) ?? 400
      const storedSidebarWidth = readStoredPaneWidth(SIDEBAR_WIDTH_STORAGE_KEY) ?? SIDEBAR_DEFAULT_WIDTH
      return clampSidebarWidth(storedSidebarWidth, viewportWidth, storedRightRailWidth)
    })(),
  )
  const [rightRailWidth, setRightRailWidth] = useState(() =>
    (() => {
      const viewportWidth = typeof window === 'undefined' ? 1600 : window.innerWidth
      const storedRightRailWidth = readStoredPaneWidth(RIGHT_RAIL_WIDTH_STORAGE_KEY) ?? 400
      const storedSidebarWidth = readStoredPaneWidth(SIDEBAR_WIDTH_STORAGE_KEY) ?? SIDEBAR_DEFAULT_WIDTH
      const clampedSidebarWidth = clampSidebarWidth(storedSidebarWidth, viewportWidth, storedRightRailWidth)
      return clampRightRailWidth(storedRightRailWidth, viewportWidth, true, clampedSidebarWidth)
    })(),
  )
  const [logsByThreadId, setLogsByThreadId] = useState<Record<string, TranscriptItem[]>>({})
  const [historyCursorByThreadId, setHistoryCursorByThreadId] = useState<Record<string, string | null>>({})
  const [historyLoadingByThreadId, setHistoryLoadingByThreadId] = useState<Record<string, boolean>>({})
  const [transcriptSourceByThreadId, setTranscriptSourceByThreadId] = useState<Record<string, ThreadTranscriptSource>>({})
  const clientRef = useRef<RpcClient | null>(null)
  const commandByTurnRef = useRef<Map<string, string>>(new Map())
  const eventCursorRef = useRef(createTurnEventCursorState(SEEN_EVENT_CAP))
  const historyLoadTokenRef = useRef(0)
  const historyLoadSeqByThreadRef = useRef<Record<string, number>>({})
  const historyLoadingRef = useRef<Record<string, boolean>>({})
  const transcriptSourceByThreadRef = useRef<Record<string, ThreadTranscriptSource>>({})
  const activeThreadIdRef = useRef<string | null>(state.activeThreadId)
  const selectedInputIdRef = useRef<string | null>(state.selectedInputId)
  const stateLogsRef = useRef<TranscriptItem[]>(state.logs)
  const logsByThreadIdRef = useRef<Record<string, TranscriptItem[]>>(logsByThreadId)
  const replayCursorByThreadRef = useRef<Record<string, number>>({})
  const runtimeStateByThreadRef = useRef<Record<string, ThreadRuntimeState>>({})
  const seenStaleInputIdRef = useRef<Set<string>>(new Set())
  const canonicalReplaySeqRef = useRef(0)
  const selectedInput = state.selectedInputId ? state.pendingInputs[state.selectedInputId] : null
  const selectedAskDraft = selectedInput ? (askDraftByInputId[selectedInput.inputId] ?? {}) : {}
  const selectedAskPageIndex = selectedInput ? (askPageIndexByInputId[selectedInput.inputId] ?? 0) : 0
  const isSelectedAskOpen =
    selectedInput?.kind === 'ask_user_question' ? Boolean(askDockOpenByInputId[selectedInput.inputId] ?? true) : false
  const composerLocked =
    selectedInput != null &&
    (selectedInput.kind === 'approval' || (selectedInput.kind === 'ask_user_question' && isSelectedAskOpen))
  const activeHistoryLoading = state.activeThreadId ? Boolean(historyLoadingByThreadId[state.activeThreadId]) : false
  const activeTranscriptSource =
    state.activeThreadId != null ? transcriptSourceByThreadId[state.activeThreadId] ?? null : null
  const activeLogs = state.activeThreadId ? (logsByThreadId[state.activeThreadId] ?? state.logs) : state.logs

  const log = useCallback((text: string, level: 'info' | 'warn' | 'error' = 'info', turnId?: string) => {
    dispatch({ type: 'push_log', text, level, turnId })
  }, [])

  const isNotificationForActiveThread = useCallback((params: any): boolean => {
    const threadId =
      (typeof params?.threadId === 'string' ? params.threadId : null) ??
      (typeof params?.turn?.threadId === 'string' ? params.turn.threadId : null)
    if (!threadId) return true
    const activeThreadId = activeThreadIdRef.current
    if (!activeThreadId) return true
    return threadId === activeThreadId
  }, [])

  const cacheThreadMode = useCallback((threadId: string | null | undefined, nextMode: ReplMode) => {
    if (!threadId) return
    const existing = runtimeStateByThreadRef.current[threadId]
    if (existing) {
      if (existing.mode === nextMode) return
      runtimeStateByThreadRef.current[threadId] = {
        ...existing,
        mode: nextMode,
        updatedAt: new Date().toISOString(),
      }
      return
    }
    const seed = createInitialThreadRuntimeState({
      threadId,
      replaySeq: 0,
      method: 'ui/modeSelected',
      ts: new Date().toISOString(),
    })
    runtimeStateByThreadRef.current[threadId] = {
      ...seed,
      mode: nextMode,
    }
  }, [])

  const shouldProcessSequencedNotification = useCallback(
    (params: any): boolean => {
      return shouldAcceptSequencedNotification(eventCursorRef.current, params)
    },
    [],
  )

  const captureError = useCallback(
    (method: string, error: unknown) => {
      const details = toRpcError(method, error)
      setLastRpcError(details)
      log(`[${method}] ${details.message}${details.code != null ? ` (code ${details.code})` : ''}`, 'error')
      return details
    },
    [log],
  )

  const request = useCallback(
    async (method: string, params?: unknown): Promise<any> => {
      const client = clientRef.current
      if (!client) throw new Error('RPC client is not ready')
      try {
        return await client.request(method, params)
      } catch (error) {
        captureError(method, error)
        throw error
      }
    },
    [captureError],
  )

  const syncPendingInputsFromReplayState = useCallback(
    (threadId: string, replayState: ReplayStateSnapshot | null) => {
      if (activeThreadIdRef.current !== threadId) return
      const pendingInputs = replayState?.pendingInputs ?? []
      const pendingInputIdSet = new Set(pendingInputs.map((input) => input.inputId))
      const selectedInputIdBeforeSync = selectedInputIdRef.current

      dispatch({ type: 'clear_pending_inputs' })
      for (const input of pendingInputs) {
        dispatch({ type: 'input_requested', input })
      }
      if (selectedInputIdBeforeSync && pendingInputIdSet.has(selectedInputIdBeforeSync)) {
        dispatch({ type: 'set_selected_input', inputId: selectedInputIdBeforeSync })
      }

      setSubmitStatusByInputId((prev) => {
        if (Object.keys(prev).length === 0) return prev
        const next: Record<string, { status: string; kind: 'success' | 'error'; message?: string }> = {}
        for (const [inputId, status] of Object.entries(prev)) {
          if (!pendingInputIdSet.has(inputId)) continue
          next[inputId] = status
        }
        return next
      })

      setAskDockOpenByInputId((prev) => {
        const next: Record<string, boolean> = {}
        for (const input of pendingInputs) {
          if (input.kind !== 'ask_user_question') continue
          next[input.inputId] = prev[input.inputId] ?? true
        }
        return next
      })
      setAskDraftByInputId((prev) => {
        const next: Record<string, Record<string, string>> = {}
        for (const input of pendingInputs) {
          if (input.kind !== 'ask_user_question') continue
          if (prev[input.inputId]) next[input.inputId] = prev[input.inputId]
        }
        return next
      })
      setAskPageIndexByInputId((prev) => {
        const next: Record<string, number> = {}
        for (const input of pendingInputs) {
          if (input.kind !== 'ask_user_question') continue
          next[input.inputId] = prev[input.inputId] ?? 0
        }
        return next
      })
    },
    [],
  )

  const nextCanonicalReplaySeq = useCallback((candidate?: unknown): number => {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      const replaySeq = candidate > canonicalReplaySeqRef.current ? candidate : canonicalReplaySeqRef.current + 1
      canonicalReplaySeqRef.current = replaySeq
      return replaySeq
    }
    canonicalReplaySeqRef.current += 1
    return canonicalReplaySeqRef.current
  }, [])

  const toCanonicalMeta = useCallback(
    (args: {
      threadId: string | null | undefined
      turnId: string
      kind: string
      params?: Record<string, unknown> | null | undefined
    }): {
      threadId: string
      replaySeq: number
      eventId: string
      ts: string
      source: CanonicalEventSource
    } => {
      const resolvedThreadId = args.threadId ?? activeThreadIdRef.current ?? '__active_thread__'
      const params = args.params
      const replaySeq = nextCanonicalReplaySeq(params?.replaySeq)
      const eventIdRaw = typeof params?.eventId === 'string' ? params.eventId.trim() : ''
      const eventId = eventIdRaw || `${resolvedThreadId}:${args.turnId}:${args.kind}:${replaySeq}`
      const ts = typeof params?.ts === 'string' && params.ts.trim() ? params.ts : new Date().toISOString()
      const sourceRaw = params?.source
      const source = isCanonicalEventSource(sourceRaw) ? sourceRaw : 'engine'
      return {
        threadId: resolvedThreadId,
        replaySeq,
        eventId,
        ts,
        source,
      }
    },
    [nextCanonicalReplaySeq],
  )

  const refreshThreads = useCallback(async () => {
    const result = await request('thread/list', { limit: 50 })
    dispatch({ type: 'set_threads', threads: asThreadSummaries(result) })
  }, [request])

  const refreshWorkspaceDiff = useCallback(async () => {
    setIsRefreshingDiff(true)
    try {
      const result = await request('bridge/readDiff', { maxBytes: 180 * 1024 })
      if (result && typeof result === 'object') {
        setDiffSnapshot(result as DiffSnapshot)
      }
    } finally {
      setIsRefreshingDiff(false)
    }
  }, [request])

  const setThreadHistoryLoading = useCallback((threadId: string, loading: boolean) => {
    if (loading) {
      historyLoadingRef.current = { ...historyLoadingRef.current, [threadId]: true }
    } else {
      const nextRef = { ...historyLoadingRef.current }
      delete nextRef[threadId]
      historyLoadingRef.current = nextRef
    }
    setHistoryLoadingByThreadId((prev) => {
      const current = Boolean(prev[threadId])
      if (current === loading) return prev
      if (loading) return { ...prev, [threadId]: true }
      const next = { ...prev }
      delete next[threadId]
      return next
    })
  }, [])

  const setThreadTranscriptSource = useCallback((threadId: string, source: ThreadTranscriptSource) => {
    transcriptSourceByThreadRef.current = { ...transcriptSourceByThreadRef.current, [threadId]: source }
    setTranscriptSourceByThreadId((prev) => {
      if (prev[threadId] === source) return prev
      return { ...prev, [threadId]: source }
    })
  }, [])

  const clearThreadHistoryCursor = useCallback((threadId: string) => {
    const nextHistoryLoadingRef = { ...historyLoadingRef.current }
    delete nextHistoryLoadingRef[threadId]
    historyLoadingRef.current = nextHistoryLoadingRef
    setHistoryLoadingByThreadId((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, threadId)) return prev
      const next = { ...prev }
      delete next[threadId]
      return next
    })
    setHistoryCursorByThreadId((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, threadId)) return prev
      const next = { ...prev }
      delete next[threadId]
      return next
    })
  }, [])

  const beginThreadHistoryRequest = useCallback(
    (threadId: string) => {
      const nextSeq = (historyLoadSeqByThreadRef.current[threadId] ?? 0) + 1
      historyLoadSeqByThreadRef.current = { ...historyLoadSeqByThreadRef.current, [threadId]: nextSeq }
      setThreadHistoryLoading(threadId, true)
      return nextSeq
    },
    [setThreadHistoryLoading],
  )

  const endThreadHistoryRequest = useCallback(
    (threadId: string, seq: number) => {
      if (historyLoadSeqByThreadRef.current[threadId] !== seq) return
      setThreadHistoryLoading(threadId, false)
    },
    [setThreadHistoryLoading],
  )

  const loadThreadHistory = useCallback(
    async (threadId: string) => {
      const token = ++historyLoadTokenRef.current
      const seq = beginThreadHistoryRequest(threadId)
      try {
        const historyResult = await request('thread/messages', { threadId, limit: 50 })
        if (token !== historyLoadTokenRef.current) return false
        if (activeThreadIdRef.current !== threadId) return false
        const parsed = asThreadMessages(historyResult)
        const logs = mapThreadHistoryToLogs(threadId, parsed.data)
        dispatch({ type: 'set_active_turn', turnId: null })
        dispatch({ type: 'clear_pending_inputs' })
        dispatch({ type: 'replace_logs', logs })
        setLogsByThreadId((prev) => ({ ...prev, [threadId]: logs }))
        setHistoryCursorByThreadId((prev) => ({ ...prev, [threadId]: parsed.nextCursor }))
        setThreadTranscriptSource(threadId, 'history')
        return true
      } catch {
        if (token !== historyLoadTokenRef.current) return false
        if (activeThreadIdRef.current !== threadId) return false
        return false
      } finally {
        endThreadHistoryRequest(threadId, seq)
      }
    },
    [beginThreadHistoryRequest, endThreadHistoryRequest, request, setThreadTranscriptSource],
  )

  const resumeThreadInputs = useCallback(
    async (threadId: string) => {
      try {
        const resumeResult = await request('thread/resume', { threadId })
        const staleInputs = asResolvedInputs(resumeResult)
        for (const input of staleInputs) {
          if (seenStaleInputIdRef.current.has(input.inputId)) continue
          seenStaleInputIdRef.current.add(input.inputId)
          log(
            `Recovered stale input: ${input.kind} (${input.status})${input.reason ? ` - ${input.reason}` : ''}`,
            input.status === 'failed' ? 'error' : 'warn',
            input.turnId,
          )
        }
      } catch {
        // best-effort resume
      }
    },
    [log, request],
  )

  const initializeHandshake = useCallback(async () => {
    const client = clientRef.current
    if (!client) return
    await client.request('initialize', { clientInfo: { name: 'web-reference-react', version: '0.0.1' } })
    client.notify('initialized')
  }, [])

  const handleNotification = useCallback(
    (notification: RpcNotification) => {
      const params = (notification.params ?? {}) as any
      const threadId = extractThreadIdFromNotificationParams(params)
      if (threadId) {
        const current = runtimeStateByThreadRef.current[threadId]
        const replaySeqRaw = typeof params?.replaySeq === 'number' && Number.isFinite(params.replaySeq) ? params.replaySeq : null
        const replaySeq = replaySeqRaw ?? (current ? current.lastReplaySeq + 1 : 1)
        const baseState =
          current ??
          createInitialThreadRuntimeState({
            threadId,
            replaySeq,
            method: notification.method,
            ts: params?.ts,
          })
        runtimeStateByThreadRef.current[threadId] = reduceThreadRuntimeState(baseState, {
          method: notification.method,
          params,
          replaySeq,
        })
      }
      const replaySeq = typeof params?.replaySeq === 'number' && Number.isFinite(params.replaySeq) ? params.replaySeq : null
      if (threadId && replaySeq != null) {
        const current = replayCursorByThreadRef.current[threadId]
        replayCursorByThreadRef.current[threadId] = typeof current === 'number' ? Math.max(current, replaySeq) : replaySeq
      }
      if (!shouldProcessSequencedNotification(params)) return
      switch (notification.method) {
        case 'turn/started': {
          if (!isNotificationForActiveThread(params)) break
          const turnId = String(params?.turn?.id ?? '')
          const nextMode = params?.turn?.mode
          if (isReplMode(nextMode)) {
            setMode(nextMode)
            cacheThreadMode(threadId ?? activeThreadIdRef.current, nextMode)
          }
          dispatch({ type: 'set_active_turn', turnId: turnId || null })
          break
        }

        case 'turn/modeChanged': {
          if (!isNotificationForActiveThread(params)) break
          if (isReplMode(params?.mode)) {
            setMode(params.mode)
            cacheThreadMode(threadId ?? activeThreadIdRef.current, params.mode)
          }
          break
        }

        case 'turn/completed': {
          if (!isNotificationForActiveThread(params)) {
            void refreshThreads().catch(() => undefined)
            void refreshWorkspaceDiff().catch(() => undefined)
            break
          }
          const turnId = String(params?.turn?.id ?? '')
          if (turnId) {
            const threadId =
              typeof params?.turn?.threadId === 'string' ? params.turn.threadId : activeThreadIdRef.current
            const thinkingMeta = toCanonicalMeta({
              threadId,
              turnId,
              kind: 'thinking_finalized',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...thinkingMeta,
                kind: 'thinking_finalized',
                turnId,
              },
            })
            const footerMeta = toCanonicalMeta({
              threadId,
              turnId,
              kind: 'turn_footer',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...footerMeta,
                kind: 'turn_footer',
                turnId,
                status: 'completed',
              },
            })
          }
          dispatch({ type: 'set_active_turn', turnId: null })
          if (turnId) {
            commandByTurnRef.current.delete(turnId)
          }
          void refreshThreads().catch(() => undefined)
          void refreshWorkspaceDiff().catch(() => undefined)
          break
        }

        case 'turn/failed': {
          if (!isNotificationForActiveThread(params)) {
            void refreshWorkspaceDiff().catch(() => undefined)
            break
          }
          const turnId = String(params?.turn?.id ?? '')
          if (turnId) {
            const threadId =
              typeof params?.turn?.threadId === 'string' ? params.turn.threadId : activeThreadIdRef.current
            const thinkingMeta = toCanonicalMeta({
              threadId,
              turnId,
              kind: 'thinking_finalized',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...thinkingMeta,
                kind: 'thinking_finalized',
                turnId,
              },
            })
            const footerMeta = toCanonicalMeta({
              threadId,
              turnId,
              kind: 'turn_footer',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...footerMeta,
                kind: 'turn_footer',
                turnId,
                status: toTurnFooterStatus(String(params?.error ?? '')),
                message: String(params?.error ?? 'unknown'),
              },
            })
          }
          dispatch({ type: 'set_active_turn', turnId: null })
          const command = turnId ? commandByTurnRef.current.get(turnId) : undefined
          if (command) {
            log(`Command failed: ${command}`, 'error', turnId)
            commandByTurnRef.current.delete(turnId)
          }
          log(`Turn failed: ${String(params?.error ?? 'unknown')}`, 'error', turnId || undefined)
          void refreshWorkspaceDiff().catch(() => undefined)
          break
        }

        case 'turn/event': {
          if (!isNotificationForActiveThread(params)) break
          const turnId = String(params?.turnId ?? '')
          const eventThreadId =
            typeof params?.threadId === 'string' ? params.threadId : activeThreadIdRef.current
          if (!turnId) break
          const eventType = params?.event?.type
          if (eventType === 'assistant_delta') {
            const textDelta = String(params?.event?.text ?? '')
            if (!textDelta) break
            const meta = toCanonicalMeta({
              threadId: eventThreadId,
              turnId,
              kind: 'assistant_delta',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...meta,
                kind: 'assistant_delta',
                turnId,
                textDelta,
              },
            })
            break
          }

          if (eventType === 'thinking_delta') {
            const text = String(params?.event?.thinking ?? params?.event?.text ?? params?.event?.delta ?? '')
            if (text) {
              const meta = toCanonicalMeta({
                threadId: eventThreadId,
                turnId,
                kind: 'thinking_delta',
                params,
              })
              dispatch({
                type: 'apply_canonical_event',
                event: {
                  ...meta,
                  kind: 'thinking_delta',
                  turnId,
                  textDelta: text,
                },
              })
            }
            break
          }

          if (eventType === 'tool_start' || eventType === 'tool_update' || eventType === 'tool_end') {
            const event = params?.event
            const toolUseId = toToolUseId(event?.id) ?? toToolUseId(event?.toolUseId)
            if (!toolUseId) break
            const meta = toCanonicalMeta({
              threadId: eventThreadId,
              turnId,
              kind: 'tool_event',
              params,
            })
            const summary = summarizeToolEvent(event)
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...meta,
                kind: 'tool_event',
                turnId,
                toolUseId,
                phase: eventType === 'tool_start' ? 'start' : eventType === 'tool_update' ? 'update' : 'end',
                ...(event?.name ? { toolName: String(event.name) } : {}),
                ...(eventType === 'tool_update' && summary ? { line: summary } : {}),
                ...(eventType === 'tool_end' && summary ? { summary } : {}),
                ...(event?.input ? { paramsText: formatToolInputAsParamsText(event.input) } : {}),
                isError: Boolean(event?.result?.is_error),
              },
            })
            break
          }

          if (eventType === 'error') {
            log(String(params?.event?.error ?? 'Stream error'), 'error', turnId)
            break
          }

          if (eventType === 'tool_input') {
            const event = params?.event
            const toolUseId = toToolUseId(event?.id) ?? toToolUseId(event?.toolUseId)
            if (!toolUseId) break
            const meta = toCanonicalMeta({
              threadId: eventThreadId,
              turnId,
              kind: 'tool_event',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...meta,
                kind: 'tool_event',
                turnId,
                toolUseId,
                phase: 'update',
                ...(event?.name ? { toolName: String(event.name) } : {}),
                ...(event?.input ? { paramsText: formatToolInputAsParamsText(event.input) } : {}),
              },
            })
            break
          }

          break
        }

        case 'turn/inputRequested': {
          if (!isNotificationForActiveThread(params)) break
          const input = params?.input as PendingInput | undefined
          if (!input?.inputId) break
          const meta = toCanonicalMeta({
            threadId: input.threadId,
            turnId: input.turnId,
            kind: 'tool_input_state',
            params,
          })
          dispatch({
            type: 'apply_canonical_event',
            event: {
              ...meta,
              kind: 'tool_input_state',
              turnId: input.turnId,
              toolUseId: input.toolUseId,
              ...(typeof input.payload?.toolName === 'string' ? { toolName: input.payload.toolName } : {}),
              inputKind: input.kind,
              status: 'pending',
            },
          })
          dispatch({ type: 'input_requested', input })
          dispatch({ type: 'set_selected_input', inputId: input.inputId })
          if (input.kind === 'ask_user_question') {
            setAskDockOpenByInputId((prev) => ({ ...prev, [input.inputId]: true }))
            setAskPageIndexByInputId((prev) => ({ ...prev, [input.inputId]: prev[input.inputId] ?? 0 }))
          }
          break
        }

        case 'turn/inputResolved': {
          if (!isNotificationForActiveThread(params)) break
          const input = params?.input as ResolvedInput | undefined
          const inputId = input?.inputId as string | undefined
          if (!inputId) break
          if (input?.turnId && input?.toolUseId && input?.kind && input?.status) {
            const meta = toCanonicalMeta({
              threadId: input.threadId,
              turnId: input.turnId,
              kind: 'tool_input_state',
              params,
            })
            dispatch({
              type: 'apply_canonical_event',
              event: {
                ...meta,
                kind: 'tool_input_state',
                turnId: input.turnId,
                toolUseId: input.toolUseId,
                inputKind: input.kind,
                status: input.status,
              },
            })
          }
          setAskDockOpenByInputId((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, inputId)) return prev
            const next = { ...prev }
            delete next[inputId]
            return next
          })
          setAskDraftByInputId((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, inputId)) return prev
            const next = { ...prev }
            delete next[inputId]
            return next
          })
          setAskPageIndexByInputId((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, inputId)) return prev
            const next = { ...prev }
            delete next[inputId]
            return next
          })
          dispatch({
            type: 'input_resolved',
            inputId,
            status: String(input?.status ?? 'unknown'),
            resolvedAt: typeof input?.resolvedAt === 'string' ? input.resolvedAt : undefined,
            reason: typeof input?.reason === 'string' ? input.reason : undefined,
          })
          if (input?.status && input.status !== 'submitted') {
            setSubmitStatusByInputId((prev) => ({
              ...prev,
              [inputId]: {
                status: input.status,
                kind: input.status === 'failed' ? 'error' : 'success',
                message: input.reason,
              },
            }))
          }
          break
        }

        default:
          break
      }
    },
    [
      cacheThreadMode,
      isNotificationForActiveThread,
      log,
      toCanonicalMeta,
      refreshThreads,
      refreshWorkspaceDiff,
      shouldProcessSequencedNotification,
    ],
  )

  const replayThreadEvents = useCallback(
    async (threadId: string, options?: { fromStart?: boolean }): Promise<boolean> => {
      const fromStart = options?.fromStart === true
      let after = fromStart ? 0 : (replayCursorByThreadRef.current[threadId] ?? 0)
      const initialAfter = after
      let latestCursor = after
      let replayState: ReplayStateSnapshot | null = null
      let receivedEntries = false
      let pageCount = 0

      while (pageCount < 100) {
        pageCount += 1
        const result = await request('thread/replay', { threadId, after, limit: 200 })
        const replay = asThreadReplay(result)
        latestCursor = replay.latestCursor
        if (replay.state) {
          replayState = replay.state
          runtimeStateByThreadRef.current[threadId] = {
            threadId,
            mode: replay.state.mode,
            activeTurnId: replay.state.activeTurnId,
            lastTurnId: replay.state.lastTurnId,
            lastTurnStatus: replay.state.lastTurnStatus,
            pendingInputs: toRuntimePendingInputsById(replay.state.pendingInputs),
            toolNameByUseId: replay.state.toolNameByUseId,
            updatedAt: replay.state.updatedAt,
            lastNotificationMethod: null,
            lastReplaySeq: replay.latestCursor,
          }
          if (activeThreadIdRef.current === threadId && Object.keys(replay.state.toolNameByUseId).length > 0) {
            dispatch({
              type: 'hydrate_projection_tool_names',
              threadId,
              toolNameByUseId: replay.state.toolNameByUseId,
            })
          }
        }

        if (replay.hasGap) {
          if (replay.state?.projection) {
            if (activeThreadIdRef.current !== threadId) return true
            dispatch({
              type: 'hydrate_projection_snapshot',
              threadId,
              snapshot: replay.state.projection,
            })
            setThreadTranscriptSource(threadId, 'replay')
            clearThreadHistoryCursor(threadId)
            replayCursorByThreadRef.current[threadId] = replay.latestCursor
            if (activeThreadIdRef.current === threadId) {
              syncPendingInputsFromReplayState(threadId, replay.state)
              dispatch({ type: 'set_active_turn', turnId: runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
              const nextMode = replay.state.mode ?? runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
              setMode(nextMode)
              cacheThreadMode(threadId, nextMode)
            }
            return true
          }

          const threadTranscriptSource = transcriptSourceByThreadRef.current[threadId]
          const cachedThreadLogs =
            activeThreadIdRef.current === threadId
              ? stateLogsRef.current
              : (logsByThreadIdRef.current[threadId] ?? [])
          const canFastRebaseGapWithoutHistory =
            (threadTranscriptSource === 'replay' || threadTranscriptSource === 'history') && cachedThreadLogs.length > 0
          if (canFastRebaseGapWithoutHistory) {
            replayCursorByThreadRef.current[threadId] = replay.latestCursor
            if (activeThreadIdRef.current === threadId) {
              if (replay.state) {
                syncPendingInputsFromReplayState(threadId, replay.state)
              }
              dispatch({ type: 'set_active_turn', turnId: runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
              const nextMode = replay.state?.mode ?? runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
              setMode(nextMode)
              if (replay.state) {
                cacheThreadMode(threadId, nextMode)
              }
            }
            return true
          }

          const loaded = await loadThreadHistory(threadId)
          if (!loaded) return false
          const baselineResult = await request('thread/replay', { threadId })
          const baselineReplay = asThreadReplay(baselineResult)
          if (baselineReplay.state) {
            runtimeStateByThreadRef.current[threadId] = {
              threadId,
              mode: baselineReplay.state.mode,
              activeTurnId: baselineReplay.state.activeTurnId,
              lastTurnId: baselineReplay.state.lastTurnId,
              lastTurnStatus: baselineReplay.state.lastTurnStatus,
              pendingInputs: toRuntimePendingInputsById(baselineReplay.state.pendingInputs),
              toolNameByUseId: baselineReplay.state.toolNameByUseId,
              updatedAt: baselineReplay.state.updatedAt,
              lastNotificationMethod: null,
              lastReplaySeq: baselineReplay.latestCursor,
            }
            replayState = baselineReplay.state
            if (activeThreadIdRef.current === threadId && Object.keys(baselineReplay.state.toolNameByUseId).length > 0) {
              dispatch({
                type: 'hydrate_projection_tool_names',
                threadId,
                toolNameByUseId: baselineReplay.state.toolNameByUseId,
              })
            }
          }
          replayCursorByThreadRef.current[threadId] =
            baselineReplay.nextCursor > 0 ? baselineReplay.nextCursor : baselineReplay.latestCursor
          if (activeThreadIdRef.current === threadId) {
            syncPendingInputsFromReplayState(threadId, baselineReplay.state ?? null)
            dispatch({ type: 'set_active_turn', turnId: runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
            const nextMode = baselineReplay.state?.mode ?? runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
            setMode(nextMode)
            if (baselineReplay.state) {
              cacheThreadMode(threadId, nextMode)
            }
          }
          return true
        }

        if (fromStart && replay.latestCursor === 0 && replay.data.length === 0) {
          const loaded = await loadThreadHistory(threadId)
          if (!loaded) return false
          replayCursorByThreadRef.current[threadId] = 0
          if (activeThreadIdRef.current === threadId) {
            syncPendingInputsFromReplayState(threadId, replay.state ?? null)
            dispatch({ type: 'set_active_turn', turnId: runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
            const nextMode = replay.state?.mode ?? runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
            setMode(nextMode)
            if (replay.state) {
              cacheThreadMode(threadId, nextMode)
            }
          }
          return true
        }

        for (const entry of replay.data) {
          receivedEntries = true
          handleNotification({
            jsonrpc: '2.0',
            method: entry.method,
            ...(entry.params === undefined ? {} : { params: entry.params }),
          })
        }

        const nextAfter = replay.nextCursor > 0 ? replay.nextCursor : replay.latestCursor
        if (nextAfter <= after || nextAfter >= replay.latestCursor) {
          after = nextAfter
          break
        }
        after = nextAfter
      }

      if (fromStart && !receivedEntries) {
        const loaded = await loadThreadHistory(threadId)
        if (!loaded) return false
      }

      const currentTranscriptSource = transcriptSourceByThreadRef.current[threadId]
      const shouldPromoteReplayAsCanonical =
        receivedEntries && (fromStart || initialAfter === 0 || currentTranscriptSource !== 'history')
      if (shouldPromoteReplayAsCanonical) {
        setThreadTranscriptSource(threadId, 'replay')
        clearThreadHistoryCursor(threadId)
      }

      replayCursorByThreadRef.current[threadId] = after > 0 ? after : latestCursor
      if (activeThreadIdRef.current === threadId) {
        syncPendingInputsFromReplayState(threadId, replayState)
        dispatch({ type: 'set_active_turn', turnId: runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
        const nextMode = replayState?.mode ?? runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
        setMode(nextMode)
        if (replayState) {
          cacheThreadMode(threadId, nextMode)
        }
      }
      return true
    },
    [
      cacheThreadMode,
      clearThreadHistoryCursor,
      handleNotification,
      loadThreadHistory,
      request,
      setThreadTranscriptSource,
      syncPendingInputsFromReplayState,
    ],
  )

  useEffect(() => {
    activeThreadIdRef.current = state.activeThreadId
  }, [state.activeThreadId])

  useEffect(() => {
    stateLogsRef.current = state.logs
  }, [state.logs])

  useEffect(() => {
    logsByThreadIdRef.current = logsByThreadId
  }, [logsByThreadId])

  useEffect(() => {
    selectedInputIdRef.current = state.selectedInputId
  }, [state.selectedInputId])

  useEffect(() => {
    const pendingIds = Object.keys(state.pendingInputs)
    const pendingIdSet = new Set(pendingIds)
    if (!state.selectedInputId || !state.pendingInputs[state.selectedInputId]) {
      const latestPendingId = pendingIds[pendingIds.length - 1] ?? null
      if (latestPendingId !== state.selectedInputId) {
        dispatch({ type: 'set_selected_input', inputId: latestPendingId })
      }
    }

    setAskDockOpenByInputId((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([inputId]) => pendingIdSet.has(inputId)))
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      const same =
        prevKeys.length === nextKeys.length &&
        prevKeys.every((key) => Object.prototype.hasOwnProperty.call(next, key) && prev[key] === next[key])
      return same ? prev : next
    })
    setAskDraftByInputId((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([inputId]) => pendingIdSet.has(inputId)))
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      const same =
        prevKeys.length === nextKeys.length &&
        prevKeys.every((key) => Object.prototype.hasOwnProperty.call(next, key) && prev[key] === next[key])
      return same ? prev : next
    })
    setAskPageIndexByInputId((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([inputId]) => pendingIdSet.has(inputId)))
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      const same =
        prevKeys.length === nextKeys.length &&
        prevKeys.every((key) => Object.prototype.hasOwnProperty.call(next, key) && prev[key] === next[key])
      return same ? prev : next
    })
  }, [state.pendingInputs, state.selectedInputId])

  useEffect(() => {
    const threadId = state.activeThreadId
    if (!threadId) return
    setLogsByThreadId((prev) => ({ ...prev, [threadId]: state.logs }))
  }, [state.activeThreadId, state.logs])

  useEffect(() => {
    const client = new RpcClient()
    clientRef.current = client
    client.connect(bridgeUrl, {
      onStatus: (connectionStatus) => {
        dispatch({ type: 'set_connection_status', status: connectionStatus })
        if (connectionStatus === 'connected') {
          eventCursorRef.current = createTurnEventCursorState(SEEN_EVENT_CAP)
          void initializeHandshake()
            .then(async () => {
              await Promise.all([refreshThreads(), refreshWorkspaceDiff()])
              const activeThreadId = activeThreadIdRef.current
              if (activeThreadId) {
                await resumeThreadInputs(activeThreadId)
                await replayThreadEvents(activeThreadId)
              }
            })
            .catch((error) => captureError('initialize', error))
        }
      },
      onNotification: handleNotification,
      onError: (error) => {
        captureError('transport', error)
      },
    })

    return () => {
      client.disconnect()
      clientRef.current = null
    }
  }, [
    bridgeUrl,
    captureError,
    handleNotification,
    initializeHandshake,
    refreshThreads,
    refreshWorkspaceDiff,
    replayThreadEvents,
    resumeThreadInputs,
  ])

  const sortedThreads = useMemo(
    () => [...state.threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [state.threads],
  )
  const cwdOptions = useMemo(() => {
    const seen = new Set<string>()
    const values: string[] = []
    for (const thread of sortedThreads) {
      const cwd = typeof thread.cwd === 'string' ? thread.cwd : ''
      if (!cwd || seen.has(cwd)) continue
      seen.add(cwd)
      values.push(cwd)
    }
    return values
  }, [sortedThreads])
  useEffect(() => {
    const activeThread = state.activeThreadId ? state.threads.find((thread) => thread.id === state.activeThreadId) : null
    if (activeThread?.cwd && activeThread.cwd !== selectedCwd) {
      setSelectedCwd(activeThread.cwd)
      return
    }
    if (selectedCwd && cwdOptions.includes(selectedCwd)) return
    const fallback = cwdOptions[0] ?? null
    if (fallback !== selectedCwd) {
      setSelectedCwd(fallback)
    }
  }, [cwdOptions, selectedCwd, state.activeThreadId, state.threads])

  const startThread = async () => {
      const previousThreadId = state.activeThreadId
      const previousLogs = state.logs
      setIsThreadActionBusy(true)
      try {
      const result = await request('thread/start', selectedCwd ? { cwd: selectedCwd } : {})
      const thread = result?.thread as { id?: string; cwd?: string } | undefined
      if (thread?.id) {
        if (thread.cwd) {
          setSelectedCwd(thread.cwd)
        }
        setMode(runtimeStateByThreadRef.current[thread.id]?.mode ?? 'normal')
        activeThreadIdRef.current = thread.id
        dispatch({ type: 'set_active_thread', threadId: thread.id })
        dispatch({ type: 'set_active_turn', turnId: null })
        dispatch({ type: 'clear_pending_inputs' })
        dispatch({ type: 'replace_logs', logs: logsByThreadId[thread.id] ?? [] })
        const replayLoaded = await replayThreadEvents(thread.id, { fromStart: true })
        if (!replayLoaded) {
          activeThreadIdRef.current = previousThreadId
          dispatch({ type: 'set_active_thread', threadId: previousThreadId })
          dispatch({
            type: 'replace_logs',
            logs: previousThreadId ? (logsByThreadId[previousThreadId] ?? previousLogs) : previousLogs,
          })
          log('Failed to hydrate new thread transcript. Restored previous thread.', 'warn')
          return
        }
        await resumeThreadInputs(thread.id)
        await refreshThreads()
        await refreshWorkspaceDiff()
        log(`Thread created: ${thread.id}`)
      }
    } finally {
      setIsThreadActionBusy(false)
    }
  }

  const startTurn = async () => {
    const text = inputText.trim()
    if (!text || isSendingTurn) return

    const commandRouting = resolveCommandRouting(text)
    if (
      commandRouting.isSlashCommandAfterTrim &&
      commandRouting.commandName &&
      !WEB_SUPPORTED_SLASH_COMMANDS.has(commandRouting.commandName)
    ) {
      setInputText('')
      dispatch({
        type: 'push_message',
        role: 'assistant',
        text: `Web reference does not support ${commandRouting.commandName} yet. Please use TUI for this command.`,
      })
      return
    }

    if (commandRouting.isExactClear) {
      setInputText('')
      if (commandRouting.commandArgs) {
        dispatch({ type: 'push_message', role: 'assistant', text: 'Usage: /clear' })
        return
      }
      await startThread()
      return
    }
    if (!state.activeThreadId) {
      log('Please select or create a thread first', 'warn')
      return
    }

    const shouldDispatchCommand = commandRouting.shouldUseCommandDispatch
    const activeThread = state.threads.find((thread) => thread.id === state.activeThreadId)
    const requestCwd = selectedCwd ?? activeThread?.cwd
    dispatch({ type: 'push_message', role: 'user', text })
    setInputText('')
    if (shouldDispatchCommand) {
      log(`Command queued: ${text}`, 'info')
    }

    setIsSendingTurn(true)
    try {
      const result = shouldDispatchCommand
        ? await request('command/dispatch', {
            threadId: state.activeThreadId,
            command: text,
            mode,
            ...(requestCwd ? { cwd: requestCwd } : {}),
          })
        : await request('turn/start', {
            threadId: state.activeThreadId,
            input: { text },
            mode,
            ...(requestCwd ? { cwd: requestCwd } : {}),
          })
      const localStdout =
        typeof (result as { local?: { stdout?: unknown } } | null)?.local?.stdout === 'string'
          ? ((result as { local?: { stdout?: string } }).local?.stdout ?? '')
          : ''
      if (localStdout) {
        dispatch({ type: 'push_message', role: 'assistant', text: localStdout })
        return
      }
      const turnId = String((result as any)?.turn?.id ?? '')
      if (turnId) {
        dispatch({ type: 'set_active_turn', turnId })
        dispatch({ type: 'bind_last_user_message_turn', turnId })
        if (shouldDispatchCommand) {
          commandByTurnRef.current.set(turnId, text)
        }
      }
    } finally {
      setIsSendingTurn(false)
    }
  }

  const interruptTurn = async () => {
    if (!state.activeThreadId || !state.activeTurnId || isInterruptingTurn) return
    setIsInterruptingTurn(true)
    try {
      await request('turn/interrupt', {
        threadId: state.activeThreadId,
        turnId: state.activeTurnId,
      })
      log(`Interrupt requested: ${state.activeTurnId}`, 'warn', state.activeTurnId)
    } finally {
      setIsInterruptingTurn(false)
    }
  }

  const submitInputById = async (inputId: string, answers: Record<string, string>) => {
    const input = state.pendingInputs[inputId]
    if (!input || isSubmittingInput) return

    setIsSubmittingInput(true)
    try {
      const response = await request('turn/input/submit', {
        threadId: input.threadId,
        turnId: input.turnId,
        inputId: input.inputId,
        toolUseId: input.toolUseId,
        answers,
        submissionId: `web-${Date.now()}`,
      })
      const status = String((response as { status?: string })?.status ?? 'unknown')
      const uiStatus = toSubmitUiStatus(status)
      setSubmitStatusByInputId((prev) => ({
        ...prev,
        [input.inputId]: {
          status,
          kind: uiStatus.kind,
          message: uiStatus.message,
        },
      }))
      log(`Input submit: ${status}`, uiStatus.kind === 'error' ? 'error' : 'info', input.turnId)
    } catch (error) {
      const details = toRpcError('turn/input/submit', error)
      setSubmitStatusByInputId((prev) => ({
        ...prev,
        [input.inputId]: {
          status: details.code != null ? `rpc_${details.code}` : 'error',
          kind: 'error',
          message: details.message,
        },
      }))
      throw error
    } finally {
      setIsSubmittingInput(false)
    }
  }

  const onSend = (event: FormEvent) => {
    event.preventDefault()
    void startTurn().catch(() => undefined)
  }

  const selectThread = useCallback(
    (threadId: string) => {
      if (threadId === state.activeThreadId) return
      const nextThread = state.threads.find((thread) => thread.id === threadId)
      if (nextThread?.cwd) {
        setSelectedCwd(nextThread.cwd)
      }
      const previousThreadId = state.activeThreadId
      const previousLogs = state.logs
      const cachedLogs = logsByThreadId[threadId] ?? []
      setMode(runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal')
      activeThreadIdRef.current = threadId
      dispatch({ type: 'set_active_thread', threadId })
      dispatch({ type: 'set_active_turn', turnId: null })
      dispatch({ type: 'clear_pending_inputs' })
      dispatch({ type: 'replace_logs', logs: cachedLogs })
      void (async () => {
        const hasReplayCursor = typeof replayCursorByThreadRef.current[threadId] === 'number'
        const replayLoaded = await replayThreadEvents(threadId, { fromStart: !hasReplayCursor }).catch(() => false)
        if (!replayLoaded) {
          if (activeThreadIdRef.current === threadId) {
            activeThreadIdRef.current = previousThreadId
            dispatch({ type: 'set_active_thread', threadId: previousThreadId })
            dispatch({
              type: 'replace_logs',
              logs: previousThreadId ? (logsByThreadId[previousThreadId] ?? previousLogs) : previousLogs,
            })
            log('Failed to hydrate selected thread transcript. Restored previous thread.', 'warn')
          }
          return
        }
        if (activeThreadIdRef.current !== threadId) return
        await resumeThreadInputs(threadId)
      })().catch(() => undefined)
    },
    [
      log,
      logsByThreadId,
      replayThreadEvents,
      resumeThreadInputs,
      state.activeThreadId,
      state.logs,
      state.threads,
    ],
  )

  const selectCwd = useCallback(
    (cwd: string) => {
      if (!cwd || cwd === selectedCwd) return
      setSelectedCwd(cwd)
      const targetThread = sortedThreads.find((thread) => thread.cwd === cwd)
      if (!targetThread) {
        activeThreadIdRef.current = null
        setMode('normal')
        dispatch({ type: 'set_active_thread', threadId: null })
        dispatch({ type: 'set_active_turn', turnId: null })
        dispatch({ type: 'clear_pending_inputs' })
        dispatch({ type: 'replace_logs', logs: [] })
        return
      }
      if (targetThread.id !== state.activeThreadId) {
        selectThread(targetThread.id)
      }
    },
    [selectThread, selectedCwd, sortedThreads, state.activeThreadId],
  )

  const renameThread = useCallback(
    async (threadId: string, label: string) => {
      const nextLabel = label.trim()
      if (!threadId || !nextLabel) return
      setIsThreadActionBusy(true)
      try {
        await request('thread/rename', { threadId, label: nextLabel })
        await refreshThreads()
      } finally {
        setIsThreadActionBusy(false)
      }
    },
    [refreshThreads, request],
  )

  const loadEarlierHistory = useCallback(async () => {
    const threadId = state.activeThreadId
    if (!threadId || historyLoadingRef.current[threadId]) return
    if (transcriptSourceByThreadRef.current[threadId] !== 'history') return
    const cursor = historyCursorByThreadId[threadId]
    if (!cursor) return

    const token = historyLoadTokenRef.current
    const seq = beginThreadHistoryRequest(threadId)
    try {
      const result = await request('thread/messages', { threadId, limit: 50, cursor })
      if (token !== historyLoadTokenRef.current) return
      if (activeThreadIdRef.current !== threadId) return
      const parsed = asThreadMessages(result)
      const prepended = mapThreadHistoryToLogs(threadId, parsed.data)
      dispatch({ type: 'prepend_logs', logs: prepended })
      setLogsByThreadId((prev) => {
        const current = prev[threadId] ?? state.logs
        return { ...prev, [threadId]: [...prepended, ...current] }
      })
      setHistoryCursorByThreadId((prev) => ({ ...prev, [threadId]: parsed.nextCursor }))
    } finally {
      endThreadHistoryRequest(threadId, seq)
    }
  }, [
    beginThreadHistoryRequest,
    endThreadHistoryRequest,
    historyCursorByThreadId,
    request,
    state.activeThreadId,
    state.logs,
  ])

  const activeThread = useMemo(
    () => state.threads.find((t) => t.id === state.activeThreadId),
    [state.threads, state.activeThreadId],
  )
  const activeThreadTitle = displayThreadTitle(activeThread)

  useEffect(() => {
    const syncLayoutWidths = () => {
      const nextSidebarWidth = clampSidebarWidth(sidebarWidth, window.innerWidth, rightRailWidth)
      if (nextSidebarWidth !== sidebarWidth) {
        setSidebarWidth(nextSidebarWidth)
      }
      setRightRailWidth((previous) =>
        clampRightRailWidth(previous, window.innerWidth, isSidebarOpen, nextSidebarWidth),
      )
    }
    syncLayoutWidths()
    window.addEventListener('resize', syncLayoutWidths)
    return () => {
      window.removeEventListener('resize', syncLayoutWidths)
    }
  }, [isSidebarOpen, rightRailWidth, sidebarWidth])

  useEffect(() => {
    writeStoredPaneWidth(SIDEBAR_WIDTH_STORAGE_KEY, sidebarWidth)
  }, [sidebarWidth])

  useEffect(() => {
    writeStoredPaneWidth(RIGHT_RAIL_WIDTH_STORAGE_KEY, rightRailWidth)
  }, [rightRailWidth])

  return (
    <div data-testid="app-shell" className="h-screen w-screen min-w-0 flex bg-background overflow-hidden text-sm relative">
      <div
        data-testid="left-rail"
        className={cn(
          'transition-all duration-300 ease-in-out h-full overflow-hidden bg-sidebar flex-none relative',
          isSidebarOpen ? 'opacity-100' : 'w-0 opacity-0',
        )}
        style={{ width: isSidebarOpen ? sidebarWidth : 0 }}
      >
        <LeftRail
          threads={sortedThreads}
          selectedCwd={selectedCwd}
          onSelectCwd={selectCwd}
          activeThreadId={state.activeThreadId}
          onSelectThread={selectThread}
          onRenameThread={(threadId, label) => renameThread(threadId, label)}
          onStartThread={() => void startThread().catch(() => undefined)}
          isBusy={isThreadActionBusy}
        />

        {isSidebarOpen ? (
          <div
            className="absolute right-0 top-0 bottom-0 w-[1px] cursor-col-resize hover:bg-primary/50 bg-border z-[110]"
            onMouseDown={(event) => {
              const startX = event.pageX
              const startWidth = sidebarWidth

              const onMouseMove = (moveEvent: MouseEvent) => {
                const deltaX = moveEvent.pageX - startX
                const newWidth = clampSidebarWidth(startWidth + deltaX, window.innerWidth, rightRailWidth)
                setSidebarWidth(newWidth)
                setRightRailWidth((previous) =>
                  clampRightRailWidth(previous, window.innerWidth, true, newWidth),
                )
              }

              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove)
                document.removeEventListener('mouseup', onMouseUp)
                document.body.style.cursor = 'default'
              }

              document.addEventListener('mousemove', onMouseMove)
              document.addEventListener('mouseup', onMouseUp)
              document.body.style.cursor = 'col-resize'
            }}
          >
            <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-w-0 h-full flex flex-col">
        <header className="h-14 flex-none border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <div className="h-full min-w-0 flex items-center px-4">
            <div className="flex-1 min-w-0 flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                aria-label="Toggle sidebar"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex flex-col leading-tight">
                <div className="truncate text-[14px] font-semibold text-foreground">{activeThreadTitle}</div>
              </div>
            </div>
            <div className="ml-3 flex shrink-0 items-center gap-2">
              {state.activeTurnId ? (
                <div className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  turn {state.activeTurnId.slice(0, 8)}
                </div>
              ) : null}
              <div className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                {state.connectionStatus}
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 min-h-0 min-w-0 flex">
          <div data-testid="center-pane-host" className="flex-1 flex flex-col relative h-full min-w-0">
            <TranscriptPane
              activeThread={activeThread}
              activeThreadId={state.activeThreadId}
              activeTurnId={state.activeTurnId}
              composerLocked={composerLocked}
              logs={activeLogs}
              inputText={inputText}
              mode={mode}
              onModeChange={(nextMode) => {
                setMode(nextMode)
                cacheThreadMode(activeThreadIdRef.current, nextMode)
              }}
              connectionStatus={state.connectionStatus}
              onInputTextChange={setInputText}
              onSend={onSend}
              onInterrupt={() => void interruptTurn().catch(() => undefined)}
              historyMore={Boolean(
                state.activeThreadId &&
                  activeTranscriptSource === 'history' &&
                  historyCursorByThreadId[state.activeThreadId],
              )}
              historyLoading={activeHistoryLoading}
              onLoadEarlier={() => void loadEarlierHistory().catch(() => undefined)}
              isSending={isSendingTurn}
              isInterrupting={isInterruptingTurn}
              lastRpcError={lastRpcError}
            />
            <InputApprovalDock
              input={selectedInput}
              isAskOpen={isSelectedAskOpen}
              askPageIndex={selectedAskPageIndex}
              askDraftValues={selectedAskDraft}
              submitStatus={selectedInput ? (submitStatusByInputId[selectedInput.inputId] ?? null) : null}
              isSubmitting={isSubmittingInput}
              onAskOpen={() => {
                if (!selectedInput || selectedInput.kind !== 'ask_user_question') return
                setAskDockOpenByInputId((prev) => ({ ...prev, [selectedInput.inputId]: true }))
              }}
              onAskDismiss={() => {
                if (!selectedInput || selectedInput.kind !== 'ask_user_question') return
                setAskDockOpenByInputId((prev) => ({ ...prev, [selectedInput.inputId]: false }))
              }}
              onAskPageChange={(page) => {
                if (!selectedInput || selectedInput.kind !== 'ask_user_question') return
                setAskPageIndexByInputId((prev) => ({ ...prev, [selectedInput.inputId]: Math.max(0, page) }))
              }}
              onAskDraftChange={(fieldId, value) => {
                if (!selectedInput || selectedInput.kind !== 'ask_user_question') return
                setAskDraftByInputId((prev) => ({
                  ...prev,
                  [selectedInput.inputId]: {
                    ...(prev[selectedInput.inputId] ?? {}),
                    [fieldId]: value,
                  },
                }))
              }}
              onSubmitInput={(inputId, answers) => void submitInputById(inputId, answers).catch(() => undefined)}
            />
          </div>

          <div
            className="w-[1px] h-full flex-none cursor-col-resize hover:bg-primary/50 bg-border relative group z-[100]"
            onMouseDown={(e) => {
              const startX = e.pageX
              const startWidth = rightRailWidth

              const onMouseMove = (moveEvent: MouseEvent) => {
                const deltaX = startX - moveEvent.pageX
                const newWidth = clampRightRailWidth(startWidth + deltaX, window.innerWidth, isSidebarOpen, sidebarWidth)
                setRightRailWidth(newWidth)
              }

              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove)
                document.removeEventListener('mouseup', onMouseUp)
                document.body.style.cursor = 'default'
              }

              document.addEventListener('mousemove', onMouseMove)
              document.addEventListener('mouseup', onMouseUp)
              document.body.style.cursor = 'col-resize'
            }}
          >
            <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
          </div>

          <div
            data-testid="right-rail"
            className="flex-none min-w-0 bg-white h-full overflow-hidden overflow-x-hidden"
            style={{ width: rightRailWidth }}
          >
            <WorktreeDiffPane
              diffSnapshot={diffSnapshot}
              onRefreshDiff={() => void refreshWorkspaceDiff().catch(() => undefined)}
              isRefreshingDiff={isRefreshingDiff}
              showHeader
            />
          </div>
        </div>
      </div>
    </div>
  )
}
