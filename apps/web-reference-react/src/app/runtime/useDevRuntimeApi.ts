import { useEffect, type Dispatch } from 'react'
import type { AppAction } from '../../store'

type DevApiWindow = Window & {
  __formaxDevAskUserQuestion?: (overrides?: {
    inputId?: string
    threadId?: string
    turnId?: string
    toolUseId?: string
  }) => string
  __formaxDevClearPendingInputs?: () => void
}

type UseDevRuntimeApiArgs = {
  dispatch: Dispatch<AppAction>
  activeThreadId: string | null
  activeTurnId: string | null
  enabled: boolean
}

export function useDevRuntimeApi(args: UseDevRuntimeApiArgs): void {
  const { dispatch, activeThreadId, activeTurnId, enabled } = args

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

    devWindow.__formaxDevClearPendingInputs = () => {
      dispatch({ type: 'clear_pending_inputs' })
    }

    return () => {
      delete devWindow.__formaxDevAskUserQuestion
      delete devWindow.__formaxDevClearPendingInputs
    }
  }, [activeThreadId, activeTurnId, dispatch, enabled])
}
