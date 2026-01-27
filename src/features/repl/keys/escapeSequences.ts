export type BufferedArrow = 'up' | 'down'

export type BufferedArrowResult = {
  nextBuffer: string
  arrow: BufferedArrow | null
  pending: boolean
}

/**
 * Some terminals (and ink-testing-library) may split arrow-key escape sequences across multiple
 * `useInput` callbacks. This helper incrementally buffers ESC-prefixed input and emits a semantic
 * arrow direction when the sequence is complete.
 *
 * Supported sequences:
 * - Up:   ESC [ A   (\\u001B[A)   or ESC O A (\\u001BOA)
 * - Down: ESC [ B   (\\u001B[B)   or ESC O B (\\u001BOB)
 *
 * It also recognizes common "prefix-only" partial buffers (ESC, ESC[, ESCO) and signals `pending`
 * so callers can return early and wait for the next chunk.
 */
export function consumeBufferedArrow(params: { buffer: string; chunk: string }): BufferedArrowResult {
  const buffer = params.buffer
  const chunk = params.chunk

  if (!chunk) return { nextBuffer: buffer, arrow: null, pending: false }

  const nextBuf = buffer + chunk
  if (!nextBuf.startsWith('\u001B')) return { nextBuffer: '', arrow: null, pending: false }

  if (nextBuf === '\u001B[A' || nextBuf === '\u001BOA') return { nextBuffer: '', arrow: 'up', pending: false }
  if (nextBuf === '\u001B[B' || nextBuf === '\u001BOB') return { nextBuffer: '', arrow: 'down', pending: false }

  if (nextBuf === '\u001B' || nextBuf === '\u001B[' || nextBuf === '\u001BO') {
    return { nextBuffer: nextBuf, arrow: null, pending: true }
  }

  // Unknown/unsupported escape sequence. Clear the buffer so other input isn't blocked.
  return { nextBuffer: '', arrow: null, pending: false }
}
