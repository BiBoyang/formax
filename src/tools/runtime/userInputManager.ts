export type AskUserQuestionOption = {
  label: string
  description: string
}

export type AskUserQuestion = {
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

export type AskUserAnswers = Record<string, string>

export type UserInputManager = {
  requestAnswers: (args: {
    toolUseId: string
    questions: AskUserQuestion[]
    signal?: AbortSignal
  }) => Promise<AskUserAnswers>
  submitAnswers: (toolUseId: string, answers: AskUserAnswers) => boolean
  reject: (toolUseId: string, error: Error) => boolean
  rejectAllPending: (error: Error) => number
  isPending: (toolUseId: string) => boolean
  clearBufferedAnswers: () => void
}

type PendingRequest = {
  promise: Promise<AskUserAnswers>
  resolve: (answers: AskUserAnswers) => void
  reject: (error: Error) => void
  cleanup: () => void
}

export function createUserInputManager(): UserInputManager {
  const pending = new Map<string, PendingRequest>()
  type BufferedEntry = { answers: AskUserAnswers; ts: number }
  const bufferedAnswers = new Map<string, BufferedEntry>()
  const MAX_BUFFERED = 50
  const BUFFER_TTL_MS = 60_000

  function pruneBuffered(now = Date.now()): void {
    for (const [id, entry] of bufferedAnswers) {
      if (now - entry.ts > BUFFER_TTL_MS) bufferedAnswers.delete(id)
    }

    if (bufferedAnswers.size <= MAX_BUFFERED) return
    let toDelete = bufferedAnswers.size - MAX_BUFFERED
    for (const id of bufferedAnswers.keys()) {
      bufferedAnswers.delete(id)
      toDelete -= 1
      if (toDelete <= 0) break
    }
  }

  function requestAnswers(args: {
    toolUseId: string
    questions: AskUserQuestion[]
    signal?: AbortSignal
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
    }

    if (args.signal) {
      const onAbort = () => {
        pending.delete(args.toolUseId)
        request.cleanup()
        reject(new Error('Request aborted'))
      }
      args.signal.addEventListener('abort', onAbort, { once: true })
      request.cleanup = () => args.signal?.removeEventListener('abort', onAbort)
    }

    pending.set(args.toolUseId, request)
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
    req.resolve(answers)
    return true
  }

  function rejectRequest(toolUseId: string, error: Error): boolean {
    const req = pending.get(toolUseId)
    if (!req) return false
    pending.delete(toolUseId)
    req.cleanup()
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

  return {
    requestAnswers,
    submitAnswers,
    reject: rejectRequest,
    rejectAllPending,
    isPending,
    clearBufferedAnswers,
  }
}
