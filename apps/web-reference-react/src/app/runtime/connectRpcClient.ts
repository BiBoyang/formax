import { RpcClient } from '../../rpcClient'
import { createTurnEventCursorState } from '../../turnEventCursor'
import { initializeRuntime } from './initializeRuntime'

export type ConnectRpcClientArgs = {
  bridgeUrl: string
  seenEventCap: number
  dispatch: (action: any) => void
  clientRef: { current: RpcClient | null }
  eventCursorRef: { current: ReturnType<typeof createTurnEventCursorState> }
  initializeHandshake: () => Promise<void>
  refreshThreads: () => Promise<void>
  refreshWorkspaceDiff: () => Promise<void>
  resumeThreadInputs: (threadId: string) => Promise<void>
  replayThreadEvents: (threadId: string, options?: { fromStart?: boolean }) => Promise<boolean>
  activeThreadIdRef: { current: string | null }
  handleNotification: (notification: any) => void
  captureError: (method: string, error: unknown) => unknown
}

export function connectRpcClient(args: ConnectRpcClientArgs): () => void {
  const client = new RpcClient()
  args.clientRef.current = client

  client.connect(args.bridgeUrl, {
    onStatus: (connectionStatus) => {
      args.dispatch({ type: 'set_connection_status', status: connectionStatus })
      if (connectionStatus !== 'connected') return

      args.eventCursorRef.current = createTurnEventCursorState(args.seenEventCap)
      void initializeRuntime({
        initializeHandshake: args.initializeHandshake,
        refreshThreads: args.refreshThreads,
        refreshWorkspaceDiff: args.refreshWorkspaceDiff,
        activeThreadIdRef: args.activeThreadIdRef,
        resumeThreadInputs: args.resumeThreadInputs,
        replayThreadEvents: args.replayThreadEvents,
      }).catch((error) => {
        args.captureError('initialize', error)
      })
    },
    onNotification: args.handleNotification,
    onError: (error) => {
      args.captureError('transport', error)
    },
  })

  return () => {
    client.disconnect()
    args.clientRef.current = null
  }
}
