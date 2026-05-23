import type { ContextMeterBudgetRaw } from '@formax/shared/utils/contextMeter'
import type { TokenUsage } from '@formax/shared/streaming'

export type JsonRpcId = string | number

export type RpcRequest = {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

export type RpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export type RpcResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export type RpcErrorObject = NonNullable<RpcResponse['error']>

export type ThreadSummary = {
  id: string
  cwd: string
  createdAt: string
  updatedAt: string
  messageCount: number | null
  lastUserPrompt: string | null
  label: string | null
  archivedAt?: string | null
}

export type RequestCollapseSummary = {
  phase: 'initial' | 'reactive_retry'
  collapsedHeadMessageCount: number
  estimatedTokensSaved: number
  recapFingerprint?: string
}

export type DurableSnipSummary = {
  stage: 'snip'
  status: 'no_state' | 'active'
  applied: boolean
  reason: string
  removedMessageCount: number
  droppedOrphanToolBlockCount: number
  removalRangeCount: number
}

export type CompactBoundarySummary = {
  schemaVersion: 1
  trigger?: 'manual' | 'auto' | 'reactive'
  triggerReason?: {
    kind: 'auto_threshold' | 'manual' | 'reactive_error'
    detail?: string
  }
  preTokens?: number
  summaryKind?: 'model_summary' | 'session_memory'
  keepStrategy?:
    | {
        kind: 'keep_last_turns'
        keepLastTurns: number
      }
    | {
        kind: 'keep_combo'
        keepLastTurns: number
        keepMinTokens: number
        keepMinUserTurns: number
      }
  rehydrationPlan?: {
    schemaVersion: 1
    items: Array<{
      kind: 'recent_files' | 'plan_state' | 'todo_state' | 'mode_state'
      priority: 'high' | 'medium'
      status: 'planned' | 'applied'
    }>
  }
  rehydrationCost?: {
    sectionCount: number
    estimatedTokens: number
  }
  preservedSegment?: {
    schemaVersion: 1
    continuationMessageCount: number
    preservedTailMessageCount: number
    summaryFingerprint: string
    headFingerprint: string | null
    tailFingerprint: string | null
    messageFingerprints?: string[]
  }
}

export type SessionMemoryRestoreSummary = {
  schemaVersion: 1
  mode: 'normal' | 'acceptEdits' | 'plan'
  recentFiles: string[]
  recentUserPrompts: string[]
  recentSkills: string[]
  recentSubagentTypes: string[]
  recentDeferredToolNames: string[]
  recentTaskHints: string[]
  planPath: string | null
  planExcerpt: string | null
  todoSummary: string | null
}

export type ThreadHistoryMessage = {
  id: string
  kind: 'message'
  role: 'user' | 'assistant'
  text: string
}

export type ThreadHistoryTool = {
  id: string
  kind: 'tool'
  toolUseId?: string
  toolName: string
  status: 'running' | 'completed' | 'error'
  summary: string
  input?: Record<string, unknown>
  patchStartLineNumber?: number
  paramsText?: string
  detailLines?: string[]
}

export type ThreadMessage = ThreadHistoryMessage | ThreadHistoryTool

export type TranscriptMessageKind = 'command_subline' | 'compact_boundary' | 'compact_banner' | 'compact_summary'

export type PendingInput = {
  inputId: string
  threadId: string
  turnId: string
  toolUseId: string
  kind: 'approval' | 'ask_user_question'
  status: 'pending'
  createdAt: string
  expiresAt: string
  payload: any
}

export type ResolvedInput = {
  inputId: string
  threadId: string
  turnId: string
  toolUseId: string
  kind: 'approval' | 'ask_user_question'
  status: 'submitted' | 'canceled' | 'expired' | 'failed'
  createdAt: string
  expiresAt: string
  resolvedAt: string
  reason?: string
}

export type ContextMeterSnapshotRaw = {
  source: 'context_diagnostics_snapshot'
  fetchedAt: string
  totalTokens: number
  systemTokens: number
  historyTokens: number
  toolResultTokens: number
  otherHistoryTokens: number
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  toolResultBlockCount: number
  microCompactedToolResultCount: number
}

export type ContextMeterThreadRaw = {
  threadId: string
  budgetRaw: ContextMeterBudgetRaw | null
  budgetUpdatedAt?: string
  snapshot?: ContextMeterSnapshotRaw
  liveUsageByTurnId: Record<string, { usage: TokenUsage; replaySeq?: number; ts?: string }>
  latestUsageTurnId?: string | null
}

export type ContextMeterView = {
  available: boolean
  source: 'usage' | 'snapshot' | null
  usedTokens: number | null
  limitTokens: number | null
  percentUsed: number | null
  percentRemaining: number | null
  shouldAutoCompact: boolean | null
  label: string | null
  tone: 'normal' | 'warning' | 'danger'
}

export type TranscriptItem =
  | { id: string; kind: 'log'; text: string; level: 'info' | 'warn' | 'error'; turnId?: string }
  | { id: string; kind: 'notice'; text: string; level: 'info' | 'warn' | 'error'; turnId?: string }
  | { id: string; kind: 'thinking'; text: string; status: 'running' | 'finalized'; turnId?: string }
  | {
      id: string
      kind: 'message'
      role: 'user' | 'assistant'
      text: string
      turnId?: string
      messageKind?: TranscriptMessageKind
    }
  | {
      id: string
      kind: 'turn_footer'
      turnId: string
      status: 'completed' | 'failed' | 'interrupted'
      createdAt: string
      message?: string
    }
  | {
      id: string
      kind: 'tool_call'
      turnId?: string
      toolUseId?: string
      toolName: string
      input?: Record<string, unknown>
      patchStartLineNumber?: number
      paramsText?: string
      status: 'running' | 'completed' | 'error'
      summary: string
      detailLines: string[]
      inputState?: {
        kind: 'approval' | 'ask_user_question'
        status: 'pending' | 'submitted' | 'canceled' | 'expired' | 'failed'
      }
    }
