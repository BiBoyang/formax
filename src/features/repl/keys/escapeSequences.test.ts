import { describe, expect, it } from 'vitest'
import { consumeBufferedArrow } from './escapeSequences.js'

describe('consumeBufferedArrow', () => {
  it('emits up/down for complete sequences', () => {
    expect(consumeBufferedArrow({ buffer: '', chunk: '\u001B[A' })).toEqual({
      nextBuffer: '',
      delta: -1,
      pending: false,
    })
    expect(consumeBufferedArrow({ buffer: '', chunk: '\u001BOB' })).toEqual({
      nextBuffer: '',
      delta: 1,
      pending: false,
    })
  })

  it('buffers partial prefixes and emits when completed', () => {
    expect(consumeBufferedArrow({ buffer: '', chunk: '\u001B' })).toEqual({
      nextBuffer: '\u001B',
      delta: 0,
      pending: true,
    })
    expect(consumeBufferedArrow({ buffer: '\u001B', chunk: '[' })).toEqual({
      nextBuffer: '\u001B[',
      delta: 0,
      pending: true,
    })
    expect(consumeBufferedArrow({ buffer: '\u001B[', chunk: 'A' })).toEqual({
      nextBuffer: '',
      delta: -1,
      pending: false,
    })
  })

  it('clears buffer on non-escape input', () => {
    expect(consumeBufferedArrow({ buffer: '\u001B[', chunk: 'x' })).toEqual({
      nextBuffer: '',
      delta: 0,
      pending: false,
    })
    expect(consumeBufferedArrow({ buffer: '', chunk: 'x' })).toEqual({
      nextBuffer: '',
      delta: 0,
      pending: false,
    })
  })

  it('handles multiple arrow sequences in a single chunk', () => {
    expect(consumeBufferedArrow({ buffer: '', chunk: '\u001B[B\u001B[B\u001B[A' })).toEqual({
      nextBuffer: '',
      delta: 1,
      pending: false,
    })
  })
})
