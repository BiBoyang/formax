import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSdkMcpClientFactory } from './sdkClient.js'

describe('createSdkMcpClientFactory stdio integration', () => {
  it('lists and calls a controlled stdio MCP server fixture', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-mcp-stdio-fixture-'))
    const serverPath = path.join(dir, 'server.mjs')
    const sdkRoot = path.resolve('node_modules/@modelcontextprotocol/sdk/dist/esm')
    const mcpServerUrl = pathToFileURL(path.join(sdkRoot, 'server/mcp.js')).href
    const stdioTransportUrl = pathToFileURL(path.join(sdkRoot, 'server/stdio.js')).href

    await fs.writeFile(serverPath, `
import { McpServer } from ${JSON.stringify(mcpServerUrl)}
import { StdioServerTransport } from ${JSON.stringify(stdioTransportUrl)}

const server = new McpServer({ name: 'formax-stdio-fixture', version: '1.0.0' })
server.registerTool('ping', { description: 'Return pong' }, async () => ({
  content: [{ type: 'text', text: 'pong' }]
}))

await server.connect(new StdioServerTransport())
`, { mode: 0o700 })

    const client = await createSdkMcpClientFactory({ cwd: dir })({
      serverId: 'fixture',
      config: {
        type: 'stdio',
        command: process.execPath,
        args: [serverPath],
        timeoutMs: 5_000,
        enabled: true,
      },
    })

    try {
      await expect(client.listTools()).resolves.toMatchObject({
        tools: [{ name: 'ping', description: 'Return pong' }],
      })
      await expect(client.callTool({ name: 'ping', arguments: {} })).resolves.toEqual({
        content: [{ type: 'text', text: 'pong' }],
      })
    } finally {
      await client.close()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
