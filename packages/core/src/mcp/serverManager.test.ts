import { describe, expect, it, vi } from 'vitest'
import type { McpClient, McpClientFactory } from './client.js'
import { FakeMcpClient } from './fakeClient.js'
import { McpServerManager } from './serverManager.js'
import type { McpConfig } from './types.js'

function baseConfig(): McpConfig {
  return {
    servers: {
      github: { type: 'stdio', command: 'github-mcp', enabled: true },
      disabled: { type: 'stdio', command: 'disabled-mcp', enabled: false },
    },
  }
}

describe('McpServerManager', () => {
  it('activates enabled servers and exposes discovered MCP tools', async () => {
    const githubClient = new FakeMcpClient([
      {
        name: 'Create/Issue',
        description: 'Create issue',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      },
    ])
    const factory = vi.fn(async ({ serverId }) => {
      expect(serverId).toBe('github')
      return githubClient
    }) satisfies McpClientFactory

    const manager = new McpServerManager({ config: baseConfig(), clientFactory: factory })
    const catalog = await manager.activate()

    expect(factory).toHaveBeenCalledTimes(1)
    expect(githubClient.listToolsCount).toBe(1)
    expect(catalog.bindings.map((binding) => binding.modelName)).toEqual([
      'mcp__github__create_issue',
    ])
    expect(manager.listStatuses()).toEqual([
      { serverId: 'github', state: 'ready', enabled: true, toolCount: 1 },
      { serverId: 'disabled', state: 'disabled', enabled: false },
    ])
  })

  it('dispatches model-facing tool names to original MCP tool names', async () => {
    const githubClient = new FakeMcpClient([
      {
        name: 'Create/Issue',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      },
    ], {
      'Create/Issue': { content: [{ type: 'text', text: 'created' }] },
    })
    const manager = new McpServerManager({
      config: baseConfig(),
      clientFactory: async () => githubClient,
    })

    await manager.activate()
    await expect(manager.callTool({
      toolUseId: 'toolu_1',
      modelName: 'mcp__github__create_issue',
      arguments: { title: 'hello' },
    })).resolves.toEqual({
      tool_use_id: 'toolu_1',
      content: [{ type: 'text', text: 'created' }],
    })
    expect(githubClient.calls).toEqual([
      { name: 'Create/Issue', arguments: { title: 'hello' } },
    ])
  })

  it('dispatches tools for directly constructed configs with raw server ids', async () => {
    const client = new FakeMcpClient([
      { name: 'Create/Issue', inputSchema: { type: 'object' } },
    ])
    const factory = vi.fn(async ({ serverId }) => {
      expect(serverId).toBe('github_enterprise')
      return client
    }) satisfies McpClientFactory
    const manager = new McpServerManager({
      config: {
        servers: {
          'GitHub Enterprise': { type: 'stdio', command: 'github-mcp', enabled: true },
        },
      },
      clientFactory: factory,
    })

    const catalog = await manager.activate()
    expect(catalog.bindings[0]).toMatchObject({
      serverId: 'github_enterprise',
      originalServerId: 'GitHub Enterprise',
    })
    await manager.callTool({
      toolUseId: 'toolu_1',
      modelName: 'mcp__github_enterprise__create_issue',
      arguments: { title: 'hello' },
    })

    expect(client.calls).toEqual([
      { name: 'Create/Issue', arguments: { title: 'hello' } },
    ])
  })

  it('rejects direct configs with normalized server id collisions', () => {
    expect(() => new McpServerManager({
      config: {
        servers: {
          GitHub: { type: 'stdio', command: 'github-a', enabled: true },
          github: { type: 'stdio', command: 'github-b', enabled: true },
        },
      },
      clientFactory: async () => new FakeMcpClient([]),
    })).toThrow('MCP server id collision: github collides with GitHub after normalization to github')
  })

  it('returns defensive catalog snapshots that cannot mutate dispatch bindings', async () => {
    const client = new FakeMcpClient([
      { name: 'original', inputSchema: { type: 'object' } },
    ])
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: async () => client,
    })

    const activatedCatalog = await manager.activate()
    activatedCatalog.bindings[0]!.originalToolName = 'mutated'
    activatedCatalog.bindings.splice(0)

    const snapshot = manager.getCatalog()
    snapshot.bindings[0]!.originalToolName = 'also_mutated'

    expect(manager.getCatalog().bindings[0]?.originalToolName).toBe('original')
    await manager.callTool({
      toolUseId: 'toolu_1',
      modelName: 'mcp__local__original',
      arguments: {},
    })
    expect(client.calls).toEqual([{ name: 'original', arguments: {} }])
  })

  it('reads status snapshots without rediscovering tools', async () => {
    const client = new FakeMcpClient([{ name: 'tool', inputSchema: { type: 'object' } }])
    const factory = vi.fn(async () => client) satisfies McpClientFactory
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: factory,
    })

    await manager.activate()
    expect(manager.listStatuses()).toEqual([
      { serverId: 'local', state: 'ready', enabled: true, toolCount: 1 },
    ])
    expect(manager.listStatuses()).toEqual([
      { serverId: 'local', state: 'ready', enabled: true, toolCount: 1 },
    ])

    expect(factory).toHaveBeenCalledTimes(1)
    expect(client.listToolsCount).toBe(1)
  })

  it('returns stable ToolResult errors for unknown bindings without calling clients', async () => {
    const client = new FakeMcpClient([{ name: 'tool', inputSchema: { type: 'object' } }])
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: async () => client,
    })

    await manager.activate()

    await expect(manager.callTool({
      toolUseId: 'toolu_missing',
      modelName: 'mcp__local__missing',
      arguments: {},
    })).resolves.toEqual({
      tool_use_id: 'toolu_missing',
      content: 'Error: Unknown MCP tool: mcp__local__missing',
      is_error: true,
    })
    expect(client.calls).toEqual([])
  })

  it('closes clients on disposal and returns stable call errors after disposal', async () => {
    const client = new FakeMcpClient([
      { name: 'tool', inputSchema: { type: 'object' } },
    ])
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: async () => client,
    })

    await manager.activate()
    await manager.dispose()
    await manager.dispose()

    expect(client.closeCount).toBe(1)
    expect(manager.listStatuses()).toEqual([
      { serverId: 'local', state: 'closed', enabled: true, toolCount: 1 },
    ])
    await expect(manager.callTool({
      toolUseId: 'toolu_closed',
      modelName: 'mcp__local__tool',
      arguments: {},
    })).resolves.toEqual({
      tool_use_id: 'toolu_closed',
      content: 'Error: MCP manager is disposed',
      is_error: true,
    })
  })

  it('records activation failures as failed status without throwing', async () => {
    const manager = new McpServerManager({
      config: { servers: { broken: { type: 'stdio', command: 'broken-mcp', enabled: true } } },
      clientFactory: async () => {
        throw new Error('boom')
      },
    })

    await expect(manager.activate()).resolves.toEqual({ bindings: [], diagnostics: [] })
    expect(manager.listStatuses()).toEqual([
      { serverId: 'broken', state: 'failed', enabled: true, errorMessage: 'boom' },
    ])
  })

  it('closes a partially initialized client when tool discovery fails', async () => {
    const client = {
      listTools: vi.fn(async () => {
        throw new Error('list failed')
      }),
      callTool: vi.fn(),
      close: vi.fn(async () => {}),
    } satisfies McpClient
    const manager = new McpServerManager({
      config: { servers: { broken: { type: 'stdio', command: 'broken-mcp', enabled: true } } },
      clientFactory: async () => client,
    })

    await expect(manager.activate()).resolves.toEqual({ bindings: [], diagnostics: [] })
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(manager.listStatuses()).toEqual([
      { serverId: 'broken', state: 'failed', enabled: true, errorMessage: 'list failed' },
    ])
  })

  it('records listTools timeout failures without exposing dynamic tools', async () => {
    const client = {
      listTools: vi.fn(async () => {
        throw new Error('Timed out after 1000ms')
      }),
      callTool: vi.fn(),
      close: vi.fn(async () => {}),
    } satisfies McpClient
    const manager = new McpServerManager({
      config: { servers: { slow: { type: 'stdio', command: 'slow-mcp', enabled: true, timeoutMs: 1000 } } },
      clientFactory: async () => client,
    })

    await expect(manager.activate()).resolves.toEqual({ bindings: [], diagnostics: [] })
    expect(manager.getCatalog()).toEqual({ bindings: [], diagnostics: [] })
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(manager.listStatuses()).toEqual([
      { serverId: 'slow', state: 'failed', enabled: true, errorMessage: 'Timed out after 1000ms' },
    ])
  })

  it('propagates activation aborts and closes any partially initialized client', async () => {
    const controller = new AbortController()
    const client = {
      listTools: vi.fn(async () => ({ tools: [] })),
      callTool: vi.fn(),
      close: vi.fn(async () => {}),
    } satisfies McpClient
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: async () => {
        controller.abort()
        return client
      },
    })

    await expect(manager.activate(controller.signal)).rejects.toThrow('MCP operation aborted')
    expect(client.listTools).not.toHaveBeenCalled()
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(manager.listStatuses()).toEqual([
      { serverId: 'local', state: 'pending', enabled: true },
    ])
  })

  it('clears stale catalog bindings when reactivation aborts mid-refresh', async () => {
    const controller = new AbortController()
    const first = new FakeMcpClient([{ name: 'first', inputSchema: { type: 'object' } }])
    const second = new FakeMcpClient([{ name: 'second', inputSchema: { type: 'object' } }])
    const factory = vi.fn()
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(async () => {
        controller.abort()
        return second
      }) satisfies McpClientFactory
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: factory,
    })

    await manager.activate()
    expect(manager.getCatalog().bindings.map((binding) => binding.modelName)).toEqual([
      'mcp__local__first',
    ])

    await expect(manager.activate(controller.signal)).rejects.toThrow('MCP operation aborted')

    expect(first.closeCount).toBe(1)
    expect(second.closeCount).toBe(1)
    expect(manager.getCatalog()).toEqual({ bindings: [], diagnostics: [] })
    expect(manager.listStatuses()).toEqual([
      { serverId: 'local', state: 'pending', enabled: true },
    ])
  })

  it('honors activation aborts after a non-cooperative listTools resolves', async () => {
    const controller = new AbortController()
    const client = {
      listTools: vi.fn(async () => {
        controller.abort()
        return { tools: [{ name: 'tool', inputSchema: { type: 'object' } }] }
      }),
      callTool: vi.fn(),
      close: vi.fn(async () => {}),
    } satisfies McpClient
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: async () => client,
    })

    await expect(manager.activate(controller.signal)).rejects.toThrow('MCP operation aborted')
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(manager.getCatalog()).toEqual({ bindings: [], diagnostics: [] })
    expect(manager.listStatuses()).toEqual([
      { serverId: 'local', state: 'pending', enabled: true },
    ])
  })

  it('clears stale error state after a successful activation retry', async () => {
    const client = new FakeMcpClient([{ name: 'tool', inputSchema: { type: 'object' } }])
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(client) satisfies McpClientFactory
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: factory,
    })

    await expect(manager.activate()).resolves.toEqual({ bindings: [], diagnostics: [] })
    expect(manager.listStatuses()).toEqual([
      { serverId: 'local', state: 'failed', enabled: true, errorMessage: 'temporary failure' },
    ])

    await manager.activate()
    expect(manager.listStatuses()).toEqual([
      { serverId: 'local', state: 'ready', enabled: true, toolCount: 1 },
    ])
  })

  it('closes the previous client before replacing it on reactivation', async () => {
    const first = new FakeMcpClient([{ name: 'first', inputSchema: { type: 'object' } }])
    const second = new FakeMcpClient([{ name: 'second', inputSchema: { type: 'object' } }])
    const factory = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second) satisfies McpClientFactory
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: factory,
    })

    await manager.activate()
    await manager.activate()

    expect(first.closeCount).toBe(1)
    expect(second.closeCount).toBe(0)

    await manager.dispose()
    expect(first.closeCount).toBe(1)
    expect(second.closeCount).toBe(1)
  })

  it('cleans registered blob writers on disposal', async () => {
    const client = new FakeMcpClient([
      { name: 'image', inputSchema: { type: 'object' } },
    ], {
      image: {
        content: [{
          type: 'image',
          data: Buffer.from('tiny').toString('base64'),
          mimeType: 'image/png',
        }],
      },
    })
    const blobWriter = {
      writeBlob: vi.fn(async () => ({ path: '/tmp/mcp-output/image.png' })),
      cleanup: vi.fn(async () => {}),
    }
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: async () => client,
      blobWriter,
    })

    await manager.activate()
    await expect(manager.callTool({
      toolUseId: 'toolu_image',
      modelName: 'mcp__local__image',
      arguments: {},
    })).resolves.toEqual({
      tool_use_id: 'toolu_image',
      content: [{ type: 'text', text: '[MCP image written to /tmp/mcp-output/image.png (image/png, 4 bytes)]' }],
    })

    expect(blobWriter.writeBlob).toHaveBeenCalledTimes(1)
    await manager.dispose()
    expect(blobWriter.cleanup).toHaveBeenCalledTimes(1)
  })

  it('finishes disposal cleanup when a client close rejects', async () => {
    const client = {
      listTools: vi.fn(async () => ({ tools: [{ name: 'tool', inputSchema: { type: 'object' } }] })),
      callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
      close: vi.fn(async () => {
        throw new Error('already dead')
      }),
    } satisfies McpClient
    const blobWriter = {
      writeBlob: vi.fn(async () => ({ path: '/tmp/mcp-output/blob.bin' })),
      cleanup: vi.fn(async () => {}),
    }
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: async () => client,
      blobWriter,
    })

    await manager.activate()
    await manager.callTool({
      toolUseId: 'toolu_1',
      modelName: 'mcp__local__tool',
      arguments: {},
    })

    await expect(manager.dispose()).resolves.toBeUndefined()
    expect(blobWriter.cleanup).toHaveBeenCalledTimes(1)
    expect(manager.getCatalog()).toEqual({ bindings: [], diagnostics: [] })
    expect(manager.listStatuses()).toEqual([
      { serverId: 'local', state: 'closed', enabled: true, toolCount: 1 },
    ])
  })

  it('honors call aborts after a non-cooperative tool call resolves', async () => {
    const controller = new AbortController()
    const client = {
      listTools: vi.fn(async () => ({ tools: [{ name: 'tool', inputSchema: { type: 'object' } }] })),
      callTool: vi.fn(async () => {
        controller.abort()
        return { content: [{ type: 'text', text: 'late result' }] }
      }),
      close: vi.fn(async () => {}),
    } satisfies McpClient
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: async () => client,
    })

    await manager.activate()
    await expect(manager.callTool({
      toolUseId: 'toolu_1',
      modelName: 'mcp__local__tool',
      arguments: {},
      signal: controller.signal,
    })).rejects.toThrow('MCP operation aborted')
  })

  it('honors abort signals before calling MCP tools', async () => {
    const client = new FakeMcpClient([{ name: 'tool', inputSchema: { type: 'object' } }])
    const manager = new McpServerManager({
      config: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      clientFactory: async () => client,
    })
    const controller = new AbortController()

    await manager.activate()
    controller.abort()

    await expect(manager.callTool({
      toolUseId: 'toolu_1',
      modelName: 'mcp__local__tool',
      arguments: {},
      signal: controller.signal,
    })).rejects.toThrow('MCP operation aborted')
    expect(client.calls).toEqual([])
  })
})
