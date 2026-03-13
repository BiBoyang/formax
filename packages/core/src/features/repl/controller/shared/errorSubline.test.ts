import { describe, expect, it } from 'vitest'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { formatErrorSubline, isErrorLikeSubline, shouldSuppressGlobalError } from './errorSubline'

function makeMsg(args: {
  role: Msg['role']
  content: string
  uiKind?: Msg['ui']['kind']
}): Msg {
  return {
    id: `${args.role}-${args.content}`,
    role: args.role,
    content: args.content,
    timestamp: new Date('2025-01-01T00:00:00.000Z'),
    ui: args.uiKind ? { kind: args.uiKind } : undefined,
  }
}

describe('formatErrorSubline', () => {
  it('returns unknown error for empty input', () => {
    expect(formatErrorSubline('')).toBe('Error: Unknown error')
  })

  it('formats HTTP error code and detail', () => {
    expect(formatErrorSubline('HTTP 404: Not Found')).toBe('404 Not Found')
  })

  it('normalizes HTML HTTP response body', () => {
    expect(formatErrorSubline('HTTP 500: <!doctype html><html><body>error</body></html>')).toBe(
      '500 HTML error response body',
    )
  })

  it('formats API error with explicit status code', () => {
    expect(formatErrorSubline('API Error: 429 rate limited')).toBe('429 rate limited')
  })

  it('formats API error without status code', () => {
    expect(formatErrorSubline('API Error: <html><body>oops</body></html>')).toBe(
      'API Error: HTML error response body',
    )
  })

  it('preserves already-prefixed Error messages', () => {
    expect(formatErrorSubline('Error: Something bad happened')).toBe('Error: Something bad happened')
  })

  it('adds Error prefix for plain messages', () => {
    expect(formatErrorSubline('something bad happened')).toBe('Error: something bad happened')
  })

  it('truncates very long output', () => {
    const long = `HTTP 500: ${'x'.repeat(400)}`
    const formatted = formatErrorSubline(long)
    expect(formatted.endsWith('... [truncated]')).toBe(true)
    expect(formatted.length).toBe(320)
  })
})

describe('isErrorLikeSubline', () => {
  it('accepts Error-prefixed lines', () => {
    expect(isErrorLikeSubline('Error: failed')).toBe(true)
  })

  it('accepts API Error-prefixed lines', () => {
    expect(isErrorLikeSubline('API Error: failed')).toBe(true)
  })

  it('accepts HTTP status-only lines', () => {
    expect(isErrorLikeSubline('503 service unavailable')).toBe(true)
  })

  it('rejects empty or non-error lines', () => {
    expect(isErrorLikeSubline('')).toBe(false)
    expect(isErrorLikeSubline('all good')).toBe(false)
  })
})

describe('shouldSuppressGlobalError', () => {
  it('returns false when currentError is missing', () => {
    expect(
      shouldSuppressGlobalError({
        messages: [makeMsg({ role: 'assistant', content: 'Error: failed', uiKind: 'command_subline' })],
        currentError: null,
      }),
    ).toBe(false)
  })

  it('returns false when no assistant message exists', () => {
    expect(
      shouldSuppressGlobalError({
        messages: [makeMsg({ role: 'user', content: 'hello' })],
        currentError: 'HTTP 500: boom',
      }),
    ).toBe(false)
  })

  it('returns false when latest assistant is not command_subline', () => {
    expect(
      shouldSuppressGlobalError({
        messages: [makeMsg({ role: 'assistant', content: 'Error: failed' })],
        currentError: 'HTTP 500: boom',
      }),
    ).toBe(false)
  })

  it('returns false when latest command_subline is not error-like', () => {
    expect(
      shouldSuppressGlobalError({
        messages: [makeMsg({ role: 'assistant', content: 'Done', uiKind: 'command_subline' })],
        currentError: 'HTTP 500: boom',
      }),
    ).toBe(false)
  })

  it('returns true when latest assistant subline matches formatted global error', () => {
    expect(
      shouldSuppressGlobalError({
        messages: [
          makeMsg({ role: 'assistant', content: 'not latest', uiKind: 'command_subline' }),
          makeMsg({ role: 'user', content: 'ignored' }),
          makeMsg({ role: 'assistant', content: '500 boom', uiKind: 'command_subline' }),
        ],
        currentError: 'HTTP 500: boom',
      }),
    ).toBe(true)
  })

  it('returns false when latest assistant subline does not match formatted error', () => {
    expect(
      shouldSuppressGlobalError({
        messages: [makeMsg({ role: 'assistant', content: '500 boom', uiKind: 'command_subline' })],
        currentError: 'HTTP 500: another',
      }),
    ).toBe(false)
  })
})
