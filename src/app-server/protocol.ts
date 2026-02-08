export const APP_SERVER_PROTOCOL_VERSION = '0.1'

export type ClientInfo = {
  name: string
  version: string
}

export type InitializeParams = {
  clientInfo?: ClientInfo
}

export type InitializeResult = {
  serverInfo: {
    name: 'formax'
    version: string
  }
  protocolVersion: typeof APP_SERVER_PROTOCOL_VERSION
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

export function parseInitializeParams(params: unknown): InitializeParams {
  if (params == null) return {}
  if (!isObject(params)) throw new Error('Invalid params: expected object')

  const out: InitializeParams = {}
  if ('clientInfo' in params) {
    const raw = params.clientInfo
    if (!isObject(raw)) throw new Error('Invalid params.clientInfo: expected object')
    const name = String(raw.name ?? '').trim()
    const version = String(raw.version ?? '').trim()
    if (!name) throw new Error('Invalid params.clientInfo.name')
    if (!version) throw new Error('Invalid params.clientInfo.version')
    out.clientInfo = { name, version }
  }

  return out
}
