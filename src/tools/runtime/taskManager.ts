import { randomUUID } from 'node:crypto'

export type ManagedTaskStatus = 'running' | 'completed' | 'error'

export type ManagedTaskKind = 'agent' | 'shell' | 'other'

export type ManagedTaskResult = {
  content: string
  is_error?: boolean
}

export type ManagedTaskRunContext = {
  id: string
  signal: AbortSignal
  updateResult: (result: ManagedTaskResult) => void
  setCancel: (cancel: () => void) => void
}

export type ManagedTaskSnapshot = {
  id: string
  kind: ManagedTaskKind
  label?: string
  status: ManagedTaskStatus
  result?: ManagedTaskResult
  createdAt: Date
  updatedAt: Date
}

type InternalTask = ManagedTaskSnapshot & {
  done: Promise<void>
  resolveDone: () => void
  abortController: AbortController
  cancel?: () => void
  cancelMessage?: string
}

export class TaskManager {
  private tasks = new Map<string, InternalTask>()

  create(args: {
    kind?: ManagedTaskKind
    label?: string
    run: (ctx: ManagedTaskRunContext) => Promise<ManagedTaskResult>
  }): string {
    const id = randomUUID()

    let resolveDone!: () => void
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })

    const abortController = new AbortController()

    const now = new Date()
    const task: InternalTask = {
      id,
      kind: args.kind ?? 'other',
      label: args.label,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      done,
      resolveDone,
      abortController,
    }

    this.tasks.set(id, task)

    ;(async () => {
      try {
        const result = await args.run({
          id,
          signal: abortController.signal,
          updateResult: (r) => {
            task.result = r
            task.updatedAt = new Date()
          },
          setCancel: (cancel) => {
            task.cancel = cancel
          },
        })
        task.result = result
        task.status = result.is_error ? 'error' : 'completed'
      } catch (e) {
        if (abortController.signal.aborted) {
          const msg = task.cancelMessage || 'Request aborted'
          task.result = { content: msg, is_error: true }
          task.status = 'error'
        } else {
          const msg = e instanceof Error ? e.message : String(e)
          task.result = { content: `Error: ${msg}`, is_error: true }
          task.status = 'error'
        }
      } finally {
        task.updatedAt = new Date()
        task.resolveDone()
      }
    })()

    return id
  }

  cancel(taskId: string, opts?: { message?: string }): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false
    if (task.status !== 'running') return false

    task.cancelMessage = opts?.message
    try {
      task.cancel?.()
    } catch {
      // ignore
    }
    task.abortController.abort()
    task.updatedAt = new Date()
    return true
  }

  get(taskId: string): ManagedTaskSnapshot | undefined {
    const task = this.tasks.get(taskId)
    if (!task) return undefined
    return {
      id: task.id,
      kind: task.kind,
      label: task.label,
      status: task.status,
      result: task.result,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }
  }

  list(): ManagedTaskSnapshot[] {
    return Array.from(this.tasks.values())
      .map((t) => this.get(t.id)!)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  async wait(
    taskId: string,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<{ snapshot: ManagedTaskSnapshot; timedOut: boolean }> {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`Task '${taskId}' not found`)
    }

    if (task.status !== 'running') {
      return { snapshot: this.get(taskId)!, timedOut: false }
    }

    const timeoutMs = typeof opts?.timeoutMs === 'number' ? opts.timeoutMs : 30000

    const { promise: aborted, cancel: cancelAbort } = opts?.signal
      ? abortPromise(opts.signal)
      : { promise: new Promise<'abort'>(() => {}), cancel: () => {} }

    const { promise: timeout, cancel: cancelTimeout } =
      timeoutMs >= 0 ? timeoutPromise(timeoutMs) : { promise: new Promise<'timeout'>(() => {}), cancel: () => {} }

    let outcome: 'done' | 'timeout' | 'abort' = 'done'
    try {
      outcome = await Promise.race([
        task.done.then(() => 'done' as const),
        timeout,
        aborted,
      ])
    } finally {
      cancelAbort()
      cancelTimeout()
    }

    if (outcome === 'abort') throw new Error('Request aborted')

    const snapshot = this.get(taskId)!
    const timedOut = outcome === 'timeout' && snapshot.status === 'running'
    return { snapshot, timedOut }
  }
}

function abortPromise(signal: AbortSignal): { promise: Promise<'abort'>; cancel: () => void } {
  if (signal.aborted) {
    return { promise: Promise.resolve('abort'), cancel: () => {} }
  }

  let onAbort!: () => void
  const promise = new Promise<'abort'>((resolve) => {
    onAbort = () => resolve('abort')
    signal.addEventListener('abort', onAbort, { once: true })
  })

  return {
    promise,
    cancel: () => {
      signal.removeEventListener('abort', onAbort)
    },
  }
}

function timeoutPromise(ms: number): { promise: Promise<'timeout'>; cancel: () => void } {
  let timer: NodeJS.Timeout | null = null
  const promise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  return { promise, cancel: () => timer && clearTimeout(timer) }
}
