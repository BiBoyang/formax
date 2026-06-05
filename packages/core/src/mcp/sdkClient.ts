import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Stream } from 'node:stream'
import type { McpClient, McpClientFactory } from './client.js'
import { createSingleCwdMcpRootsList } from './roots.js'
import type { McpServerConfig, McpToolCallResult } from './types.js'

export type SdkMcpClientFactoryOptions = {
  cwd: string
  env?: NodeJS.ProcessEnv
  clientName?: string
  clientVersion?: string
}

export function createSdkMcpClientFactory(options: SdkMcpClientFactoryOptions): McpClientFactory {
  return async ({ config, signal }) => {
    const client = new Client(
      {
        name: options.clientName ?? 'formax',
        version: options.clientVersion ?? '0.0.0',
      },
      {
        capabilities: {
          roots: { listChanged: false },
        },
      },
    )
    client.setRequestHandler(ListRootsRequestSchema, () => createSingleCwdMcpRootsList(options.cwd))

    await client.connect(createTransport(config, options.cwd, options.env ?? process.env), requestOptions(config, signal))

    return {
      async listTools(listSignal) {
        const result = await client.listTools(undefined, requestOptions(config, listSignal))
        return {
          tools: result.tools.map((tool) => ({
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.inputSchema,
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
          })),
        }
      },
      async callTool(input) {
        const result = await client.callTool(
          { name: input.name, arguments: input.arguments },
          undefined,
          requestOptions(config, input.signal),
        )
        return normalizeCallToolResult(result)
      },
      async close() {
        await client.close()
      },
    } satisfies McpClient
  }
}

function createTransport(
  config: McpServerConfig,
  defaultCwd: string,
  env: NodeJS.ProcessEnv,
): StdioClientTransport | StreamableHTTPClientTransport {
  if (config.type === 'stdio') {
    const transport = new StdioClientTransport({
      command: config.command,
      ...(config.args ? { args: config.args } : {}),
      env: buildStdioEnvironment(config.env ?? {}, env),
      cwd: config.cwd ?? defaultCwd,
      stderr: 'pipe',
    })
    drainStdioStderr(transport.stderr)
    return transport
  }

  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined,
  })
}

function drainStdioStderr(stderr: Stream | null): void {
  stderr?.on('data', () => {
    // MCP server stderr is diagnostic noise in Phase 1A: drain it so child
    // processes cannot block, but do not expose it to model-facing surfaces.
  })
}

function buildStdioEnvironment(overrides: Record<string, string>, sourceEnv: NodeJS.ProcessEnv): Record<string, string> {
  return {
    ...getDefaultEnvironment(),
    ...safeInheritedEnvironment(sourceEnv),
    ...overrides,
  }
}

const SAFE_INHERITED_STDIO_ENV_KEYS = new Set([
  'PATH',
  'Path',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SSH_AUTH_SOCK',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
])

function safeInheritedEnvironment(sourceEnv: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of SAFE_INHERITED_STDIO_ENV_KEYS) {
    const value = sourceEnv[key]
    if (typeof value === 'string') env[key] = value
  }
  return env
}

function requestOptions(config: McpServerConfig, signal?: AbortSignal): { signal?: AbortSignal; timeout?: number } {
  return {
    ...(signal ? { signal } : {}),
    ...(config.timeoutMs ? { timeout: config.timeoutMs } : {}),
  }
}

function normalizeCallToolResult(result: unknown): McpToolCallResult {
  if (!result || typeof result !== 'object') {
    return { content: [{ type: 'text', text: String(result) }] }
  }
  const objectResult = result as Record<string, unknown>
  if ('content' in objectResult || 'structuredContent' in objectResult || 'isError' in objectResult) {
    return {
      ...(Array.isArray(objectResult.content) ? { content: objectResult.content } : {}),
      ...('structuredContent' in objectResult ? { structuredContent: objectResult.structuredContent } : {}),
      ...(typeof objectResult.isError === 'boolean' ? { isError: objectResult.isError } : {}),
    }
  }
  if ('toolResult' in objectResult) {
    return { structuredContent: objectResult.toolResult }
  }
  return { structuredContent: objectResult }
}
