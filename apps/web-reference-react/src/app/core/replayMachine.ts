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
