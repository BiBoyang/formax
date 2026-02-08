import { createServer } from 'node:http'
import { PassThrough } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { runAppServer } from './index.js'

export type AppServerDevBridgeOptions = {
  host?: string
  port?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
  maxRequestBytes?: number
  maxEventBytes?: number
  maxPendingInputsPerThread?: number
  defaultInputTtlMs?: number
}

export type AppServerDevBridgeHandle = {
  url: string
  close: () => Promise<void>
}

function writeJsonlLine(stream: PassThrough, text: string): void {
  const line = text.trim()
  if (!line) return
  stream.write(line + '\n')
}

function broadcastLine(clients: Iterable<WebSocket>, line: string): void {
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue
    try {
      client.send(line)
    } catch {
      // Dev bridge best-effort broadcast; ignore closed/broken sockets.
    }
  }
}

export async function startAppServerDevBridge(options: AppServerDevBridgeOptions = {}): Promise<AppServerDevBridgeHandle> {
  const input = new PassThrough()
  const output = new PassThrough()
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 3777
  const httpServer = createServer()
  const wsServer = new WebSocketServer({ server: httpServer })
  const clients = new Set<WebSocket>()
  let outputBuffer = ''
  let closed = false

  output.on('data', (chunk) => {
    outputBuffer += chunk.toString('utf8')
    while (true) {
      const idx = outputBuffer.indexOf('\n')
      if (idx < 0) break
      const line = outputBuffer.slice(0, idx)
      outputBuffer = outputBuffer.slice(idx + 1)
      if (!line.trim()) continue
      broadcastLine(clients, line)
    }
  })

  wsServer.on('connection', (socket) => {
    clients.add(socket)
    socket.on('close', () => {
      clients.delete(socket)
    })
    socket.on('error', () => undefined)
    socket.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8')
      for (const line of text.split(/\r?\n/)) {
        writeJsonlLine(input, line)
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      httpServer.off('error', onError)
      reject(err)
    }
    httpServer.once('error', onError)
    try {
      httpServer.listen(port, host, () => {
        httpServer.off('error', onError)
        resolve()
      })
    } catch (err) {
      httpServer.off('error', onError)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })

  const addr = httpServer.address()
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to resolve app-server dev bridge address')
  }
  const url = `ws://${host}:${addr.port}`

  const runPromise = runAppServer({
    input,
    output,
    cwd: options.cwd,
    env: options.env,
    maxRequestBytes: options.maxRequestBytes,
    maxEventBytes: options.maxEventBytes,
    maxPendingInputsPerThread: options.maxPendingInputsPerThread,
    defaultInputTtlMs: options.defaultInputTtlMs,
  })
  // Keep the long-running loop from surfacing unhandled rejections in process-global handlers.
  void runPromise.catch(() => undefined)

  return {
    url,
    close: async () => {
      if (closed) return
      closed = true

      for (const client of clients) {
        try {
          client.close()
        } catch {
          // ignore
        }
      }
      clients.clear()

      await new Promise<void>((resolve) => {
        wsServer.close(() => resolve())
      })

      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })

      input.end()
      output.end()
      await runPromise.catch(() => undefined)
    },
  }
}
