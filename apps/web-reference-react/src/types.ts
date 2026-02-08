export type JsonRpcId = string | number

export type RpcRequest = {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

export type RpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export type RpcResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export type ThreadSummary = {
  id: string
  cwd: string
  createdAt: string
  updatedAt: string
  messageCount: number | null
  lastUserPrompt: string | null
  label: string | null
}

export type PendingInput = {
  inputId: string
  threadId: string
  turnId: string
  toolUseId: string
  kind: 'approval' | 'ask_user_question'
  status: 'pending'
  createdAt: string
  expiresAt: string
  payload: any
}

export type TranscriptItem =
  | { id: string; kind: 'log'; text: string; level: 'info' | 'warn' | 'error' }
  | { id: string; kind: 'message'; role: 'user' | 'assistant'; text: string; turnId?: string }
