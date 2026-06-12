import type { InteractivePromptDescriptor } from './interactivePromptDescriptor.js'

export type AskUserQuestionOption = {
  label: string
  description: string
}

export type AskUserQuestion = {
  question: string
  header: string
  fieldId?: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

export type AskUserAnswers = Record<string, string>

export type UserInputManager = {
  requestAnswers: (args: {
    toolUseId: string
    questions: AskUserQuestion[]
    signal?: AbortSignal
    descriptor?: InteractivePromptDescriptor
  }) => Promise<AskUserAnswers>
  submitAnswers: (toolUseId: string, answers: AskUserAnswers) => boolean
  reject: (toolUseId: string, error: Error) => boolean
  rejectAllPending: (error: Error) => number
  isPending: (toolUseId: string) => boolean
  clearBufferedAnswers: () => void
  getPendingToolUseIds?: () => string[]
  getActivePrompt?: () => InteractivePromptDescriptor | null
  subscribe?: (listener: () => void) => () => void
}

type PendingRequest = {
  promise: Promise<AskUserAnswers>
  resolve: (answers: AskUserAnswers) => void
  reject: (error: Error) => void
  cleanup: () => void
  descriptor?: InteractivePromptDescriptor
}

export function createUserInputManager(): UserInputManager {
  const pending = new Map<string, PendingRequest>()
  const pendingOrder: string[] = []
  const listeners = new Set<() => void>()
  type BufferedEntry = { answers: AskUserAnswers; ts: number }
  const bufferedAnswers = new Map<string, BufferedEntry>()
  const MAX_BUFFERED = 50
  const BUFFER_TTL_MS = 60_000

  function notifyChanged(): void {
    for (const listener of listeners) listener()
  }

  function removePendingOrder(toolUseId: string): void {
    const index = pendingOrder.indexOf(toolUseId)
    if (index >= 0) pendingOrder.splice(index, 1)
  }

  function pruneBuffered(now = Date.now()): void {
    for (const [id, entry] of bufferedAnswers) {
      if (now - entry.ts > BUFFER_TTL_MS) bufferedAnswers.delete(id)
    }

    if (bufferedAnswers.size <= MAX_BUFFERED) return
    const toDelete = bufferedAnswers.size - MAX_BUFFERED
    const idsToDelete = Array.from(bufferedAnswers.keys()).slice(0, toDelete)
    for (const id of idsToDelete) {
      bufferedAnswers.delete(id)
    }
  }

  function requestAnswers(args: {
    toolUseId: string
    questions: AskUserQuestion[]
    signal?: AbortSignal
    descriptor?: InteractivePromptDescriptor
  }): Promise<AskUserAnswers> {
    pruneBuffered()
    const existing = pending.get(args.toolUseId)
    if (existing) return existing.promise

    const buffered = bufferedAnswers.get(args.toolUseId)
    if (buffered) {
      bufferedAnswers.delete(args.toolUseId)
      return Promise.resolve(buffered.answers)
    }

    if (args.signal?.aborted) {
      return Promise.reject(new Error('Request aborted'))
    }

    let resolve!: (answers: AskUserAnswers) => void
    let reject!: (error: Error) => void

    const promise = new Promise<AskUserAnswers>((res, rej) => {
      resolve = res
      reject = (e) => rej(e)
    })

    const request: PendingRequest = {
      promise,
      resolve,
      reject,
      cleanup: () => {},
      ...(args.descriptor ? { descriptor: snapshotInteractivePromptDescriptor(args.descriptor) } : {}),
    }

    if (args.signal) {
      const onAbort = () => {
        pending.delete(args.toolUseId)
        request.cleanup()
        removePendingOrder(args.toolUseId)
        notifyChanged()
        reject(new Error('Request aborted'))
      }
      args.signal.addEventListener('abort', onAbort, { once: true })
      request.cleanup = () => args.signal?.removeEventListener('abort', onAbort)
    }

    pending.set(args.toolUseId, request)
    pendingOrder.push(args.toolUseId)
    notifyChanged()
    return promise
  }

  function submitAnswers(toolUseId: string, answers: AskUserAnswers): boolean {
    pruneBuffered()
    const req = pending.get(toolUseId)
    if (!req) {
      bufferedAnswers.set(toolUseId, { answers, ts: Date.now() })
      pruneBuffered()
      return true
    }
    pending.delete(toolUseId)
    req.cleanup()
    removePendingOrder(toolUseId)
    notifyChanged()
    req.resolve(answers)
    return true
  }

  function rejectRequest(toolUseId: string, error: Error): boolean {
    const req = pending.get(toolUseId)
    if (!req) return false
    pending.delete(toolUseId)
    req.cleanup()
    removePendingOrder(toolUseId)
    notifyChanged()
    req.reject(error)
    return true
  }

  function rejectAllPending(error: Error): number {
    const ids = Array.from(pending.keys())
    for (const id of ids) {
      rejectRequest(id, error)
    }
    return ids.length
  }

  function clearBufferedAnswers(): void {
    bufferedAnswers.clear()
  }

  function isPending(toolUseId: string): boolean {
    return pending.has(toolUseId)
  }

  function getPendingToolUseIds(): string[] {
    return pendingOrder.filter((id) => pending.has(id))
  }

  function getActivePrompt(): InteractivePromptDescriptor | null {
    const id = getPendingToolUseIds()[0]
    if (!id) return null
    return pending.get(id)?.descriptor ?? null
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    listener()
    return () => {
      listeners.delete(listener)
    }
  }

  return {
    requestAnswers,
    submitAnswers,
    reject: rejectRequest,
    rejectAllPending,
    isPending,
    clearBufferedAnswers,
    getPendingToolUseIds,
    getActivePrompt,
    subscribe,
  }
}

function snapshotQuestions(questions: AskUserQuestion[]): AskUserQuestion[] {
  return questions.map((question) => ({
    question: question.question,
    header: question.header,
    ...(question.fieldId !== undefined ? { fieldId: question.fieldId } : {}),
    multiSelect: question.multiSelect,
    options: question.options.map((option) => ({
      label: option.label,
      description: option.description,
    })),
  }))
}

function snapshotInteractivePromptDescriptor(descriptor: InteractivePromptDescriptor): InteractivePromptDescriptor {
  if (descriptor.kind === 'ask_user_question') {
    const questions = snapshotQuestions(descriptor.questions)
    return {
      kind: 'ask_user_question',
      questions,
      requestEvent: {
        ...descriptor.requestEvent,
        questions,
      },
      ...(descriptor.emitToolUpdate !== undefined ? { emitToolUpdate: descriptor.emitToolUpdate } : {}),
      ...(descriptor.ui ? { ui: { ...descriptor.ui } } : {}),
      ...(descriptor.promptData ? { promptData: snapshotValue(descriptor.promptData) } : {}),
    }
  }

  return {
    kind: 'approval',
    requestEvent: {
      ...descriptor.requestEvent,
      action: snapshotValue(descriptor.requestEvent.action),
      effectiveDecision: snapshotValue(descriptor.requestEvent.effectiveDecision),
      ...(descriptor.requestEvent.suggestions ? { suggestions: [...descriptor.requestEvent.suggestions] } : {}),
      ...(descriptor.requestEvent.workspaceRequest
        ? { workspaceRequest: snapshotValue(descriptor.requestEvent.workspaceRequest) }
        : descriptor.requestEvent.workspaceRequest === null
          ? { workspaceRequest: null }
          : {}),
    },
    ...(descriptor.questions ? { questions: snapshotQuestions(descriptor.questions) } : {}),
    ...(descriptor.emitToolUpdate !== undefined ? { emitToolUpdate: descriptor.emitToolUpdate } : {}),
    ...(descriptor.ui ? { ui: { ...descriptor.ui } } : {}),
    ...(descriptor.promptData ? { promptData: snapshotValue(descriptor.promptData) } : {}),
  }
}

function snapshotValue<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') return value
  const structuredClone = (globalThis as { structuredClone?: <V>(value: V) => V }).structuredClone
  if (structuredClone) {
    try {
      return structuredClone(value)
    } catch {
      // Fall through to JSON/plain-object snapshot for values that structuredClone cannot copy.
    }
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    if (Array.isArray(value)) return [...value] as T
    return { ...(value as Record<string, unknown>) } as T
  }
}
