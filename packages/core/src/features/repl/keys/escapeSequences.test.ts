import { describe, expect, it } from 'vitest'
import { consumeBufferedArrow, consumeBufferedHorizontal } from './escapeSequences.js'

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

  it('keeps buffer when chunk is empty', () => {
    expect(consumeBufferedArrow({ buffer: '\u001B[', chunk: '' })).toEqual({
      nextBuffer: '\u001B[',
      delta: 0,
      pending: false,
    })
  })
})

describe('consumeBufferedHorizontal', () => {
  it('emits left/right/delete for complete sequences', () => {
    expect(consumeBufferedHorizontal({ buffer: '', chunk: '\u001B[D' })).toEqual({
      nextBuffer: '',
      delta: -1,
      deletes: 0,
      pending: false,
    })
    expect(consumeBufferedHorizontal({ buffer: '', chunk: '\u001BOC' })).toEqual({
      nextBuffer: '',
      delta: 1,
      deletes: 0,
      pending: false,
    })
    expect(consumeBufferedHorizontal({ buffer: '', chunk: '\u001B[3~' })).toEqual({
      nextBuffer: '',
      delta: 0,
      deletes: 1,
      pending: false,
    })
  })

  it('buffers partial prefixes and emits when completed', () => {
    expect(consumeBufferedHorizontal({ buffer: '', chunk: '\u001B' })).toEqual({
      nextBuffer: '\u001B',
      delta: 0,
      deletes: 0,
      pending: true,
    })
    expect(consumeBufferedHorizontal({ buffer: '\u001B', chunk: '[' })).toEqual({
      nextBuffer: '\u001B[',
      delta: 0,
      deletes: 0,
      pending: true,
    })
    expect(consumeBufferedHorizontal({ buffer: '\u001B[', chunk: 'D' })).toEqual({
      nextBuffer: '',
      delta: -1,
      deletes: 0,
      pending: false,
    })
  })

  it('clears buffer on unknown horizontal escape sequence and handles empty chunk', () => {
    expect(consumeBufferedHorizontal({ buffer: '', chunk: '\u001B[Z' })).toEqual({
      nextBuffer: '',
      delta: 0,
      deletes: 0,
      pending: false,
    })
    expect(consumeBufferedHorizontal({ buffer: '\u001B[', chunk: '' })).toEqual({
      nextBuffer: '\u001B[',
      delta: 0,
      deletes: 0,
      pending: false,
    })
  })

  it('clears state for non-escape horizontal input', () => {
    expect(consumeBufferedHorizontal({ buffer: '', chunk: 'x' })).toEqual({
      nextBuffer: '',
      delta: 0,
      deletes: 0,
      pending: false,
    })
  })

  it('consumes multiple horizontal sequences in a single chunk', () => {
    expect(consumeBufferedHorizontal({ buffer: '', chunk: '\u001B[D\u001B[C\u001B[3~' })).toEqual({
      nextBuffer: '',
      delta: 0,
      deletes: 1,
      pending: false,
    })
  })
})
