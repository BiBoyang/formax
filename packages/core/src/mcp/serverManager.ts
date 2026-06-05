import type { McpClient, McpClientFactory } from './client.js'
import { normalizeMcpServerId } from './names.js'
import { mapMcpToolResult, type MapMcpResultOptions } from './resultMapper.js'
import { createMcpToolBindingIndex } from './toolBinding.js'
import { createMcpToolCatalog } from './toolCatalog.js'
import type {
  McpBlobWriter,
  McpConfig,
  McpServerConfig,
  McpToolBinding,
  McpToolCatalog,
} from './types.js'
import type { ToolResult } from '../shared/toolContracts.js'
import {
  projectMcpServerStatus,
  type McpServerLifecycleState,
  type McpServerStatusProjection,
} from './status.js'

type ManagedServer = {
  serverId: string
  originalServerId: string
  client?: McpClient
  state: McpServerLifecycleState | 'disabled'
  toolCount?: number
  error?: unknown
}

type ManagedServerConfig = {
  serverId: string
  originalServerId: string
  config: McpServerConfig
}

export type McpServerManagerOptions = {
  config: McpConfig
  clientFactory: McpClientFactory
  maxOutputTokens?: number
  blobWriter?: McpBlobWriter
}

export class McpServerManager {
  private readonly servers = new Map<string, ManagedServer>()
  private readonly serverConfigs = new Map<string, ManagedServerConfig>()
  private readonly blobWriters = new Set<McpBlobWriter>()
  private catalog: McpToolCatalog = emptyMcpToolCatalog()
  private bindingIndex = new Map<string, McpToolBinding>()
  private disposed = false

  constructor(private readonly options: McpServerManagerOptions) {
    for (const [rawServerId, config] of Object.entries(options.config.servers)) {
      const serverId = normalizeMcpServerId(rawServerId)
      const existing = this.serverConfigs.get(serverId)
      if (existing) {
        throw new Error(`MCP server id collision: ${rawServerId} collides with ${existing.originalServerId} after normalization to ${serverId}`)
      }
      this.serverConfigs.set(serverId, { serverId, originalServerId: rawServerId, config })
      this.servers.set(serverId, {
        serverId,
        originalServerId: rawServerId,
        state: config.enabled ? 'pending' : 'disabled',
      })
    }
  }

  async activate(signal?: AbortSignal): Promise<McpToolCatalog> {
    this.assertOpen()
    this.clearCatalog()
    const discovered: Array<{ serverId: string; tools: Parameters<typeof createMcpToolCatalog>[0][number]['tools'] }> = []

    for (const { serverId, originalServerId, config } of this.listEnabledServers()) {
      const managed = this.servers.get(serverId) ?? { serverId, originalServerId, state: 'pending' as const }
      this.servers.set(serverId, managed)
      try {
        throwIfAborted(signal)
        await closeManagedClient(managed)
        managed.error = undefined
        managed.toolCount = undefined
        managed.state = 'connecting'
        const client = await this.options.clientFactory({ serverId, config, signal })
        managed.client = client
        throwIfAborted(signal)
        const listed = await client.listTools(signal)
        throwIfAborted(signal)
        managed.state = 'ready'
        managed.toolCount = listed.tools.length
        discovered.push({ serverId: originalServerId, tools: listed.tools })
      } catch (error) {
        if (isAbortLike(error)) {
          await this.resetAfterActivationAbort()
          throw error
        }
        await closeManagedClient(managed)
        managed.state = 'failed'
        managed.error = error
      }
    }

    this.catalog = createMcpToolCatalog(discovered)
    this.bindingIndex = createMcpToolBindingIndex(this.catalog)
    return cloneMcpToolCatalog(this.catalog)
  }

  getCatalog(): McpToolCatalog {
    return cloneMcpToolCatalog(this.catalog)
  }

  suppressToolBindings(modelNames: Iterable<string>): void {
    const suppressed = new Set(modelNames)
    if (suppressed.size === 0) return
    const dropped = this.catalog.bindings.filter((binding) => suppressed.has(binding.modelName))
    if (dropped.length === 0) return
    this.catalog = {
      bindings: this.catalog.bindings.filter((binding) => !suppressed.has(binding.modelName)),
      diagnostics: [
        ...this.catalog.diagnostics,
        ...dropped.map((binding) => ({
          type: 'reserved-tool-name' as const,
          modelName: binding.modelName,
          dropped: { serverId: binding.originalServerId, toolName: binding.originalToolName },
        })),
      ],
    }
    this.bindingIndex = createMcpToolBindingIndex(this.catalog)
  }

