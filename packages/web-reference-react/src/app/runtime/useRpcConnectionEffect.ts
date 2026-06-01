/**
 * RPC Connection Lifecycle Management
 *
 * 封装 RPC 连接的生命周期管理：
 * 1. 初始化 RPC 客户端（connectRpcClient）
 * 2. 处理握手（initializeHandshake）
 * 3. 处理通知（handleNotification）
 * 4. 处理重放（replayThreadEvents）
 *
 * @returns { clientRef, eventCursorRef }
 */

import { useEffect } from 'react'
import type { ConnectRpcClientArgs } from './connectRpcClient'
import { connectRpcClient } from './connectRpcClient'

export interface RpcConnectionEffectDeps {
  bridgeUrl: string
  seenEventCap: number
  dispatch: ConnectRpcClientArgs['dispatch']
  initializeHandshake: ConnectRpcClientArgs['initializeHandshake']
  loadRuntimeDefaults?: ConnectRpcClientArgs['loadRuntimeDefaults']
  refreshThreads: ConnectRpcClientArgs['refreshThreads']
  refreshWorkspaceDiff: ConnectRpcClientArgs['refreshWorkspaceDiff']
  resumeThreadInputs: ConnectRpcClientArgs['resumeThreadInputs']
  replayThreadEvents: ConnectRpcClientArgs['replayThreadEvents']
  activeThreadIdRef: ConnectRpcClientArgs['activeThreadIdRef']
  handleNotification: ConnectRpcClientArgs['handleNotification']
  captureError: ConnectRpcClientArgs['captureError']
  onQueueMetrics?: ConnectRpcClientArgs['onQueueMetrics']
  rpcQueueConfig?: ConnectRpcClientArgs['rpcQueueConfig']
  clientRef: ConnectRpcClientArgs['clientRef']
  eventCursorRef: ConnectRpcClientArgs['eventCursorRef']
}

export function useRpcConnectionEffect(deps: RpcConnectionEffectDeps) {
  useEffect(() => {
    return connectRpcClient({
      bridgeUrl: deps.bridgeUrl,
      seenEventCap: deps.seenEventCap,
      dispatch: deps.dispatch,
      clientRef: deps.clientRef,
      eventCursorRef: deps.eventCursorRef,
      initializeHandshake: deps.initializeHandshake,
      loadRuntimeDefaults: deps.loadRuntimeDefaults,
      refreshThreads: deps.refreshThreads,
      refreshWorkspaceDiff: deps.refreshWorkspaceDiff,
      resumeThreadInputs: deps.resumeThreadInputs,
      replayThreadEvents: deps.replayThreadEvents,
      activeThreadIdRef: deps.activeThreadIdRef,
      handleNotification: deps.handleNotification,
      captureError: deps.captureError,
      onQueueMetrics: deps.onQueueMetrics,
      rpcQueueConfig: deps.rpcQueueConfig,
    })
  }, [
    deps.bridgeUrl,
    deps.captureError,
    deps.handleNotification,
    deps.initializeHandshake,
    deps.loadRuntimeDefaults,
    deps.onQueueMetrics,
    deps.rpcQueueConfig,
    deps.refreshThreads,
    deps.refreshWorkspaceDiff,
    deps.replayThreadEvents,
    deps.resumeThreadInputs,
    deps.activeThreadIdRef,
  ])
}
