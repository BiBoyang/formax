import { useEffect, type Dispatch } from 'react'
import type { AppAction } from '../../store'
import type { RpcClient, RpcClientQueueMetrics } from '../../rpcClient'

type DevInputBaseOverrides = {
  inputId?: string
  threadId?: string
  turnId?: string
  toolUseId?: string
}

type DevApprovalOverrides = DevInputBaseOverrides & {
  toolName?: string
  action?: unknown
  effectiveDecision?: unknown
  suggestions?: string[]
  workspaceRequest?: { dir: string } | null
}

type DevApiWindow = Window & {
  __formaxDevAskUserQuestion?: (overrides?: DevInputBaseOverrides) => string
  __formaxDevApprovalInput?: (overrides?: DevApprovalOverrides) => string
  __formaxDevClearPendingInputs?: () => void
  __formaxDevRpcQueueMetrics?: () => RpcClientQueueMetrics | null
  __formaxDevRpcBurst?: (options?: DevRpcBurstOptions) => Promise<DevRpcBurstResult>
}

type UseDevRuntimeApiArgs = {
  dispatch: Dispatch<AppAction>
  activeThreadId: string | null
  activeTurnId: string | null
  enabled: boolean
  clientRef?: { current: RpcClient | null }
}

type DevRpcBurstOptions = {
  totalRequests?: number
  concurrency?: number
  sampleEveryMs?: number
  method?: string
  params?: unknown
}

type DevRpcBurstResult = {
  method: string
  totalRequests: number
  concurrency: number
  sampleEveryMs: number
  started: number
  completed: number
  succeeded: number
  failed: number
  overloadErrors: number
  samples: Array<{ at: string; metrics: RpcClientQueueMetrics }>
  finalMetrics: RpcClientQueueMetrics
}

function normalizePositiveLimit(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  const rounded = Math.floor(numeric)
  return rounded >= 1 ? rounded : fallback
}

function resolveDevRpcMethod(value: unknown): string {
  if (typeof value !== 'string') return 'thread/list'
  const trimmed = value.trim()
  return trimmed ? trimmed : 'thread/list'
}

