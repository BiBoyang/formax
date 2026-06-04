import type { McpClient, McpClientCallToolInput, McpClientListToolsResult } from './client.js'
import type { McpToolCallResult, McpToolMetadata } from './types.js'

export type FakeMcpClientCall = {
  name: string
  arguments: Record<string, unknown>
}

export class FakeMcpClient implements McpClient {
  readonly calls: FakeMcpClientCall[] = []
  closeCount = 0
  listToolsCount = 0
  private readonly results = new Map<string, McpToolCallResult>()

  constructor(
    readonly tools: McpToolMetadata[],
    results?: Record<string, McpToolCallResult>,
  ) {
    for (const [name, result] of Object.entries(results ?? {})) this.results.set(name, result)
  }

  async listTools(signal?: AbortSignal): Promise<McpClientListToolsResult> {
    throwIfAborted(signal)
    this.listToolsCount += 1
    return { tools: this.tools }
  }

  async callTool(input: McpClientCallToolInput): Promise<McpToolCallResult> {
    throwIfAborted(input.signal)
    this.calls.push({ name: input.name, arguments: input.arguments })
    return this.results.get(input.name) ?? {
      content: [{ type: 'text', text: `called ${input.name}` }],
    }
  }

  async close(): Promise<void> {
    this.closeCount += 1
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('MCP operation aborted')
}
