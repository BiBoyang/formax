import type { ConnectionStatus } from '../../../rpcClient'
import { createTurnEventCursorState } from '../../../turnEventCursor'

export type ConnectionInitOrchestrator = {
  onStatus: (status: ConnectionStatus) => void
  dispose: () => void
}

export type CreateConnectionInitOrchestratorArgs = {
  seenEventCap: number
  eventCursorRef: { current: ReturnType<typeof createTurnEventCursorState> }
  runInitialize: (args: { shouldContinue: () => boolean }) => Promise<void>
  captureError: (method: string, error: unknown) => unknown
  isCurrentClient: () => boolean
}

export function createConnectionInitOrchestrator(
  args: CreateConnectionInitOrchestratorArgs,
): ConnectionInitOrchestrator {
  let latestStatus: ConnectionStatus = 'disconnected'
  let connectedEpoch = 0
  let initializeInFlight: Promise<void> | null = null
  let initializePending = false

  const shouldContinueForEpoch = (epoch: number): boolean => {
    return latestStatus === 'connected' && connectedEpoch === epoch && args.isCurrentClient()
  }

  const runInitializeLoop = () => {
    if (initializeInFlight) return
    initializeInFlight = (async () => {
      while (initializePending && latestStatus === 'connected') {
        initializePending = false
        const epoch = connectedEpoch
        try {
          await args.runInitialize({
            shouldContinue: () => shouldContinueForEpoch(epoch),
          })
        } catch (error) {
          args.captureError('initialize', error)
        }
      }
    })().finally(() => {
      initializeInFlight = null
      if (initializePending && latestStatus === 'connected') {
        runInitializeLoop()
      }
    })
  }

  const onStatus = (status: ConnectionStatus) => {
    latestStatus = status
    if (status !== 'connected') return

    connectedEpoch += 1
    args.eventCursorRef.current = createTurnEventCursorState(args.seenEventCap)
    initializePending = true
    runInitializeLoop()
  }

  const dispose = () => {
    latestStatus = 'disconnected'
    initializePending = false
  }

  return {
    onStatus,
    dispose,
  }
}