export function useDevRuntimeApi(args: UseDevRuntimeApiArgs): void {
  const { dispatch, activeThreadId, activeTurnId, enabled, clientRef } = args

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    const devWindow = window as DevApiWindow
    devWindow.__formaxDevAskUserQuestion = (overrides) => {
      const now = Date.now()
      const inputId = overrides?.inputId ?? `dev-ask-${now}`
      const threadId = overrides?.threadId ?? activeThreadId ?? 'dev-thread'
      const turnId = overrides?.turnId ?? activeTurnId ?? `dev-turn-${now}`
      const toolUseId = overrides?.toolUseId ?? `dev-tool-ask-${now}`
      const createdAt = new Date(now).toISOString()
      const expiresAt = new Date(now + 10 * 60 * 1000).toISOString()

      dispatch({
        type: 'input_requested',
        input: {
          inputId,
          threadId,
          turnId,
          toolUseId,
          kind: 'ask_user_question',
          status: 'pending',
          createdAt,
          expiresAt,
          payload: {
            questions: [
              {
                header: 'Coding Time',
                question: '你平时更喜欢在什么时间写代码？',
                fieldId: 'coding_time',
                options: [
                  { label: '清晨', description: '早上精力充沛，环境安静' },
                  { label: '下午', description: '白天工作时间' },
                  { label: '深夜', description: '夜深人静时专注力高' },
                ],
                multiSelect: false,
              },
              {
                header: 'Review Depth',
                question: '这次希望我把 review 做到什么深度？',
                fieldId: 'review_depth',
                options: [
                  { label: '只看 blocker', description: '只看会阻塞发布的问题' },
                  { label: '常规完整', description: '覆盖中高优先级问题' },
                  { label: '尽可能严格', description: '包括低优先级潜在风险' },
                ],
                multiSelect: false,
              },
              {
                header: 'Output Style',
                question: '你更偏好哪种回复风格？',
                fieldId: 'output_style',
                options: [
                  { label: '短答案', description: '结论优先，简洁输出' },
                  { label: '带解释', description: '给出简短原因和取舍' },
                  { label: '详细展开', description: '附上下文、步骤和风险点' },
                ],
                multiSelect: false,
              },
            ],
          },
        },
      })
      dispatch({ type: 'set_selected_input', inputId })
      return inputId
    }

    devWindow.__formaxDevApprovalInput = (overrides) => {
      const now = Date.now()
      const inputId = overrides?.inputId ?? `dev-approval-${now}`
      const threadId = overrides?.threadId ?? activeThreadId ?? 'dev-thread'
      const turnId = overrides?.turnId ?? activeTurnId ?? `dev-turn-${now}`
      const toolUseId = overrides?.toolUseId ?? `dev-tool-approval-${now}`
      const createdAt = new Date(now).toISOString()
      const expiresAt = new Date(now + 10 * 60 * 1000).toISOString()

      dispatch({
        type: 'input_requested',
        input: {
          inputId,
          threadId,
          turnId,
          toolUseId,
          kind: 'approval',
          status: 'pending',
          createdAt,
          expiresAt,
          payload: {
            toolName: overrides?.toolName ?? 'Bash',
            action: overrides?.action ?? { kind: 'bash.exec', command: 'npm run test' },
            effectiveDecision: overrides?.effectiveDecision ?? { decision: 'ask' },
            ...(Array.isArray(overrides?.suggestions) ? { suggestions: overrides.suggestions } : {}),
            ...(overrides?.workspaceRequest !== undefined ? { workspaceRequest: overrides.workspaceRequest } : {}),
          },
        },
      })
      dispatch({ type: 'set_selected_input', inputId })
      return inputId
    }

    devWindow.__formaxDevClearPendingInputs = () => {
      dispatch({ type: 'clear_pending_inputs' })
    }

    devWindow.__formaxDevRpcQueueMetrics = () => {
      const client = clientRef?.current
      if (!client) return null
      return client.getQueueMetrics()
    }

    devWindow.__formaxDevRpcBurst = async (options) => {
      const client = clientRef?.current
      if (!client) throw new Error('RPC client is not ready')

      const totalRequests = normalizePositiveLimit(options?.totalRequests, 200)
      const concurrency = Math.min(totalRequests, normalizePositiveLimit(options?.concurrency, 24))
      const sampleEveryMs = normalizePositiveLimit(options?.sampleEveryMs, 100)
      const method = resolveDevRpcMethod(options?.method)
      const params = options && 'params' in options ? options.params : { limit: 20 }

      const samples: Array<{ at: string; metrics: RpcClientQueueMetrics }> = []
      const sample = () => {
        samples.push({ at: new Date().toISOString(), metrics: client.getQueueMetrics() })
      }
      sample()
      const timer = window.setInterval(sample, sampleEveryMs)

      let nextIndex = 0
      let started = 0
      let completed = 0
      let succeeded = 0
      let failed = 0
      let overloadErrors = 0

      const runWorker = async () => {
        while (true) {
          const requestIndex = nextIndex
          if (requestIndex >= totalRequests) return
          nextIndex += 1
          started += 1
          try {
            await client.request(method, params)
            succeeded += 1
          } catch (error) {
            failed += 1
            const errorCode = Number((error as { code?: unknown } | null)?.code ?? Number.NaN)
            if (errorCode === -32001) {
              overloadErrors += 1
            }
          } finally {
            completed += 1
          }
        }
      }

      try {
        await Promise.all(Array.from({ length: concurrency }, () => runWorker()))
      } finally {
        window.clearInterval(timer)
        sample()
      }

      return {
        method,
        totalRequests,
        concurrency,
        sampleEveryMs,
        started,
        completed,
        succeeded,
        failed,
        overloadErrors,
        samples,
        finalMetrics: client.getQueueMetrics(),
      }
    }

    return () => {
      delete devWindow.__formaxDevAskUserQuestion
      delete devWindow.__formaxDevApprovalInput
      delete devWindow.__formaxDevClearPendingInputs
      delete devWindow.__formaxDevRpcQueueMetrics
      delete devWindow.__formaxDevRpcBurst
    }
  }, [activeThreadId, activeTurnId, clientRef, dispatch, enabled])
}
