export function buildPrimaryTranscriptStaticKey(transcriptSeq: number, primaryTranscriptStartIndex: number): string {
  return `${transcriptSeq}:${Math.max(0, primaryTranscriptStartIndex)}`
}
