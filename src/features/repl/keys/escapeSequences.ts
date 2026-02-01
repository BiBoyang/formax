export type BufferedArrow = 'up' | 'down'

export type BufferedArrowResult = {
  nextBuffer: string
  /**
   * Net movement:
   * - negative => up
   * - positive => down
   *
   * Some environments (including `ink-testing-library` + newer React batching) can deliver multiple
   * arrow escape sequences in a single chunk. Returning a delta avoids dropping repeats.
   */
  delta: number
  pending: boolean
}

export type BufferedHorizontalResult = {
  nextBuffer: string
  /**
   * Net movement:
   * - negative => left
   * - positive => right
   */
  delta: number
  deletes: number
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
 * so callers can keep buffering and wait for the next chunk. Note: `delta` may be non-zero even
 * when `pending` is true (e.g. a chunk contains complete arrow(s) plus an incomplete trailing
 * escape sequence), so callers should only "return early" when `pending && delta === 0`.
 */
export function consumeBufferedArrow(params: { buffer: string; chunk: string }): BufferedArrowResult {
  const buffer = params.buffer
  const chunk = params.chunk

  if (!chunk) return { nextBuffer: buffer, delta: 0, pending: false }

  let nextBuf = buffer + chunk
  if (!nextBuf.startsWith('\u001B')) return { nextBuffer: '', delta: 0, pending: false }

  let delta = 0
  while (nextBuf.length > 0) {
    if (nextBuf.startsWith('\u001B[A') || nextBuf.startsWith('\u001BOA')) {
      delta -= 1
      nextBuf = nextBuf.slice(3)
      continue
    }

    if (nextBuf.startsWith('\u001B[B') || nextBuf.startsWith('\u001BOB')) {
      delta += 1
      nextBuf = nextBuf.slice(3)
      continue
    }

    if (nextBuf === '\u001B' || nextBuf === '\u001B[' || nextBuf === '\u001BO') {
      return { nextBuffer: nextBuf, delta, pending: true }
    }

    // Partial (prefix) sequence at the end of the chunk.
    if (
      nextBuf === '\u001B' ||
      (nextBuf.startsWith('\u001B[') && nextBuf.length < 3) ||
      (nextBuf.startsWith('\u001BO') && nextBuf.length < 3)
    ) {
      return { nextBuffer: nextBuf, delta, pending: true }
    }

    // Unknown/unsupported escape sequence. Clear the buffer so other input isn't blocked.
    return { nextBuffer: '', delta, pending: false }
  }

  return { nextBuffer: '', delta, pending: false }
}

/**
 * Like `consumeBufferedArrow`, but for horizontal arrows and forward-delete.
 *
 * Supported sequences:
 * - Left:   ESC [ D   (\\u001B[D)   or ESC O D (\\u001BOD)
 * - Right:  ESC [ C   (\\u001B[C)   or ESC O C (\\u001BOC)
 * - Delete: ESC [ 3 ~ (\\u001B[3~)
 */
export function consumeBufferedHorizontal(params: { buffer: string; chunk: string }): BufferedHorizontalResult {
  const buffer = params.buffer
  const chunk = params.chunk

  if (!chunk) return { nextBuffer: buffer, delta: 0, deletes: 0, pending: false }

  let nextBuf = buffer + chunk
  if (!nextBuf.startsWith('\u001B')) return { nextBuffer: '', delta: 0, deletes: 0, pending: false }

  let delta = 0
  let deletes = 0
  while (nextBuf.length > 0) {
    if (nextBuf.startsWith('\u001B[D') || nextBuf.startsWith('\u001BOD')) {
      delta -= 1
      nextBuf = nextBuf.slice(3)
      continue
    }

    if (nextBuf.startsWith('\u001B[C') || nextBuf.startsWith('\u001BOC')) {
      delta += 1
      nextBuf = nextBuf.slice(3)
      continue
    }

    if (nextBuf.startsWith('\u001B[3~')) {
      deletes += 1
      nextBuf = nextBuf.slice(4)
      continue
    }

    if (
      nextBuf === '\u001B' ||
      nextBuf === '\u001B[' ||
      nextBuf === '\u001BO' ||
      nextBuf === '\u001B[3' ||
      nextBuf === '\u001B[3~'.slice(0, nextBuf.length)
    ) {
      return { nextBuffer: nextBuf, delta, deletes, pending: true }
    }

    if (
      nextBuf === '\u001B' ||
      (nextBuf.startsWith('\u001B[') && nextBuf.length < 3) ||
      (nextBuf.startsWith('\u001BO') && nextBuf.length < 3) ||
      (nextBuf.startsWith('\u001B[3') && nextBuf.length < 4)
    ) {
      return { nextBuffer: nextBuf, delta, deletes, pending: true }
    }

    return { nextBuffer: '', delta, deletes, pending: false }
  }

  return { nextBuffer: '', delta, deletes, pending: false }
}
