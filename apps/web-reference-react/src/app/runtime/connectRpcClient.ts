import { RpcClient, type RpcClientQueueMetrics } from '../../rpcClient'
import type { AppAction } from '../../store'
import type { RpcNotification } from '../../types'
import { createTurnEventCursorState } from '../../turnEventCursor'
import type { RpcQueueRuntimeConfig } from '../core/rpcQueueConfig'
import { initializeRuntime } from './initializeRuntime'
import { createConnectionInitOrchestrator } from './orchestrator/connectionInitOrchestrator'

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
  onQueueMetrics?: (metrics: RpcClientQueueMetrics) => void
  rpcQueueConfig?: RpcQueueRuntimeConfig
}

export function connectRpcClient(args: ConnectRpcClientArgs): () => void {
  const client = new RpcClient(args.rpcQueueConfig)
  args.clientRef.current = client
  const initializeOrchestrator = createConnectionInitOrchestrator({
    seenEventCap: args.seenEventCap,
    eventCursorRef: args.eventCursorRef,
    runInitialize: ({ shouldContinue }) =>
      initializeRuntime({
        initializeHandshake: args.initializeHandshake,
        refreshThreads: args.refreshThreads,
        refreshWorkspaceDiff: args.refreshWorkspaceDiff,
        activeThreadIdRef: args.activeThreadIdRef,
        resumeThreadInputs: args.resumeThreadInputs,
        replayThreadEvents: args.replayThreadEvents,
        shouldContinue,
      }),
    captureError: args.captureError,
    isCurrentClient: () => args.clientRef.current === client,
  })

  client.connect(args.bridgeUrl, {
    onStatus: (connectionStatus) => {
      args.dispatch({ type: 'set_connection_status', status: connectionStatus })
      initializeOrchestrator.onStatus(connectionStatus)
    },
    onNotification: args.handleNotification,
    onError: (error) => {
      args.captureError('transport', error)
    },
    onQueueMetrics: args.onQueueMetrics,
  })

  return () => {
    initializeOrchestrator.dispose()
    client.disconnect()
    args.clientRef.current = null
  }
}
