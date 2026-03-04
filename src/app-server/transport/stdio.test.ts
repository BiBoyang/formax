import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createStdioJsonlTransport, StdioPayloadTooLargeError } from './stdio.js'

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

  it('throws payload-too-large errors for oversized event payloads', async () => {
    const transport = createStdioJsonlTransport({
      input: new PassThrough(),
      output: new PassThrough(),
      maxEventBytes: 16,
    })

    await expect(transport.send({ data: 'this is too long' })).rejects.toBeInstanceOf(StdioPayloadTooLargeError)
  })

  it('falls back when maxEventBytes is invalid and propagates output write errors', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = createStdioJsonlTransport({
      input,
      output,
      maxEventBytes: 0,
    })

    await expect(transport.send({ ok: true })).resolves.toBeUndefined()

    const failingOutput = {
      write: (_payload: string, cb?: (err?: Error | null) => void) => {
        cb?.(new Error('write failed'))
        return true
      },
    } as unknown as NodeJS.WritableStream

    const failingTransport = createStdioJsonlTransport({
      input: new PassThrough(),
      output: failingOutput,
      maxEventBytes: Number.NaN,
    })
    await expect(failingTransport.send({ ok: true })).rejects.toThrow('write failed')
  })

  it('creates transport with default stdio streams when args are omitted', () => {
    const transport = createStdioJsonlTransport()
    expect(typeof transport.listen).toBe('function')
    expect(typeof transport.send).toBe('function')
  })

  it('stops listening when abort signal is triggered', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = createStdioJsonlTransport({ input, output })
    const controller = new AbortController()

    const lines: string[] = []
    const listenPromise = transport.listen(
      (line) => {
        lines.push(line)
        if (lines.length === 1) controller.abort()
      },
      { signal: controller.signal },
    )

    input.write('{"a":1}\n')
    input.write('{"b":2}\n')
    await listenPromise
    input.end()

    expect(lines).toEqual(['{"a":1}'])
  })
})
