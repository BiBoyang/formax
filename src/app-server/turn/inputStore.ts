import { createHash } from 'node:crypto'
import type {
  ApprovalInputPayload,
  AskUserQuestionInputPayload,
  InputKind,
  InputResolvedPayload,
  InputResolvedStatus,
  InputRequestedPayload,
  TurnInputSubmitStatus,
} from '../protocol/input.js'
import { createInputId } from './inputId.js'

type PendingInputRecord = {
  inputId: string
  threadId: string
  turnId: string
  toolUseId: string
  kind: InputKind
  status: 'pending'
  createdAt: string
  expiresAt: string
  payload: ApprovalInputPayload | AskUserQuestionInputPayload
}

type ResolvedInputRecord = Omit<InputResolvedPayload, 'reason'> & {
  reason?: string
  answersHash?: string
  submissionIds: Set<string>
}

export type InputRecord = PendingInputRecord | ResolvedInputRecord

export type InputStoreOptions = {
  threadId: string
  turnId: string
  defaultInputTtlMs?: number
  maxPendingInputs?: number
}

type SubmitInputResult = {
  accepted: boolean
  status: TurnInputSubmitStatus
  transition?: InputResolvedPayload
  toolUseId?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizePositiveLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  return rounded >= 1 ? rounded : fallback
}

function expiresAtFrom(createdAtIso: string, ttlMs: number): string {
  const createdAt = Date.parse(createdAtIso)
  return new Date(createdAt + ttlMs).toISOString()
}

