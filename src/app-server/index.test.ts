import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runAppServer } from './index.js'
import { JSON_RPC_ERRORS } from './jsonrpc.js'

async function runWithLines(
  lines: string[],
  options?: { maxRequestBytes?: number; maxEventBytes?: number },
): Promise<any[]> {
  const input = new PassThrough()
  const output = new PassThrough()
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-run-cwd-'))
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-run-config-'))
  const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
  const responses: any[] = []
  let buffer = ''

  output.on('data', (chunk) => {
    buffer += String(chunk)
    while (true) {
      const idx = buffer.indexOf('\n')
      if (idx < 0) break
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (!line.trim()) continue
      responses.push(JSON.parse(line))
    }
  })

  const runPromise = runAppServer({
    input,
    output,
    cwd,
    env,
    ...(options?.maxRequestBytes !== undefined ? { maxRequestBytes: options.maxRequestBytes } : {}),
    ...(options?.maxEventBytes !== undefined ? { maxEventBytes: options.maxEventBytes } : {}),
  })
  for (const line of lines) {
    input.write(line + '\n')
  }
  input.end()
  await runPromise
  return responses
}

describe('runAppServer', () => {
  it('returns parse error for malformed JSON', async () => {
    const responses = await runWithLines(['{"jsonrpc":"2.0",'])
    expect(responses).toHaveLength(1)
    expect(responses[0]?.error?.code).toBe(JSON_RPC_ERRORS.PARSE_ERROR)
  })

  it('enforces initialize before other requests', async () => {
    const responses = await runWithLines([
      '{"jsonrpc":"2.0","id":1,"method":"thread/start"}',
      '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"clientInfo":{"name":"web","version":"1.0.0"}}}',
      '{"jsonrpc":"2.0","id":3,"method":"thread/start"}',
    ])

    expect(responses).toHaveLength(3)
    expect(responses[0]?.error?.code).toBe(JSON_RPC_ERRORS.NOT_INITIALIZED)
    expect(responses[1]?.result?.serverInfo?.name).toBe('formax')
    expect(responses[2]?.result?.thread?.id).toBeTypeOf('string')
  })

  it('returns PAYLOAD_TOO_LARGE for oversized request lines', async () => {
    const oversized = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"aaaaaaaaaa","version":"1.0.0"}}}'
    const responses = await runWithLines([oversized], { maxRequestBytes: 32 })
    expect(responses).toHaveLength(1)
    expect(responses[0]?.error?.code).toBe(JSON_RPC_ERRORS.PAYLOAD_TOO_LARGE)
    expect(responses[0]?.error?.message).toBe('PAYLOAD_TOO_LARGE')
  })

  it('does not crash when payload-too-large error responses exceed maxEventBytes', async () => {
    const oversized = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"aaaaaaaaaa","version":"1.0.0"}}}'
    const responses = await runWithLines([oversized], {
      maxRequestBytes: 32,
      maxEventBytes: 8,
    })
    expect(responses).toEqual([])
  })

  it('falls back to defaults when maxRequestBytes is NaN', async () => {
    const hugeName = 'x'.repeat(1024 * 1024 + 128)
    const oversized = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: hugeName, version: '1.0.0' } },
    })
    const responses = await runWithLines([oversized], {
      maxRequestBytes: Number.NaN,
      maxEventBytes: 2 * 1024 * 1024,
    })
    expect(responses).toHaveLength(1)
    expect(responses[0]?.error?.code).toBe(JSON_RPC_ERRORS.PAYLOAD_TOO_LARGE)
  })
})
