import type { Msg } from '../../../../components/tool/ToolMessage'

export function applyAbortToMessages(args: {
  messages: Msg[]
  trackedRunningTools: Array<[string, string]>
  hadInFlightRequest: boolean
  now?: () => number
}): Msg[] {
  const now = args.now ?? Date.now
  const abortedAt = now()
  const abortResult = 'Error: Request aborted'

  const markAborted = (message: Msg): Msg => {
    if (message.role !== 'tool' || !message.toolInfo || message.toolInfo.status !== 'running') return message
    return {
      ...message,
      content: abortResult,
      toolInfo: {
        ...message.toolInfo,
        status: 'error',
        result: abortResult,
      },
    }
  }

  const isAskRunning = (message: Msg) =>
    message.role === 'tool' && message.toolInfo?.name === 'AskUserQuestion' && message.toolInfo?.status === 'running'

  const hadAsk =
    args.messages.some(isAskRunning) || args.trackedRunningTools.some(([, name]) => name === 'AskUserQuestion')
  const next = args.messages.map(markAborted)

  for (const [toolUseId, toolName] of args.trackedRunningTools) {
    const exists = next.some((message) => message.role === 'tool' && message.toolInfo?.toolUseId === toolUseId)
    if (exists) continue
    next.push({
      id: `tool-${toolUseId}`,
      role: 'tool',
      content: abortResult,
      timestamp: new Date(abortedAt),
      toolInfo: {
        name: toolName || 'Tool',
        toolUseId,
        input: {},
        status: 'error',
        result: abortResult,
      },
    })
  }

  if (hadAsk && args.hadInFlightRequest) {
    next.push({
      id: `assistant-${abortedAt}`,
      role: 'assistant',
      content: 'User declined to answer questions',
      timestamp: new Date(now()),
    })
  }

  return next
}
