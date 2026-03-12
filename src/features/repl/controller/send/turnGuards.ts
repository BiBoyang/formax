import type { Msg } from '../../../../shared/toolMessageTypes'

function hasRunningAskTool(args: {
  trackedRunningToolsSnapshot: Array<[string, string]>
  transientSnapshot: { messages: Msg[] } | null
}): boolean {
  const hasTrackedAsk = args.trackedRunningToolsSnapshot.some(([, name]) => name === 'AskUserQuestion')
  if (hasTrackedAsk) return true
  return (
    args.transientSnapshot?.messages.some(
      (m) => m.role === 'tool' && m.toolInfo?.name === 'AskUserQuestion' && m.toolInfo?.status === 'running',
    ) === true
  )
}

function mapLocalBashTurnOutcomeForTail(outcome: 'completed' | 'failed' | 'aborted'): 'completed' | 'failed' {
  return outcome === 'aborted' ? 'failed' : outcome
}

function shouldBlockSendWhileBusy(args: {
  text: string
  isLoading: boolean
  bashModeInFlight: boolean
  sessionTransitionPendingCount: number
}): boolean {
  return (
    args.text.trim().length === 0 ||
    args.isLoading ||
    args.bashModeInFlight ||
    args.sessionTransitionPendingCount > 0
  )
}

export {
  hasRunningAskTool,
  mapLocalBashTurnOutcomeForTail,
  shouldBlockSendWhileBusy,
}

