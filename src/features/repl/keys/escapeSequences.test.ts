import { describe, expect, it } from 'vitest'
import { consumeBufferedArrow } from './escapeSequences.js'

describe('consumeBufferedArrow', () => {
  it('emits up/down for complete sequences', () => {
    expect(consumeBufferedArrow({ buffer: '', chunk: '\u001B[A' })).toEqual({
      nextBuffer: '',
      arrow: 'up',
      pending: false,
    })
    expect(consumeBufferedArrow({ buffer: '', chunk: '\u001BOB' })).toEqual({
      nextBuffer: '',
      arrow: 'down',
      pending: false,
    })
  })

  it('buffers partial prefixes and emits when completed', () => {
    expect(consumeBufferedArrow({ buffer: '', chunk: '\u001B' })).toEqual({
      nextBuffer: '\u001B',
      arrow: null,
      pending: true,
    })
    expect(consumeBufferedArrow({ buffer: '\u001B', chunk: '[' })).toEqual({
      nextBuffer: '\u001B[',
      arrow: null,
      pending: true,
    })
    expect(consumeBufferedArrow({ buffer: '\u001B[', chunk: 'A' })).toEqual({
      nextBuffer: '',
      arrow: 'up',
      pending: false,
    })
  })

  it('clears buffer on non-escape input', () => {
    expect(consumeBufferedArrow({ buffer: '\u001B[', chunk: 'x' })).toEqual({
      nextBuffer: '',
      arrow: null,
      pending: false,
    })
    expect(consumeBufferedArrow({ buffer: '', chunk: 'x' })).toEqual({
      nextBuffer: '',
      arrow: null,
      pending: false,
    })
  })
})

