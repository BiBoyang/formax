import { describe, expect, it } from 'vitest'
import { classifyRpcMessage, makeErrorResponse, makeSuccessResponse, parseJsonLine } from './jsonrpc.js'

describe('jsonrpc helpers', () => {
  it('parses valid JSON lines', () => {
    const parsed = parseJsonLine('{"jsonrpc":"2.0","id":1,"method":"initialize"}')
    expect(parsed.ok).toBe(true)
  })

  it('returns parse error for invalid JSON lines', () => {
    const parsed = parseJsonLine('{"jsonrpc":"2.0",')
    expect(parsed.ok).toBe(false)
  })

  it('classifies request, notification, and invalid messages', () => {
    const request = classifyRpcMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(request.kind).toBe('request')

    const notification = classifyRpcMessage({ jsonrpc: '2.0', method: 'initialized' })
    expect(notification.kind).toBe('notification')

    const invalid = classifyRpcMessage({ jsonrpc: '1.0', id: 1, method: 'initialize' })
    expect(invalid.kind).toBe('invalid')
    if (invalid.kind === 'invalid') {
      expect(invalid.id).toBe(1)
    }

    const missingVersion = classifyRpcMessage({ id: 2, method: 'initialize' })
    expect(missingVersion.kind).toBe('invalid')
  })

  it('creates success and error response envelopes', () => {
    const ok = makeSuccessResponse(1, { hello: 'world' })
    expect(ok).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { hello: 'world' },
    })

    const err = makeErrorResponse(1, { code: -32601, message: 'Method not found' })
    expect(err).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'Method not found' },
    })
  })
})
