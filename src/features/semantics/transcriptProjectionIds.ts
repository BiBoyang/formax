import type { TranscriptSegment } from './transcriptProjectionTypes'

export type TranscriptSegmentIdArgs = {
  kind: TranscriptSegment['kind']
  replaySeq: number
  turnId: string
  suffix?: string
}

export type TranscriptSegmentIdFactory = (args: TranscriptSegmentIdArgs) => string

export const createTranscriptSegmentId: TranscriptSegmentIdFactory = (args) =>
  args.suffix
    ? `${args.turnId}:${args.kind}:${args.replaySeq}:${args.suffix}`
    : `${args.turnId}:${args.kind}:${args.replaySeq}`
