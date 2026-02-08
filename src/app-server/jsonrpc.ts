export type JsonRpcId = string | number | null

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

export type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export type JsonRpcErrorObject = {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcSuccessResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export type JsonRpcErrorResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: JsonRpcErrorObject
}

export type ParsedRpcMessage =
  | { kind: 'request'; request: JsonRpcRequest }
  | { kind: 'notification'; notification: JsonRpcNotification }
  | { kind: 'invalid'; id: JsonRpcId; message: string }

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  NOT_INITIALIZED: -32001,
  PAYLOAD_TOO_LARGE: -32002,
} as const

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isValidId(value: unknown): value is JsonRpcId {
  if (value === null) return true
  if (typeof value === 'string') return true
  if (typeof value === 'number' && Number.isFinite(value)) return true
  return false
}

export function parseJsonLine(line: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true as const, value: JSON.parse(line) }
  } catch {
    return { ok: false as const, message: 'Invalid JSON' }
  }
}

export function classifyRpcMessage(raw: unknown): ParsedRpcMessage {
  if (!isObject(raw)) {
    return { kind: 'invalid', id: null, message: 'Invalid Request: expected object' }
  }

  const rawJsonRpc = raw.jsonrpc
  if (rawJsonRpc !== '2.0') {
    const id = isValidId(raw.id) ? raw.id : null
    return { kind: 'invalid', id, message: 'Invalid Request: jsonrpc must be "2.0"' }
  }

  const method = raw.method
  if (typeof method !== 'string' || !method.trim()) {
    const id = isValidId(raw.id) ? raw.id : null
    return { kind: 'invalid', id, message: 'Invalid Request: method must be a non-empty string' }
  }

  if ('id' in raw) {
    if (!isValidId(raw.id)) {
      return { kind: 'invalid', id: null, message: 'Invalid Request: id must be string|number|null' }
    }
    return {
      kind: 'request',
      request: {
        jsonrpc: '2.0',
        id: raw.id,
        method,
        ...('params' in raw ? { params: raw.params } : {}),
      },
    }
  }

  return {
    kind: 'notification',
    notification: {
      jsonrpc: '2.0',
      method,
      ...('params' in raw ? { params: raw.params } : {}),
    },
  }
}

export function makeSuccessResponse(id: JsonRpcId, result: unknown): JsonRpcSuccessResponse {
  return { jsonrpc: '2.0', id, result }
}

export function makeErrorResponse(id: JsonRpcId, error: JsonRpcErrorObject): JsonRpcErrorResponse {
  return { jsonrpc: '2.0', id, error }
}
