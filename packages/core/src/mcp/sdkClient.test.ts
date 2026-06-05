import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const clientInstances: any[] = []
  const stdioTransports: any[] = []
  const httpTransports: any[] = []

  class Client {
    info: any
    options: any
    connect = vi.fn(async () => {})
    listTools = vi.fn(async () => ({
      tools: [{
        name: 'create_issue',
        description: 'Create issue',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      }],
    }))
    callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    }))
    close = vi.fn(async () => {})
    setRequestHandler = vi.fn()

    constructor(info: any, options: any) {
      this.info = info
      this.options = options
      clientInstances.push(this)
    }
  }

  class StdioClientTransport {
    params: any

    constructor(params: any) {
      this.params = params
      stdioTransports.push(this)
    }
  }

  class StreamableHTTPClientTransport {
    url: URL
    options: any

    constructor(url: URL, options: any) {
      this.url = url
      this.options = options
      httpTransports.push(this)
    }
  }

  return {
    Client,
    StdioClientTransport,
    StreamableHTTPClientTransport,
    getDefaultEnvironment: vi.fn(() => ({ PATH: '/safe/bin', HOME: '/home/user' })),
    ListRootsRequestSchema: { method: 'roots/list' },
    clientInstances,
    stdioTransports,
    httpTransports,
  }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: mocks.Client,
}))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  getDefaultEnvironment: mocks.getDefaultEnvironment,
  StdioClientTransport: mocks.StdioClientTransport,
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mocks.StreamableHTTPClientTransport,
}))
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListRootsRequestSchema: mocks.ListRootsRequestSchema,
}))

import { createSdkMcpClientFactory } from './sdkClient.js'

describe('createSdkMcpClientFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clientInstances.length = 0
    mocks.stdioTransports.length = 0
    mocks.httpTransports.length = 0
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('creates a stdio SDK client and exposes list/call/close through the internal client interface', async () => {
    vi.stubEnv('PATH', '/process/bin')

    const factory = createSdkMcpClientFactory({
      cwd: '/repo',
      env: {
        GITHUB_TOKEN: 'token-from-runtime',
        PATH: '/runtime/bin',
        SSH_AUTH_SOCK: '/tmp/runtime-ssh.sock',
      } as any,
      clientName: 'test-formax',
      clientVersion: '1.2.3',
    })
    const client = await factory({
      serverId: 'local',
      config: {
        type: 'stdio',
        command: 'mcp-server',
        args: ['--flag'],
        env: { API_KEY: 'x' },
        cwd: '/repo/server',
        timeoutMs: 5678,
        enabled: true,
      },
    })

    expect(mocks.stdioTransports[0].params).toEqual(expect.objectContaining({
      command: 'mcp-server',
      args: ['--flag'],
      cwd: '/repo/server',
      stderr: 'pipe',
    }))
    expect(mocks.stdioTransports[0].params.env).toEqual(expect.objectContaining({
      API_KEY: 'x',
      PATH: '/runtime/bin',
      HOME: '/home/user',
      SSH_AUTH_SOCK: '/tmp/runtime-ssh.sock',
    }))
    expect(mocks.stdioTransports[0].params.env).not.toHaveProperty('GITHUB_TOKEN')
    expect(mocks.getDefaultEnvironment).toHaveBeenCalledTimes(1)
    expect(mocks.clientInstances[0].info).toEqual({ name: 'test-formax', version: '1.2.3' })
    expect(mocks.clientInstances[0].options.capabilities).toEqual({ roots: { listChanged: false } })
    expect(mocks.clientInstances[0].setRequestHandler).toHaveBeenCalledWith(
      mocks.ListRootsRequestSchema,
      expect.any(Function),
    )
    expect(mocks.clientInstances[0].connect).toHaveBeenCalledWith(mocks.stdioTransports[0], { timeout: 5678 })

    await expect(client.listTools()).resolves.toEqual({
      tools: [{
        name: 'create_issue',
        description: 'Create issue',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      }],
    })
    expect(mocks.clientInstances[0].listTools).toHaveBeenCalledWith(undefined, { timeout: 5678 })
    await expect(client.callTool({ name: 'create_issue', arguments: { title: 'A' } })).resolves.toEqual({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    })
    await client.close()

    expect(mocks.clientInstances[0].callTool).toHaveBeenCalledWith(
      { name: 'create_issue', arguments: { title: 'A' } },
      undefined,
      { timeout: 5678 },
    )
    expect(mocks.clientInstances[0].close).toHaveBeenCalledTimes(1)
  })

  it('defaults stdio server cwd to the runtime cwd', async () => {
    const factory = createSdkMcpClientFactory({ cwd: '/repo/runtime' })

    await factory({
      serverId: 'local',
      config: {
        type: 'stdio',
        command: 'mcp-server',
        enabled: true,
      },
    })

    expect(mocks.stdioTransports[0].params).toEqual(expect.objectContaining({
      cwd: '/repo/runtime',
    }))
  })

  it('creates a Streamable HTTP SDK client with headers and timeout', async () => {
    const signal = new AbortController().signal
    const factory = createSdkMcpClientFactory({ cwd: '/repo' })

    const client = await factory({
      serverId: 'remote',
      signal,
      config: {
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' },
        timeoutMs: 1234,
        enabled: true,
      },
    })
    await client.listTools(signal)

    expect(mocks.httpTransports[0].url.href).toBe('https://example.com/mcp')
    expect(mocks.httpTransports[0].options).toEqual({
      requestInit: { headers: { Authorization: 'Bearer token' } },
    })
    expect(mocks.clientInstances[0].connect).toHaveBeenCalledWith(
      mocks.httpTransports[0],
      { signal, timeout: 1234 },
    )
    expect(mocks.clientInstances[0].listTools).toHaveBeenCalledWith(undefined, { signal, timeout: 1234 })
  })
})
