type FlushableWriter = {
  flush?: () => Promise<void>
}

type ProcessLike = {
  pid: number
  on: NodeJS.Process['on']
  off: NodeJS.Process['off']
  kill: NodeJS.Process['kill']
  exit: NodeJS.Process['exit']
  exitCode: number | undefined
}

export function registerSessionWriterProcessHandlers(args: {
  sessionSaveEnabled: boolean
  isVitest: boolean
  getWriter: () => FlushableWriter | null
  processRef?: ProcessLike
  logError?: (value: unknown) => void
}): () => void {
  if (!args.sessionSaveEnabled || args.isVitest) return () => {}

  const proc = args.processRef ?? (process as ProcessLike)
  const logError = args.logError ?? ((value: unknown) => console.error(value))

  const flushBestEffort = async () => {
    try {
      await args.getWriter()?.flush?.()
    } catch {
      // ignore
    }
  }

  const forwardSignal = (signal: NodeJS.Signals) => {
    const handler = () => {
      proc.off(signal, handler)
      void flushBestEffort().finally(() => {
        try {
          proc.kill(proc.pid, signal)
        } catch {
          // ignore
        }
      })
    }
    proc.on(signal, handler)
    return () => proc.off(signal, handler)
  }

  const offSigInt = forwardSignal('SIGINT')
  const offSigTerm = forwardSignal('SIGTERM')

  const onBeforeExit = () => {
    void flushBestEffort()
  }
  proc.on('beforeExit', onBeforeExit)

  const onUncaught = (error: unknown) => {
    void (async () => {
      await flushBestEffort()
      logError(error)
      proc.exitCode = 1
      proc.exit()
    })()
  }
  proc.on('uncaughtException', onUncaught)

  const onUnhandled = (reason: unknown) => {
    void (async () => {
      await flushBestEffort()
      logError(reason)
      proc.exitCode = 1
      proc.exit()
    })()
  }
  proc.on('unhandledRejection', onUnhandled)

  return () => {
    offSigInt()
    offSigTerm()
    proc.off('beforeExit', onBeforeExit)
    proc.off('uncaughtException', onUncaught)
    proc.off('unhandledRejection', onUnhandled)
  }
}
