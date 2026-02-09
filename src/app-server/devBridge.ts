import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
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

type BridgeReadDiffParams = {
  maxBytes?: number
}

type BridgeDiffFile = {
  path: string
  additions: number
  deletions: number
  patch: string
  untracked?: boolean
}

type BridgeReadDiffResult = {
  cwd: string
  generatedAt: string
  hasChanges: boolean
  truncated: boolean
  files: BridgeDiffFile[]
}

function normalizeMaxBytes(value: unknown, fallback = 180 * 1024): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(32 * 1024, Math.min(parsed, 2 * 1024 * 1024))
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

async function runGit(cwd: string, args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, error: String(stderr || error.message || 'git command failed') })
          return
        }
        resolve({ ok: true, stdout: String(stdout) })
      },
    )
  })
}

function parsePatchFiles(diffText: string): BridgeDiffFile[] {
  if (!diffText.trim()) return []
  const chunks = diffText.split(/(?=^diff --git )/gm).filter((chunk) => chunk.trim())
  const files: BridgeDiffFile[] = []
  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    const first = lines[0] ?? ''
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(first.trim())
    const path = match ? (match[2] || match[1]) : 'unknown'
    let additions = 0
    let deletions = 0
    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) continue
      if (line.startsWith('+')) additions += 1
      if (line.startsWith('-')) deletions += 1
    }
    files.push({
      path,
      additions,
      deletions,
      patch: chunk.trimEnd(),
    })
  }
  return files
}

function truncateDiffFilesByBytes(files: BridgeDiffFile[], maxBytes: number): { files: BridgeDiffFile[]; truncated: boolean } {
  let used = 0
  const out: BridgeDiffFile[] = []
  for (const file of files) {
    const baseBytes = Buffer.byteLength(file.path, 'utf8') + 128
    if (used + baseBytes >= maxBytes) {
      return { files: out, truncated: true }
    }
    let patch = file.patch
    const patchBytes = Buffer.byteLength(patch, 'utf8')
    const budget = maxBytes - used - baseBytes
    let truncated = false
    if (patchBytes > budget) {
      const clipped = Buffer.from(patch, 'utf8').subarray(0, Math.max(0, budget - 64)).toString('utf8')
      patch = `${clipped}\n... [file patch truncated]`
      truncated = true
    }
    out.push({ ...file, patch })
    used += baseBytes + Buffer.byteLength(patch, 'utf8')
    if (truncated) return { files: out, truncated: true }
  }
  return { files: out, truncated: false }
}

async function readWorkspaceDiff(cwd: string, params: BridgeReadDiffParams | undefined): Promise<BridgeReadDiffResult> {
  const maxBytes = normalizeMaxBytes(params?.maxBytes)
  const generatedAt = new Date().toISOString()

  const [diffFromHead, fallbackDiff, untracked] = await Promise.all([
    runGit(cwd, ['diff', 'HEAD', '--no-color', '--patch', '--find-renames']),
    runGit(cwd, ['diff', '--no-color', '--patch', '--find-renames']),
    runGit(cwd, ['ls-files', '--others', '--exclude-standard']),
  ])

  if (!diffFromHead.ok && !fallbackDiff.ok && !untracked.ok) {
    const firstError = [diffFromHead, fallbackDiff, untracked]
      .filter((result): result is { ok: false; error: string } => !result.ok)
      .map((result) => result.error)[0]
    return {
      cwd,
      generatedAt,
      hasChanges: false,
      truncated: false,
      files: [
        {
          path: 'git-diff-error',
          additions: 0,
          deletions: 0,
          patch: `git diff unavailable in ${cwd}\n${firstError ?? 'unknown error'}`,
        },
      ],
    }
  }

  const diffText =
    (diffFromHead.ok && diffFromHead.stdout.trim()
      ? diffFromHead.stdout
      : fallbackDiff.ok
        ? fallbackDiff.stdout
        : '') || ''
  const trackedFiles = parsePatchFiles(diffText)
  const untrackedFiles = untracked.ok
    ? untracked.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((path) => ({
          path,
          additions: 0,
          deletions: 0,
          patch: 'new file (untracked)',
          untracked: true as const,
        }))
    : []
  const combinedFiles = [...trackedFiles, ...untrackedFiles]
  const clipped = truncateDiffFilesByBytes(combinedFiles, maxBytes)

  return {
    cwd,
    generatedAt,
    hasChanges: combinedFiles.length > 0,
    truncated: clipped.truncated,
    files: clipped.files,
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
        const trimmed = line.trim()
        if (!trimmed) continue
        let parsed: any = null
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          writeJsonlLine(input, line)
          continue
        }

        const isRequest =
          parsed &&
          typeof parsed === 'object' &&
          parsed.jsonrpc === '2.0' &&
          parsed.id !== undefined &&
          typeof parsed.method === 'string'

        if (isRequest && parsed.method === 'bridge/readDiff') {
          const params = (parsed.params ?? {}) as BridgeReadDiffParams
          void readWorkspaceDiff(options.cwd ?? process.cwd(), params)
            .then((result) => {
              if (socket.readyState !== WebSocket.OPEN) return
              socket.send(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }))
            })
            .catch((error) => {
              if (socket.readyState !== WebSocket.OPEN) return
              socket.send(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: parsed.id,
                  error: { code: -32603, message: String(error instanceof Error ? error.message : error) },
                }),
              )
            })
          continue
        }

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
