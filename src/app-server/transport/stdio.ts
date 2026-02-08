import readline from 'node:readline'

type Readable = NodeJS.ReadableStream
type Writable = NodeJS.WritableStream

export type StdioJsonlTransport = {
  listen: (onLine: (line: string) => Promise<void> | void) => Promise<void>
  send: (message: unknown) => Promise<void>
}

export function createStdioJsonlTransport(args?: { input?: Readable; output?: Writable }): StdioJsonlTransport {
  const input = args?.input ?? process.stdin
  const output = args?.output ?? process.stdout

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
    await new Promise<void>((resolve, reject) => {
      output.write(payload, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  return { listen, send }
}
