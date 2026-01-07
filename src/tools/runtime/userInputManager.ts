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
}

type PendingRequest = {
  promise: Promise<AskUserAnswers>
  resolve: (answers: AskUserAnswers) => void
  reject: (error: Error) => void
  cleanup: () => void
}

export function createUserInputManager(): UserInputManager {
  const pending = new Map<string, PendingRequest>()
  const bufferedAnswers = new Map<string, AskUserAnswers>()

  function requestAnswers(args: {
    toolUseId: string
    questions: AskUserQuestion[]
    signal?: AbortSignal
  }): Promise<AskUserAnswers> {
    const existing = pending.get(args.toolUseId)
    if (existing) return existing.promise

    const buffered = bufferedAnswers.get(args.toolUseId)
    if (buffered) {
      bufferedAnswers.delete(args.toolUseId)
      return Promise.resolve(buffered)
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
    const req = pending.get(toolUseId)
    if (!req) {
      bufferedAnswers.set(toolUseId, answers)
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

  return {
    requestAnswers,
    submitAnswers,
    reject: rejectRequest,
  }
}
