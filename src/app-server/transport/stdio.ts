import readline from 'node:readline'

type Readable = NodeJS.ReadableStream
type Writable = NodeJS.WritableStream

export class StdioPayloadTooLargeError extends Error {
  readonly actualBytes: number
  readonly maxBytes: number
  readonly direction: 'request' | 'event'

  constructor(args: { direction: 'request' | 'event'; actualBytes: number; maxBytes: number }) {
    super(`PAYLOAD_TOO_LARGE (${args.direction}): ${args.actualBytes} > ${args.maxBytes}`)
    this.name = 'StdioPayloadTooLargeError'
    this.actualBytes = args.actualBytes
    this.maxBytes = args.maxBytes
    this.direction = args.direction
  }
}

export type StdioJsonlTransport = {
  listen: (onLine: (line: string) => Promise<void> | void) => Promise<void>
  send: (message: unknown) => Promise<void>
}

function normalizePositiveLimit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  return rounded >= 1 ? rounded : fallback
}

export function createStdioJsonlTransport(args?: {
  input?: Readable
  output?: Writable
  maxEventBytes?: number
}): StdioJsonlTransport {
  const input = args?.input ?? process.stdin
  const output = args?.output ?? process.stdout
  const maxEventBytes = normalizePositiveLimit(args?.maxEventBytes, 1024 * 1024)

  async function listen(onLine: (line: string) => Promise<void> | void): Promise<void> {
    const rl = readline.createInterface({
      input,
      crlfDelay: Infinity,
    })

    try {
      for await (const line of rl) {
        const trimmed = String(line ?? '').trim()
        if (!trimmed) continue
        await onLine(trimmed)
      }
    } finally {
      rl.close()
    }
  }

  async function send(message: unknown): Promise<void> {
    const payload = JSON.stringify(message) + '\n'
    const bytes = Buffer.byteLength(payload, 'utf8')
    if (bytes > maxEventBytes) {
      throw new StdioPayloadTooLargeError({
        direction: 'event',
        actualBytes: bytes,
        maxBytes: maxEventBytes,
      })
    }
    await new Promise<void>((resolve, reject) => {
      output.write(payload, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  return { listen, send }
}
