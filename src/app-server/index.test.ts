import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runAppServer } from './index.js'
import { JSON_RPC_ERRORS } from './jsonrpc.js'

async function runWithLines(lines: string[]): Promise<any[]> {
  const input = new PassThrough()
  const output = new PassThrough()
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

  const runPromise = runAppServer({ input, output })
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
    expect(responses[2]?.error?.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND)
  })
})
