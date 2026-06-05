import type { ToolDefinition } from '../shared/toolContracts.js'

export type McpTransportType = 'stdio' | 'http'

export type McpStdioServerConfig = {
  type: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  timeoutMs?: number
  enabled: boolean
}

export type McpHttpServerConfig = {
  type: 'http'
  url: string
  headers?: Record<string, string>
  timeoutMs?: number
  enabled: boolean
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig

export type McpConfig = {
  servers: Record<string, McpServerConfig>
}

export type McpToolMetadata = {
  name: string
  description?: string
  inputSchema?: unknown
  annotations?: unknown
}

export type McpToolBinding = {
  modelName: string
  serverId: string
  originalServerId: string
  toolName: string
  originalToolName: string
  definition: ToolDefinition
  schemaFingerprint: string
}

export type McpToolCatalogDiagnostic =
  | {
      type: 'duplicate-tool-name'
      modelName: string
      kept: { serverId: string; toolName: string }
      dropped: { serverId: string; toolName: string }
    }
  | {
      type: 'reserved-tool-name'
      modelName: string
      dropped: { serverId: string; toolName: string }
    }
  | {
      type: 'invalid-input-schema'
      modelName: string
      dropped: { serverId: string; toolName: string }
    }

export type McpToolCatalog = {
  bindings: McpToolBinding[]
  diagnostics: McpToolCatalogDiagnostic[]
}

export type McpTextContent = {
  type: 'text'
  text: string
}

export type McpImageContent = {
  type: 'image'
  data: string
  mimeType: string
}

export type McpAudioContent = {
  type: 'audio'
  data: string
  mimeType: string
}

export type McpResourceContent = {
  type: 'resource'
  resource: {
    uri: string
    mimeType?: string
    text?: string
    blob?: string
  }
}

export type McpToolResultContent =
  | McpTextContent
  | McpImageContent
  | McpAudioContent
  | McpResourceContent
  | Record<string, unknown>

export type McpToolCallResult = {
  content?: unknown[]
  structuredContent?: unknown
  isError?: boolean
}

export type McpBlobWriteRequest = {
  bytes: Uint8Array
  mimeType: string
  suggestedExtension: string
}

export type McpBlobWriteResult = {
  path: string
}

export type McpBlobWriter = {
  writeBlob(request: McpBlobWriteRequest): Promise<McpBlobWriteResult>
  cleanup?(): Promise<void>
}
