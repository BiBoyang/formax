import type { PolicyAction, PolicyDecision } from '../policy/types.js'
import type { PolicyMatchedRule } from '../policy/engine.js'

export type AuditSchemaVersion = 1

export type TraceContext = {
  traceId?: string
  threadId?: string
  turnId?: string
  toolUseId?: string
  eventId?: string
  replaySeq?: number
}

export type AuditEventBase = {
  schemaVersion: AuditSchemaVersion
  ts: string
  kind: string
  agentDepth: number
  trace?: TraceContext
}

export type ToolStartEvent = AuditEventBase & {
  kind: 'tool.start'
  tool: { name: string; toolUseId: string }
}

export type ToolEndEvent = AuditEventBase & {
  kind: 'tool.end'
  tool: { name: string; toolUseId: string }
  durationMs: number
  isError: boolean
}

export type PolicyDecisionEvent = AuditEventBase & {
  kind: 'policy.decision'
  tool: { name: string; toolUseId: string }
  replMode?: string
  action: PolicyAction
  decision: {
    raw: PolicyDecision
    effective: PolicyDecision
    matchedRule?: PolicyMatchedRule
    suggestions: string[]
  }
}

export type ApprovalPromptEvent = AuditEventBase & {
  kind: 'approval.prompt'
  tool: { name: string; toolUseId: string }
  action: PolicyAction
  effectiveDecision: PolicyDecision
}

export type ApprovalResultEvent = AuditEventBase & {
  kind: 'approval.result'
  tool: { name: string; toolUseId: string }
  action: PolicyAction
  outcome: 'approve' | 'approve_remember' | 'feedback' | 'cancel'
  scope?: string
}

export type HookRunEvent = AuditEventBase & {
  kind: 'hook.run'
  tool: { name: string; toolUseId: string }
  hook: {
    eventName: string
    source?: string
    matcher?: string
    command: string
    timeoutMs?: number | null
    exitCode: number | null
    signal: string | null
    timedOut: boolean
    durationMs: number
    status?: 'ok' | 'blocked' | 'failed' | 'aborted'
    parsedJson?: boolean
    stdoutPreview?: string
    stderrPreview?: string
    stdoutTruncated?: boolean
    stderrTruncated?: boolean
  }
}

export type AuditEventV1 =
  | ToolStartEvent
  | ToolEndEvent
  | PolicyDecisionEvent
  | ApprovalPromptEvent
  | ApprovalResultEvent
  | HookRunEvent

export function nowIso(): string {
  return new Date().toISOString()
}
