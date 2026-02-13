import { RpcClient } from '../../rpcClient'
import { createTurnEventCursorState } from '../../turnEventCursor'

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
      void args
        .initializeHandshake()
        .then(async () => {
          await Promise.all([args.refreshThreads(), args.refreshWorkspaceDiff()])
          const activeThreadId = args.activeThreadIdRef.current
          if (!activeThreadId) return
          await args.resumeThreadInputs(activeThreadId)
          await args.replayThreadEvents(activeThreadId)
        })
        .catch((error) => {
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
