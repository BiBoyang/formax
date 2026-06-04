import type { McpServerConfig, McpToolCallResult, McpToolMetadata } from './types.js'

export type McpClientListToolsResult = {
  tools: McpToolMetadata[]
}

export type McpClientCallToolInput = {
  name: string
  arguments: Record<string, unknown>
  signal?: AbortSignal
}

export type McpClient = {
  listTools(signal?: AbortSignal): Promise<McpClientListToolsResult>
  callTool(input: McpClientCallToolInput): Promise<McpToolCallResult>
  close(): Promise<void>
}

export type McpClientFactory = (input: {
  serverId: string
  config: McpServerConfig
  signal?: AbortSignal
}) => Promise<McpClient>
