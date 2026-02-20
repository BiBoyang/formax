import { RpcClient } from '../../rpcClient'
import type { ConnectionStatus } from '../../rpcClient'
import type { AppAction } from '../../store'
import type { RpcNotification } from '../../types'
import { createTurnEventCursorState } from '../../turnEventCursor'
import { initializeRuntime } from './initializeRuntime'

export type ConnectRpcClientArgs = {
  bridgeUrl: string
  seenEventCap: number
  dispatch: (action: AppAction) => void
  clientRef: { current: RpcClient | null }
  eventCursorRef: { current: ReturnType<typeof createTurnEventCursorState> }
  initializeHandshake: () => Promise<void>
  refreshThreads: () => Promise<void>
  refreshWorkspaceDiff: () => Promise<void>
  resumeThreadInputs: (threadId: string) => Promise<void>
  replayThreadEvents: (threadId: string, options?: { fromStart?: boolean }) => Promise<boolean>
  activeThreadIdRef: { current: string | null }
  handleNotification: (notification: RpcNotification) => void
  captureError: (method: string, error: unknown) => unknown
}

export function connectRpcClient(args: ConnectRpcClientArgs): () => void {
  const client = new RpcClient()
  args.clientRef.current = client
  let latestStatus: ConnectionStatus = 'disconnected'
  let connectedEpoch = 0
  let initializeInFlight: Promise<void> | null = null
  let initializePending = false

  const shouldContinueForEpoch = (epoch: number): boolean => {
    return latestStatus === 'connected' && connectedEpoch === epoch && args.clientRef.current === client
  }

  const runInitializeLoop = () => {
    if (initializeInFlight) return
    initializeInFlight = (async () => {
      while (initializePending && latestStatus === 'connected') {
        initializePending = false
        const epoch = connectedEpoch
        try {
          await initializeRuntime({
            initializeHandshake: args.initializeHandshake,
            refreshThreads: args.refreshThreads,
            refreshWorkspaceDiff: args.refreshWorkspaceDiff,
            activeThreadIdRef: args.activeThreadIdRef,
            resumeThreadInputs: args.resumeThreadInputs,
            replayThreadEvents: args.replayThreadEvents,
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

  client.connect(args.bridgeUrl, {
    onStatus: (connectionStatus) => {
      latestStatus = connectionStatus
      args.dispatch({ type: 'set_connection_status', status: connectionStatus })
      if (connectionStatus !== 'connected') return

      connectedEpoch += 1
      args.eventCursorRef.current = createTurnEventCursorState(args.seenEventCap)
      initializePending = true
      runInitializeLoop()
    },
    onNotification: args.handleNotification,
    onError: (error) => {
      args.captureError('transport', error)
    },
  })

  return () => {
    latestStatus = 'disconnected'
    initializePending = false
    client.disconnect()
    args.clientRef.current = null
  }
}
