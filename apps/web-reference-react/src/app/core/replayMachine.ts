export type ThreadTranscriptSource = 'replay' | 'history'

export function shouldPromoteReplayAsCanonical(args: {
  receivedEntries: boolean
  fromStart: boolean
  initialAfter: number
  currentTranscriptSource: ThreadTranscriptSource | undefined
}): boolean {
  return (
    args.receivedEntries &&
    (args.fromStart || args.initialAfter === 0 || args.currentTranscriptSource !== 'history')
  )
}

export function canFastRebaseGapWithoutHistory(args: {
  transcriptSource: ThreadTranscriptSource | undefined
  cachedLogsLength: number
}): boolean {
  return (
    (args.transcriptSource === 'replay' || args.transcriptSource === 'history') &&
    args.cachedLogsLength > 0
  )
}
