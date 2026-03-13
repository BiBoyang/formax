const TRUNCATED_MARKER = '\n\n(Truncated)\n'

export function truncateUtf8WithMarker(input: string, maxBytes: number): { text: string; truncated: boolean } {
  if (maxBytes <= 0) return { text: '', truncated: true }

  const byteLen = Buffer.byteLength(input, 'utf8')
  if (byteLen <= maxBytes) return { text: input, truncated: false }

  const markerBytes = Buffer.byteLength(TRUNCATED_MARKER, 'utf8')
  if (maxBytes <= markerBytes) {
    const markerBuf = Buffer.from(TRUNCATED_MARKER, 'utf8').subarray(0, maxBytes)
    return { text: markerBuf.toString('utf8'), truncated: true }
  }

  const head = Buffer.from(input, 'utf8').subarray(0, maxBytes - markerBytes)
  return { text: head.toString('utf8') + TRUNCATED_MARKER, truncated: true }
}

