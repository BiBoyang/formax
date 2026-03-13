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

  it('rejects non-object payloads and invalid method/id combinations', () => {
    const nonObject = classifyRpcMessage('not-an-object')
    expect(nonObject).toEqual({
      kind: 'invalid',
      id: null,
      message: 'Invalid Request: expected object',
    })

    const emptyMethodWithInvalidId = classifyRpcMessage({ jsonrpc: '2.0', id: Number.NaN, method: '   ' })
    expect(emptyMethodWithInvalidId).toEqual({
      kind: 'invalid',
      id: null,
      message: 'Invalid Request: method must be a non-empty string',
    })

    const invalidId = classifyRpcMessage({ jsonrpc: '2.0', id: Number.POSITIVE_INFINITY, method: 'initialize' })
    expect(invalidId).toEqual({
      kind: 'invalid',
      id: null,
      message: 'Invalid Request: id must be string|number|null',
    })

    const invalidVersionWithInvalidId = classifyRpcMessage({
      jsonrpc: '1.0',
      id: Number.POSITIVE_INFINITY,
      method: 'initialize',
    })
    expect(invalidVersionWithInvalidId).toEqual({
      kind: 'invalid',
      id: null,
      message: 'Invalid Request: jsonrpc must be "2.0"',
    })

    const emptyMethodWithValidId = classifyRpcMessage({ jsonrpc: '2.0', id: 'req-1', method: '' })
    expect(emptyMethodWithValidId).toEqual({
      kind: 'invalid',
      id: 'req-1',
      message: 'Invalid Request: method must be a non-empty string',
    })
  })

  it('preserves params for request/notification and accepts string/null ids', () => {
    const stringIdRequest = classifyRpcMessage({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'initialize',
      params: { clientInfo: { name: 'web' } },
    })
    expect(stringIdRequest).toEqual({
      kind: 'request',
      request: {
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'initialize',
        params: { clientInfo: { name: 'web' } },
      },
    })

    const nullIdRequest = classifyRpcMessage({ jsonrpc: '2.0', id: null, method: 'initialize' })
    expect(nullIdRequest).toEqual({
      kind: 'request',
      request: {
        jsonrpc: '2.0',
        id: null,
        method: 'initialize',
      },
    })

    const notificationWithParams = classifyRpcMessage({
      jsonrpc: '2.0',
      method: 'initialized',
      params: { ready: true },
    })
    expect(notificationWithParams).toEqual({
      kind: 'notification',
      notification: {
        jsonrpc: '2.0',
        method: 'initialized',
        params: { ready: true },
      },
    })
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