  listStatuses(): McpServerStatusProjection[] {
    return Array.from(this.servers.values()).map((server) => projectMcpServerStatus({
      serverId: server.serverId,
      config: this.serverConfigs.get(server.serverId)?.config,
      lifecycleState: server.state === 'disabled' ? undefined : server.state,
      toolCount: server.toolCount,
      error: server.error,
    }))
  }

  async callTool(input: {
    toolUseId: string
    modelName: string
    arguments: Record<string, unknown>
    signal?: AbortSignal
    maxOutputTokens?: number
    blobWriter?: McpBlobWriter
  }): Promise<ToolResult> {
    if (this.disposed) return mcpErrorToolResult(input.toolUseId, 'MCP manager is disposed')
    throwIfAborted(input.signal)
    const binding = this.bindingIndex.get(input.modelName)
    if (!binding) return mcpErrorToolResult(input.toolUseId, `Unknown MCP tool: ${input.modelName}`)
    const managed = this.servers.get(binding.serverId)
    if (!managed?.client || managed.state !== 'ready') {
      return mcpErrorToolResult(input.toolUseId, `MCP server is not ready: ${binding.serverId}`)
    }
    try {
      const result = await managed.client.callTool({
        name: binding.originalToolName,
        arguments: input.arguments,
        signal: input.signal,
      })
      throwIfAborted(input.signal)
      const resultOptions = this.mapResultOptions(input)
      if (resultOptions.blobWriter) this.blobWriters.add(resultOptions.blobWriter)
      const toolResult = await mapMcpToolResult(result, resultOptions)
      throwIfAborted(input.signal)
      return toolResult
    } catch (error) {
      if (isAbortLike(error)) throw error
      return mcpErrorToolResult(input.toolUseId, `MCP tool call failed: ${errorMessage(error)}`)
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await Promise.all([
      ...Array.from(this.servers.values()).map(async (server) => {
        try {
          await closeManagedClient(server)
        } finally {
          if (server.state !== 'disabled') server.state = 'closed'
        }
      }),
      ...Array.from(this.blobWriters).map((writer) => cleanupBlobWriter(writer)),
    ])
    this.blobWriters.clear()
    this.clearCatalog()
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('MCP manager is disposed')
  }

  private listEnabledServers(): ManagedServerConfig[] {
    return Array.from(this.serverConfigs.values()).filter(({ config }) => config.enabled)
  }

  private clearCatalog(): void {
    this.catalog = emptyMcpToolCatalog()
    this.bindingIndex = new Map()
  }

  private async resetAfterActivationAbort(): Promise<void> {
    await Promise.all(Array.from(this.servers.values()).map(async (server) => {
      await closeManagedClient(server)
      if (server.state !== 'disabled') {
        server.state = 'pending'
        server.toolCount = undefined
        server.error = undefined
      }
    }))
    this.clearCatalog()
  }

  private mapResultOptions(input: {
    toolUseId: string
    maxOutputTokens?: number
    blobWriter?: McpBlobWriter
  }): MapMcpResultOptions {
    const maxOutputTokens = input.maxOutputTokens ?? this.options.maxOutputTokens
    const blobWriter = input.blobWriter ?? this.options.blobWriter
    return {
      toolUseId: input.toolUseId,
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(blobWriter ? { blobWriter } : {}),
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('MCP operation aborted')
}

async function closeManagedClient(managed: ManagedServer): Promise<void> {
  const client = managed.client
  managed.client = undefined
  if (!client) return
  try {
    await client.close()
  } catch {
    // Keep the original activation failure as the diagnostic signal.
  }
}

async function cleanupBlobWriter(writer: McpBlobWriter): Promise<void> {
  try {
    await writer.cleanup?.()
  } catch {
    // Cleanup is best-effort during manager disposal.
  }
}

function emptyMcpToolCatalog(): McpToolCatalog {
  return { bindings: [], diagnostics: [] }
}

function cloneMcpToolCatalog(catalog: McpToolCatalog): McpToolCatalog {
  return structuredClone(catalog)
}

function mcpErrorToolResult(toolUseId: string, message: string): ToolResult {
  return {
    tool_use_id: toolUseId,
    content: `Error: ${message}`,
    is_error: true,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'AbortError' || error.message === 'MCP operation aborted')
}
