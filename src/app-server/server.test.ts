import { describe, expect, it } from 'vitest'
import { classifyRpcMessage, JSON_RPC_ERRORS } from './jsonrpc.js'
import { AppServer } from './server.js'

function request(id: string | number | null, method: string, params?: unknown) {
  return classifyRpcMessage({
    jsonrpc: '2.0',
    id,
    method,
    ...(params === undefined ? {} : { params }),
  })
}

describe('AppServer', () => {
  it('returns NOT_INITIALIZED for requests before initialize', () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    const out = server.handleMessage(request(1, 'thread/start'))
    expect(out).toHaveLength(1)
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.NOT_INITIALIZED)
    expect((out[0] as any).error.message).toBe('Not initialized')
  })

  it('handles initialize and then returns method not found for unknown methods', () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })

    const init = server.handleMessage(request(1, 'initialize', { clientInfo: { name: 'web', version: '1.0.0' } }))
    expect(init).toHaveLength(1)
    expect((init[0] as any).result.serverInfo).toEqual({ name: 'formax', version: 'test' })
    expect((init[0] as any).result.protocolVersion).toBe('0.1')

    const unknown = server.handleMessage(request(2, 'thread/start'))
    expect(unknown).toHaveLength(1)
    expect((unknown[0] as any).error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND)
  })

  it('validates initialize params', () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    const out = server.handleMessage(request(1, 'initialize', { clientInfo: { name: '', version: '1.0.0' } }))
    expect(out).toHaveLength(1)
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
  })

  it('accepts initialized notification after initialize', () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    void server.handleMessage(request(1, 'initialize'))
    const out = server.handleMessage(classifyRpcMessage({ jsonrpc: '2.0', method: 'initialized' }))
    expect(out).toEqual([])
    expect(server.getState().initializedNotified).toBe(true)
  })
})
