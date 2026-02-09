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

export type RpcErrorObject = NonNullable<RpcResponse['error']>

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

export type ResolvedInput = {
  inputId: string
  threadId: string
  turnId: string
  toolUseId: string
  kind: 'approval' | 'ask_user_question'
  status: 'submitted' | 'canceled' | 'expired' | 'failed'
  createdAt: string
  expiresAt: string
  resolvedAt: string
  reason?: string
}

export type TranscriptItem =
  | { id: string; kind: 'log'; text: string; level: 'info' | 'warn' | 'error'; turnId?: string }
  | { id: string; kind: 'thinking'; text: string; turnId?: string }
  | { id: string; kind: 'message'; role: 'user' | 'assistant'; text: string; turnId?: string }
  | {
      id: string
      kind: 'tool'
      turnId?: string
      toolUseId?: string
      toolName?: string
      phase: 'start' | 'update' | 'end'
      text: string
    }
