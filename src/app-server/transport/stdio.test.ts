import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createStdioJsonlTransport } from './stdio.js'

describe('stdio transport', () => {
  it('listens to JSONL input and sends JSONL output', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = createStdioJsonlTransport({ input, output })

    const lines: string[] = []
    const listenPromise = transport.listen((line) => {
      lines.push(line)
    })

    input.write('{"a":1}\n')
    input.write('\n')
    input.write('{"b":2}\n')
    input.end()
    await listenPromise

    expect(lines).toEqual(['{"a":1}', '{"b":2}'])

    let written = ''
    output.on('data', (chunk) => {
      written += String(chunk)
    })
    await transport.send({ ok: true })
    expect(written).toBe('{"ok":true}\n')
  })
})