function hashAnswers(answers: Record<string, string>): string {
  const canonical = Object.keys(answers)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${JSON.stringify(answers[k])}`)
    .join('|')
  return createHash('sha256').update(canonical).digest('hex')
}

function toResolvedPayload(record: ResolvedInputRecord): InputResolvedPayload {
  return {
    inputId: record.inputId,
    threadId: record.threadId,
    turnId: record.turnId,
    toolUseId: record.toolUseId,
    kind: record.kind,
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    resolvedAt: record.resolvedAt,
    ...(record.reason ? { reason: record.reason } : {}),
  }
}

function isPending(record: InputRecord): record is PendingInputRecord {
  return record.status === 'pending'
}

export class TurnInputStore {
  private readonly threadId: string
  private readonly turnId: string
  private readonly defaultInputTtlMs: number
  private readonly maxPendingInputs: number
  private readonly byInputId = new Map<string, InputRecord>()
  private readonly inputIdByToolUseId = new Map<string, string[]>()
  private readonly collisionCounter = new Map<string, number>()

  constructor(args: InputStoreOptions) {
    this.threadId = args.threadId
    this.turnId = args.turnId
    this.defaultInputTtlMs = normalizePositiveLimit(args.defaultInputTtlMs, 5 * 60_000)
    this.maxPendingInputs = normalizePositiveLimit(args.maxPendingInputs, 32)
  }

  createPendingInput(args: {
    toolUseId: string
    kind: InputKind
    payload: ApprovalInputPayload | AskUserQuestionInputPayload
  }): InputRequestedPayload {
    if (this.getPendingInputCount() >= this.maxPendingInputs) {
      throw new Error(`Pending input limit exceeded (${this.maxPendingInputs})`)
    }

    const baseId = createInputId({
      turnId: this.turnId,
      toolUseId: args.toolUseId,
      kind: args.kind,
    })
    const index = this.collisionCounter.get(baseId) ?? 0
    this.collisionCounter.set(baseId, index + 1)
    const inputId = index === 0 ? baseId : `${baseId}:${index + 1}`
    const createdAt = nowIso()
    const expiresAt = expiresAtFrom(createdAt, this.defaultInputTtlMs)

    const record: PendingInputRecord = {
      inputId,
      threadId: this.threadId,
      turnId: this.turnId,
      toolUseId: args.toolUseId,
      kind: args.kind,
      status: 'pending',
      createdAt,
      expiresAt,
      payload: args.payload,
    }
    this.byInputId.set(inputId, record)
    const ids = this.inputIdByToolUseId.get(record.toolUseId) ?? []
    ids.push(inputId)
    this.inputIdByToolUseId.set(record.toolUseId, ids)

    return {
      inputId,
      threadId: record.threadId,
      turnId: record.turnId,
      toolUseId: record.toolUseId,
      kind: record.kind,
      status: 'pending',
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      payload: record.payload,
    }
  }

  submitInput(args: {
    inputId: string
    answers: Record<string, string>
    submissionId?: string
    now?: string
  }): SubmitInputResult {
    const record = this.byInputId.get(args.inputId)
    if (!record) return { accepted: false, status: 'not_pending' }

    if (isPending(record)) {
      const now = args.now ?? nowIso()
      if (Date.parse(now) > Date.parse(record.expiresAt)) {
        const expired = this.resolveRecord(record, 'expired', now, 'input_expired')
        return { accepted: false, status: 'expired', transition: expired, toolUseId: record.toolUseId }
      }

      const answersHash = hashAnswers(args.answers)
      const submissionIds = new Set<string>()
      if (args.submissionId) submissionIds.add(args.submissionId)
      const submitted: ResolvedInputRecord = {
        inputId: record.inputId,
        threadId: record.threadId,
        turnId: record.turnId,
        toolUseId: record.toolUseId,
        kind: record.kind,
        status: 'submitted',
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        resolvedAt: now,
        answersHash,
        submissionIds,
      }
      this.byInputId.set(record.inputId, submitted)
      return {
        accepted: true,
        status: 'accepted',
        transition: toResolvedPayload(submitted),
        toolUseId: record.toolUseId,
      }
    }

    const answersHash = hashAnswers(args.answers)
    if (record.status === 'submitted') {
      if (args.submissionId && record.submissionIds.has(args.submissionId)) {
        if (record.answersHash === answersHash) return { accepted: true, status: 'already_submitted_same' }
        return { accepted: false, status: 'conflict_already_submitted' }
      }

      if (record.answersHash === answersHash) {
        if (args.submissionId) record.submissionIds.add(args.submissionId)
        return { accepted: true, status: 'already_submitted_same' }
      }

      return { accepted: false, status: 'conflict_already_submitted' }
    }

    if (record.status === 'expired') return { accepted: false, status: 'expired' }
    if (record.status === 'canceled') return { accepted: false, status: 'canceled' }
    return { accepted: false, status: 'not_pending' }
  }

  hasInput(inputId: string): boolean {
    return this.byInputId.has(inputId)
  }

  resolveInputIdFromToolUseId(toolUseId: string): string | null {
    const ids = this.inputIdByToolUseId.get(toolUseId)
    if (!ids || ids.length === 0) return null

    for (let i = ids.length - 1; i >= 0; i -= 1) {
      const inputId = ids[i]
      const record = this.byInputId.get(inputId)
      if (!record) continue
      if (record.status === 'pending') return inputId
    }

    return ids[ids.length - 1] ?? null
  }

  resolveAllPending(args: { status: Exclude<InputResolvedStatus, 'submitted'>; reason?: string }): InputResolvedPayload[] {
    const resolved: InputResolvedPayload[] = []
    const at = nowIso()
    for (const record of this.byInputId.values()) {
      if (!isPending(record)) continue
      resolved.push(this.resolveRecord(record, args.status, at, args.reason))
    }
    return resolved
  }

  private getPendingInputCount(): number {
    let count = 0
    for (const record of this.byInputId.values()) {
      if (record.status === 'pending') count += 1
    }
    return count
  }

  private resolveRecord(
    record: PendingInputRecord,
    status: Exclude<InputResolvedStatus, 'submitted'>,
    resolvedAt: string,
    reason?: string,
  ): InputResolvedPayload {
    const resolved: ResolvedInputRecord = {
      inputId: record.inputId,
      threadId: record.threadId,
      turnId: record.turnId,
      toolUseId: record.toolUseId,
      kind: record.kind,
      status,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      resolvedAt,
      submissionIds: new Set<string>(),
      ...(reason ? { reason } : {}),
    }
    this.byInputId.set(record.inputId, resolved)
    return toResolvedPayload(resolved)
  }
}
