import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { startAppServerDevBridge } from './devBridge.js'

const {
  createServerMock,
  httpAddressMock,
  httpCloseMock,
  httpListenMock,
  httpOffMock,
  httpOnceMock,
  runAppServerMock,
  wsCtorMock,
  wsServerCloseMock,
  getConnectionHandler,
  setConnectionHandler,
  resetState,
  readInputBuffer,
  readRunAppServerArgs,
} = vi.hoisted(() => {
  let connectionHandler: ((socket: any, request?: { url?: string; headers?: { origin?: string } }) => void) | null = null
  let inputBuffer = ''
  let runAppServerArgs: any | null = null

  const httpAddressMock = vi.fn(() => ({ address: '127.0.0.1', family: 'IPv4', port: 3777 }))
  const httpCloseMock = vi.fn((cb?: () => void) => cb?.())
  const httpListenMock = vi.fn((port: number, host: string, cb?: () => void) => cb?.())
  const httpOffMock = vi.fn()
  const httpOnceMock = vi.fn()

  const createServerMock = vi.fn(() => ({
    address: httpAddressMock,
    close: httpCloseMock,
    listen: httpListenMock,
    off: httpOffMock,
    once: httpOnceMock,
  }))

  const wsServerCloseMock = vi.fn((cb?: () => void) => cb?.())
  const wsCtorMock = vi.fn()

  const runAppServerMock = vi.fn(async (args: any) => {
    runAppServerArgs = args
    args.input?.on('data', (chunk: Buffer | string) => {
      inputBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    })
    await new Promise<void>((resolve) => {
      args.input?.once('end', () => resolve())
    })
  })

  const resetState = () => {
    connectionHandler = null
    inputBuffer = ''
    runAppServerArgs = null
  }

  return {
    createServerMock,
    httpAddressMock,
    httpCloseMock,
    httpListenMock,
    httpOffMock,
    httpOnceMock,
    runAppServerMock,
    wsCtorMock,
    wsServerCloseMock,
    getConnectionHandler: () => connectionHandler,
    setConnectionHandler: (handler: (socket: any, request?: { url?: string; headers?: { origin?: string } }) => void) => {
      connectionHandler = handler
    },
    resetState,
    readInputBuffer: () => inputBuffer,
    readRunAppServerArgs: () => runAppServerArgs,
  }
})

vi.mock('node:http', () => ({
  createServer: createServerMock,
}))

vi.mock('node:https', () => ({
  createServer: createServerMock,
}))

vi.mock('ws', () => {
  const WebSocket = { OPEN: 1 }

  class WebSocketServer {
    constructor(opts: any) {
      wsCtorMock(opts)
    }
    on(event: string, handler: (socket: any, request?: { url?: string; headers?: { origin?: string } }) => void) {
      if (event === 'connection') {
        setConnectionHandler(handler)
      }
    }
    close(cb?: () => void) {
      wsServerCloseMock()
      cb?.()
    }
  }

  return { WebSocket, WebSocketServer }
})

vi.mock('./index.js', () => ({
  runAppServer: runAppServerMock,
}))

type MockSocket = {
  readyState: number
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  on: (event: string, handler: (...args: any[]) => void) => void
  emitMessage: (raw: string | Buffer) => void
  emitError: (error: Error) => void
}

function createMockSocket(): MockSocket {
  const listeners = new Map<string, Array<(...args: any[]) => void>>()
  const on = (event: string, handler: (...args: any[]) => void) => {
    const list = listeners.get(event) ?? []
    list.push(handler)
    listeners.set(event, list)
  }
  const emit = (event: string, ...args: any[]) => {
    for (const handler of listeners.get(event) ?? []) handler(...args)
  }

  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(() => emit('close')),
    on,
    emitMessage: (raw) => emit('message', raw),
    emitError: (error) => emit('error', error),
  }
}

function runGit(repoDir: string, args: string[]): void {
  execFileSync('git', ['-C', repoDir, ...args], { stdio: 'ignore' })
}

afterEach(() => {
  resetState()
  vi.clearAllMocks()
})

describe('startAppServerDevBridge', () => {
  it('bridges websocket messages with app-server stdio streams', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })
    const onConnection = getConnectionHandler()
    expect(typeof onConnection).toBe('function')

    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":1}\n{"jsonrpc":"2.0","method":"initialized"}\n')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readInputBuffer()).toBe(
      '{"jsonrpc":"2.0","id":1}\n{"jsonrpc":"2.0","method":"initialized"}\n',
    )

    const runArgs = readRunAppServerArgs()
    expect(runArgs).toBeTruthy()
    runArgs.output.write('\n')
    expect(socket.send).toHaveBeenCalledTimes(0)
    runArgs.output.write('{"jsonrpc":"2.0","id":99,"result":{"ok":true}}\n')
    expect(socket.send).toHaveBeenCalledWith('{"jsonrpc":"2.0","id":99,"result":{"ok":true}}')

    expect(bridge.url).toBe('ws://127.0.0.1:3777')
    await bridge.close()

    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(wsServerCloseMock).toHaveBeenCalledTimes(1)
    expect(httpCloseMock).toHaveBeenCalledTimes(1)
  })

  it('uses default host/port when options are omitted', async () => {
    const bridge = await startAppServerDevBridge()
    expect(bridge.url).toBe('ws://127.0.0.1:3777')
    await bridge.close()
  })

  it('ignores socket error events', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })
    expect(() => socket.emitError(new Error('socket boom'))).not.toThrow()
    await bridge.close()
  })

  it('handles bridge/reviewGit/readDiff locally without forwarding to app-server input', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: process.cwd() })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":42,"method":"bridge/reviewGit/readDiff","params":{"maxBytes":4096}}\n')
    await waitFor(() => socket.send.mock.calls.length > 0)

    expect(readInputBuffer()).toBe('')
    expect(socket.send).toHaveBeenCalled()
    const payload = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
    expect(payload.id).toBe(42)
    expect(payload.result).toBeTruthy()
    expect(Array.isArray(payload.result.files)).toBe(true)

    await bridge.close()
  })

  it('does not intercept source-less bridge/readDiff as a local bridge RPC', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: process.cwd() })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":43,"method":"bridge/readDiff","params":{"maxBytes":4096}}\n')
    await waitFor(() => readInputBuffer().includes('"method":"bridge/readDiff"'))

    expect(socket.send).not.toHaveBeenCalled()
    await bridge.close()
  })

  it('disposes setup sessions owned by a websocket when it closes', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, setupMode: 'allow' })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":1,"method":"bridge/setup/session/create"}\n')
    await waitFor(() => socket.send.mock.calls.length > 0)
    const created = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
    const sessionId = created.result.id
    expect(typeof sessionId).toBe('string')

    ;(socket.close as any)()

    const secondSocket = createMockSocket()
    onConnection?.(secondSocket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })
    secondSocket.emitMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'bridge/setup/session/action',
        params: { sessionId, action: { type: 'next' } },
      }) + '\n',
    )
    await waitFor(() => secondSocket.send.mock.calls.length > 0)
    const action = JSON.parse(String(secondSocket.send.mock.calls[0]?.[0] ?? '{}'))
    expect(action.result).toMatchObject({ ok: false, code: 'session_not_found' })

    await bridge.close()
  })

  it('accepts setup tier model actions over JSON-RPC', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, setupMode: 'allow' })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":1,"method":"bridge/setup/session/create"}\n')
    await waitFor(() => socket.send.mock.calls.length > 0)
    const created = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
    const sessionId = created.result.id

    socket.emitMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'bridge/setup/session/action',
        params: { sessionId, action: { type: 'setTierModel', tier: 'haiku', model: 'deepseek-v4-flash' } },
      }) + '\n',
    )

    await waitFor(() => socket.send.mock.calls.length > 1)
    const action = JSON.parse(String(socket.send.mock.calls[1]?.[0] ?? '{}'))
    expect(action.error).toBeUndefined()
    expect(action.result).toMatchObject({
      ok: true,
      session: {
        draft: {
          tierModels: { haiku: 'deepseek-v4-flash' },
        },
      },
    })

    await bridge.close()
  })

  it('rejects setup session mutations from websockets that did not create the session', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, setupMode: 'allow' })
    const onConnection = getConnectionHandler()
    const ownerSocket = createMockSocket()
    const otherSocket = createMockSocket()
    onConnection?.(ownerSocket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })
    onConnection?.(otherSocket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    ownerSocket.emitMessage('{"jsonrpc":"2.0","id":1,"method":"bridge/setup/session/create"}\n')
    await waitFor(() => ownerSocket.send.mock.calls.length > 0)
    const created = JSON.parse(String(ownerSocket.send.mock.calls[0]?.[0] ?? '{}'))
    const sessionId = created.result.id
    expect(typeof sessionId).toBe('string')

    otherSocket.emitMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'bridge/setup/session/action',
        params: { sessionId, action: { type: 'next' } },
      }) + '\n',
    )
    await waitFor(() => otherSocket.send.mock.calls.length > 0)
    const action = JSON.parse(String(otherSocket.send.mock.calls[0]?.[0] ?? '{}'))
    expect(action.result).toMatchObject({ ok: false, code: 'session_not_found' })

    await bridge.close()
  })

  it('forwards non-JSON lines to app-server input', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('not-json-line\n')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(readInputBuffer()).toBe('not-json-line\n')
    await bridge.close()
  })

  it('enforces per-connection message rate limits', async () => {
    const bridge = await startAppServerDevBridge({
      host: '127.0.0.1',
      port: 3777,
      rateLimit: { windowMs: 60_000, maxMessages: 1 },
    })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":1}\n')
    socket.emitMessage('{"jsonrpc":"2.0","id":2}\n')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(socket.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded')
    await bridge.close()
  })

  it('responds with JSON-RPC error when local bridge RPC send fails', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: process.cwd() })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    socket.send
      .mockImplementationOnce(() => {
        throw new Error('send boom')
      })
      .mockImplementation(() => undefined)

    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })
    socket.emitMessage('{"jsonrpc":"2.0","id":52,"method":"bridge/reviewGit/readDiff","params":{"maxBytes":4096}}\n')
    await waitFor(() => socket.send.mock.calls.length > 1)

    const errorPayload = JSON.parse(String(socket.send.mock.calls[1]?.[0] ?? '{}'))
    expect(errorPayload.id).toBe(52)
    expect(errorPayload.error?.code).toBe(-32603)
    expect(String(errorPayload.error?.message || '')).toContain('send boom')

    await bridge.close()
  })

  it('includes non-Error rpc failures in JSON-RPC error payload', async () => {
    const bridge = await startAppServerDevBridge({
      host: '127.0.0.1',
      port: 3777,
      cwd: process.cwd(),
      rpcOverrides: {
        readDiff: async () => {
          throw 'rpc string failure'
        },
      },
    })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":53,"method":"bridge/reviewGit/readDiff","params":{"maxBytes":4096}}\n')
    await waitFor(() => socket.send.mock.calls.length > 0)
    const payload = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
    expect(payload.error?.code).toBe(-32603)
    expect(String(payload.error?.message ?? '')).toContain('rpc string failure')

    await bridge.close()
  })

  it('skips bridge RPC success response when socket closes before promise resolves', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: process.cwd() })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":62,"method":"bridge/reviewGit/readDiff","params":{"maxBytes":4096}}\n')
    socket.readyState = 0
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(socket.send).toHaveBeenCalledTimes(0)
    await bridge.close()
  })

  it('skips bridge RPC error response when socket closes during send failure handling', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: process.cwd() })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    socket.send.mockImplementationOnce(() => {
      socket.readyState = 0
      throw new Error('send boom closed')
    })
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":63,"method":"bridge/reviewGit/readDiff","params":{"maxBytes":4096}}\n')
    await waitFor(() => socket.send.mock.calls.length > 0)

    expect(socket.send).toHaveBeenCalledTimes(1)
    await bridge.close()
  })

  it('handles bridge/reviewGit/readDiffSummary locally without forwarding to app-server input', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: process.cwd() })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":142,"method":"bridge/reviewGit/readDiffSummary","params":{"maxFiles":64}}\n')
    await waitFor(() => socket.send.mock.calls.length > 0)

    expect(readInputBuffer()).toBe('')
    const payload = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
    expect(payload.id).toBe(142)
    expect(payload.result).toBeTruthy()
    expect(Array.isArray(payload.result.files)).toBe(true)
    expect(payload.result.files.every((file: any) => typeof file.patch === 'undefined')).toBe(true)

    await bridge.close()
  })

  it('handles websocket Buffer messages', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })
    socket.emitMessage(Buffer.from('{"jsonrpc":"2.0","id":9}\n', 'utf8'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readInputBuffer()).toContain('"id":9')
    await bridge.close()
  })

  it('handles bridge RPC calls without params using process cwd fallback', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":109,"method":"bridge/reviewGit/readDiff"}\n')
    await waitFor(() => socket.send.mock.calls.length > 0)
    const payload = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
    expect(payload.id).toBe(109)
    expect(payload.result).toBeTruthy()
    await bridge.close()
  })

  it('uses review git rpc overrides when provided', async () => {
    const bridge = await startAppServerDevBridge({
      host: '127.0.0.1',
      port: 3777,
      rpcOverrides: {
        listCommits: async () => ({
          cwd: '/tmp',
          generatedAt: new Date().toISOString(),
          commits: [
            {
              sha: '0123456789abcdef',
              shortSha: '0123456',
              subject: 'feat: test',
              committedAt: '2023-11-14T22:13:20.000Z',
              committedAtUnixSeconds: 1700000000,
            },
          ],
        }),
        readDiffSummary: async () => ({
          cwd: '/tmp',
          source: { kind: 'unstaged' },
          sourceKey: 'git:unstaged',
          generatedAt: new Date().toISOString(),
          hasChanges: true,
          truncated: false,
          files: [{ path: 'x.ts', additions: 1, deletions: 0 }],
        }),
        readDiffFilePatch: async () => ({
          cwd: '/tmp',
          source: { kind: 'unstaged' },
          sourceKey: 'git:unstaged',
          generatedAt: new Date().toISOString(),
          path: 'x.ts',
          found: true,
          truncated: false,
          file: { path: 'x.ts', additions: 1, deletions: 0, patch: 'p' },
        }),
        readDiffFileFullContent: async () => ({
          cwd: '/tmp',
          source: { kind: 'unstaged' },
          sourceKey: 'git:unstaged',
          generatedAt: new Date().toISOString(),
          path: 'x.ts',
          found: true,
          content: { before: 'old\n', after: 'new\n' },
        }),
      },
    })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

    socket.emitMessage('{"jsonrpc":"2.0","id":299,"method":"bridge/reviewGit/listCommits","params":{"limit":10}}\n')
    socket.emitMessage('{"jsonrpc":"2.0","id":300,"method":"bridge/reviewGit/readDiffSummary"}\n')
    socket.emitMessage('{"jsonrpc":"2.0","id":301,"method":"bridge/reviewGit/readDiffFilePatch"}\n')
    socket.emitMessage('{"jsonrpc":"2.0","id":302,"method":"bridge/reviewGit/readDiffSummary","params":{"source":{"kind":"staged"}}}\n')
    socket.emitMessage('{"jsonrpc":"2.0","id":303,"method":"bridge/reviewGit/readDiffFilePatch","params":{"source":{"kind":"staged"}}}\n')
    socket.emitMessage('{"jsonrpc":"2.0","id":304,"method":"bridge/reviewGit/readDiffFileFullContent"}\n')
    await waitFor(() => socket.send.mock.calls.length >= 6)

    const first = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
    const second = JSON.parse(String(socket.send.mock.calls[1]?.[0] ?? '{}'))
    const third = JSON.parse(String(socket.send.mock.calls[2]?.[0] ?? '{}'))
    const fourth = JSON.parse(String(socket.send.mock.calls[3]?.[0] ?? '{}'))
    const fifth = JSON.parse(String(socket.send.mock.calls[4]?.[0] ?? '{}'))
    const sixth = JSON.parse(String(socket.send.mock.calls[5]?.[0] ?? '{}'))
    expect(first.id).toBe(299)
    expect(first.result.commits[0]).toMatchObject({ shortSha: '0123456', subject: 'feat: test' })
    expect(second.id).toBe(300)
    expect(third.id).toBe(301)
    expect(fourth.id).toBe(302)
    expect(fifth.id).toBe(303)
    expect(sixth.id).toBe(304)
    expect(sixth.result.content).toEqual({ before: 'old\n', after: 'new\n' })
    await bridge.close()
  })

  it('returns non-zero additions for untracked new files', async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-untracked-'))
    try {
      runGit(repoDir, ['init'])
      await writeFile(path.join(repoDir, 'new-file.txt'), 'first line\nsecond line\n', 'utf8')

      const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: repoDir })
      const onConnection = getConnectionHandler()
      const socket = createMockSocket()
      onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

      socket.emitMessage('{"jsonrpc":"2.0","id":43,"method":"bridge/reviewGit/readDiff","params":{"maxBytes":4096}}\n')
      await waitFor(() => socket.send.mock.calls.length > 0)

      const payload = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
      const files = (payload.result?.files ?? []) as Array<{ path: string; additions: number; deletions: number; patch: string; untracked?: boolean }>
      const target = files.find((file) => file.path === 'new-file.txt')
      expect(target).toBeTruthy()
      expect(target?.untracked).toBe(true)
      expect(target?.additions).toBe(2)
      expect(target?.deletions).toBe(0)
      expect(target?.patch).toContain('new file mode 100644')
      expect(target?.patch).toContain('+++ b/new-file.txt')
      expect(target?.patch).toContain('+first line')

      await bridge.close()
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  it('does not dereference untracked symlinks when generating patches', async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-symlink-'))
    try {
      runGit(repoDir, ['init'])
      await writeFile(path.join(repoDir, 'outside.txt'), 'outside secret\n', 'utf8')
      await symlink('./outside.txt', path.join(repoDir, 'link.txt'))

      const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: repoDir })
      const onConnection = getConnectionHandler()
      const socket = createMockSocket()
      onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

      socket.emitMessage('{"jsonrpc":"2.0","id":44,"method":"bridge/reviewGit/readDiff","params":{"maxBytes":4096}}\n')
      await waitFor(() => socket.send.mock.calls.length > 0)

      const payload = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
      const files = (payload.result?.files ?? []) as Array<{ path: string; additions: number; deletions: number; patch: string; untracked?: boolean }>
      const target = files.find((file) => file.path === 'link.txt')
      expect(target).toBeTruthy()
      expect(target?.untracked).toBe(true)
      expect(target?.patch).toContain('new file mode 120000')
      expect(target?.patch).toContain('+./outside.txt')
      expect(target?.patch).not.toContain('outside secret')

      await bridge.close()
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  it('reads a single file patch via bridge/reviewGit/readDiffFilePatch', async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-single-patch-'))
    try {
      runGit(repoDir, ['init'])
      runGit(repoDir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(repoDir, ['config', 'user.name', 'Dev Bridge'])
      await writeFile(path.join(repoDir, 'tracked.txt'), 'one\ntwo\n', 'utf8')
      runGit(repoDir, ['add', 'tracked.txt'])
      runGit(repoDir, ['commit', '-m', 'init'])
      await writeFile(path.join(repoDir, 'tracked.txt'), 'one\ntwo-updated\nthree\n', 'utf8')

      const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: repoDir })
      const onConnection = getConnectionHandler()
      const socket = createMockSocket()
      onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

      socket.emitMessage(
        '{"jsonrpc":"2.0","id":244,"method":"bridge/reviewGit/readDiffFilePatch","params":{"path":"tracked.txt","maxBytes":4096}}\n',
      )
      await waitFor(() => socket.send.mock.calls.length > 0)

      const payload = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
      expect(payload.id).toBe(244)
      expect(payload.result?.found).toBe(true)
      expect(payload.result?.file?.path).toBe('tracked.txt')
      expect(payload.result?.file?.patch).toContain('@@')
      expect(payload.result?.file?.patch).toContain('+two-updated')
      expect(payload.result?.file?.patch).toContain('+three')

      await bridge.close()
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  it('reads a single image preview via bridge/reviewGit/readDiffFilePreview', async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-preview-rpc-'))
    try {
      runGit(repoDir, ['init'])
      await mkdir(path.join(repoDir, 'images'))
      const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46])
      await writeFile(path.join(repoDir, 'images', 'a.webp'), bytes)

      const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: repoDir })
      const onConnection = getConnectionHandler()
      const socket = createMockSocket()
      onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

      socket.emitMessage(
        '{"jsonrpc":"2.0","id":246,"method":"bridge/reviewGit/readDiffFilePreview","params":{"path":"images/a.webp","maxBytes":4096}}\n',
      )
      await waitFor(() => socket.send.mock.calls.length > 0)

      const payload = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
      expect(payload.id).toBe(246)
      expect(payload.result?.found).toBe(true)
      expect(payload.result?.preview?.mimeType).toBe('image/webp')
      expect(payload.result?.preview?.dataUrl).toBe(`data:image/webp;base64,${bytes.toString('base64')}`)

      await bridge.close()
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  it('returns found=false when bridge/reviewGit/readDiffFilePatch path does not exist in diff', async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-single-patch-miss-'))
    try {
      runGit(repoDir, ['init'])
      runGit(repoDir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(repoDir, ['config', 'user.name', 'Dev Bridge'])
      await writeFile(path.join(repoDir, 'tracked.txt'), 'one\ntwo\n', 'utf8')
      runGit(repoDir, ['add', 'tracked.txt'])
      runGit(repoDir, ['commit', '-m', 'init'])

      const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: repoDir })
      const onConnection = getConnectionHandler()
      const socket = createMockSocket()
      onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

      socket.emitMessage(
        '{"jsonrpc":"2.0","id":245,"method":"bridge/reviewGit/readDiffFilePatch","params":{"path":"missing.txt","maxBytes":4096}}\n',
      )
      await waitFor(() => socket.send.mock.calls.length > 0)

      const payload = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
      expect(payload.id).toBe(245)
      expect(payload.result?.found).toBe(false)
      expect(payload.result?.file).toBeNull()

      await bridge.close()
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  it('normalizes renamed summary paths so single-file patch lookup succeeds', async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-rename-'))
    try {
      runGit(repoDir, ['init'])
      runGit(repoDir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(repoDir, ['config', 'user.name', 'Dev Bridge'])
      await writeFile(path.join(repoDir, 'old-name.txt'), 'same\n', 'utf8')
      runGit(repoDir, ['add', 'old-name.txt'])
      runGit(repoDir, ['commit', '-m', 'init'])
      runGit(repoDir, ['mv', 'old-name.txt', 'new-name.txt'])

      const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: repoDir })
      const onConnection = getConnectionHandler()
      const socket = createMockSocket()
      onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

      socket.emitMessage(
        '{"jsonrpc":"2.0","id":344,"method":"bridge/reviewGit/readDiffSummary","params":{"source":{"kind":"staged"},"maxFiles":256}}\n',
      )
      await waitFor(() => socket.send.mock.calls.length > 0)
      const summaryPayload = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
      const renamedPath = (summaryPayload.result?.files ?? []).find((file: any) => file.path.includes('new-name'))?.path
      expect(renamedPath).toBe('new-name.txt')

      socket.emitMessage(
        `{"jsonrpc":"2.0","id":345,"method":"bridge/reviewGit/readDiffFilePatch","params":{"source":{"kind":"staged"},"path":"${renamedPath}","maxBytes":4096}}\n`,
      )
      await waitFor(() => socket.send.mock.calls.length > 1)
      const patchPayload = JSON.parse(String(socket.send.mock.calls[1]?.[0] ?? '{}'))
      expect(patchPayload.result?.found).toBe(true)
      expect(patchPayload.result?.file?.path).toBe('new-name.txt')

      await bridge.close()
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  it('does not rewrite non-rename filenames containing arrow token', async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-arrow-file-'))
    try {
      runGit(repoDir, ['init'])
      runGit(repoDir, ['config', 'user.email', 'devbridge@example.com'])
      runGit(repoDir, ['config', 'user.name', 'Dev Bridge'])
      await writeFile(path.join(repoDir, 'foo => bar.txt'), 'one\n', 'utf8')
      runGit(repoDir, ['add', 'foo => bar.txt'])
      runGit(repoDir, ['commit', '-m', 'init'])
      await writeFile(path.join(repoDir, 'foo => bar.txt'), 'two\n', 'utf8')

      const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777, cwd: repoDir })
      const onConnection = getConnectionHandler()
      const socket = createMockSocket()
      onConnection?.(socket, { url: '/ws', headers: { origin: 'http://localhost:3781' } })

      socket.emitMessage('{"jsonrpc":"2.0","id":346,"method":"bridge/reviewGit/readDiffSummary","params":{"maxFiles":256}}\n')
      await waitFor(() => socket.send.mock.calls.length > 0)
      const summaryPayload = JSON.parse(String(socket.send.mock.calls[0]?.[0] ?? '{}'))
      const targetPath = (summaryPayload.result?.files ?? []).find((file: any) => file.path.includes('foo'))?.path
      expect(targetPath).toBe('foo => bar.txt')

      socket.emitMessage(
        '{"jsonrpc":"2.0","id":347,"method":"bridge/reviewGit/readDiffFilePatch","params":{"path":"foo => bar.txt","maxBytes":4096}}\n',
      )
      await waitFor(() => socket.send.mock.calls.length > 1)
      const patchPayload = JSON.parse(String(socket.send.mock.calls[1]?.[0] ?? '{}'))
      expect(patchPayload.result?.found).toBe(true)
      expect(patchPayload.result?.file?.path).toBe('foo => bar.txt')

      await bridge.close()
    } finally {
      await rm(repoDir, { recursive: true, force: true })
    }
  })

  it('rejects websocket connection when auth token does not match', async () => {
    const bridge = await startAppServerDevBridge({
      host: '127.0.0.1',
      port: 3777,
      security: { authToken: 'secret-token' },
    })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()

    onConnection?.(socket, { url: '/?token=wrong-token', headers: { origin: 'http://localhost:3781' } })
    socket.emitMessage('{"jsonrpc":"2.0","id":1}\n')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(readInputBuffer()).toBe('')
    expect(socket.close).toHaveBeenCalledWith(1008, 'Unauthorized')

    await bridge.close()
  })

  it('rejects websocket connection without origin and records null origin metadata', async () => {
    const bridge = await startAppServerDevBridge({
      host: '127.0.0.1',
      port: 3777,
      security: { authToken: 'secret-token' },
    })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()

    onConnection?.(socket, { url: '/?token=wrong-token', headers: {} as any })
    expect(socket.close).toHaveBeenCalledWith(1008, 'Unauthorized')

    await bridge.close()
  })

  it('accepts auth token from authorization header', async () => {
    const bridge = await startAppServerDevBridge({
      host: '127.0.0.1',
      port: 3777,
      security: { authToken: 'secret-token' },
    })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()

    onConnection?.(socket, {
      url: '/',
      headers: { origin: 'http://localhost:3781', authorization: 'Bearer secret-token' } as any,
    })
    socket.emitMessage('{"jsonrpc":"2.0","id":1}\n')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(readInputBuffer()).toContain('"id":1')
    await bridge.close()
  })

  it('rejects websocket connection when origin is not allowed', async () => {
    const bridge = await startAppServerDevBridge({
      host: '127.0.0.1',
      port: 3777,
      security: {
        authToken: 'secret-token',
        allowedOrigins: ['http://localhost:3781'],
      },
    })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()

    onConnection?.(socket, { url: '/?token=secret-token', headers: { origin: 'http://evil.invalid' } })
    socket.emitMessage('{"jsonrpc":"2.0","id":1}\n')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(readInputBuffer()).toBe('')
    expect(socket.close).toHaveBeenCalledWith(1008, 'Forbidden origin')

    await bridge.close()
  })

  it('accepts websocket connection when token and origin are valid', async () => {
    const bridge = await startAppServerDevBridge({
      host: '127.0.0.1',
      port: 3777,
      security: {
        authToken: 'secret-token',
        allowedOrigins: ['http://localhost:3781'],
      },
    })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()

    onConnection?.(socket, { url: '/?token=secret-token', headers: { origin: 'http://localhost:3781' } })
    socket.emitMessage('{"jsonrpc":"2.0","id":1}\n')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(readInputBuffer()).toBe('{"jsonrpc":"2.0","id":1}\n')
    expect(socket.close).not.toHaveBeenCalledWith(1008, expect.anything())

    await bridge.close()
  })

  it('handles missing origin header in connection metadata', async () => {
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })
    const onConnection = getConnectionHandler()
    const socket = createMockSocket()
    onConnection?.(socket, { url: '/ws', headers: {} as any })
    socket.emitMessage('{"jsonrpc":"2.0","id":7}\n')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readInputBuffer()).toContain('"id":7')
    await bridge.close()
  })

  it('creates https server when tls options are provided', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'formax-devbridge-tls-'))
    try {
      const certFile = path.join(dir, 'cert.pem')
      const keyFile = path.join(dir, 'key.pem')
      await writeFile(certFile, 'CERT', 'utf8')
      await writeFile(keyFile, 'KEY', 'utf8')

      const bridge = await startAppServerDevBridge({
        tls: { certFile, keyFile },
      })
      expect(wsCtorMock).toHaveBeenCalled()
      await bridge.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects when httpServer.listen throws synchronously', async () => {
    httpListenMock.mockImplementationOnce(() => {
      throw new Error('listen boom')
    })

    await expect(startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })).rejects.toThrow('listen boom')
    expect(runAppServerMock).not.toHaveBeenCalled()
    expect(httpOffMock).toHaveBeenCalled()
  })

  it('wraps non-Error throws from httpServer.listen', async () => {
    httpListenMock.mockImplementationOnce(() => {
      throw 'listen raw'
    })
    await expect(startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })).rejects.toThrow('listen raw')
  })

  it('rejects when httpServer emits error while listening', async () => {
    httpOnceMock.mockImplementationOnce((event: string, handler: (err: Error) => void) => {
      if (event === 'error') {
        setTimeout(() => handler(new Error('listen async boom')), 0)
      }
    })
    httpListenMock.mockImplementationOnce(() => undefined)

    await expect(startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })).rejects.toThrow('listen async boom')
    expect(runAppServerMock).not.toHaveBeenCalled()
    expect(httpOffMock).toHaveBeenCalled()
  })

  it('rejects when server address is unavailable after listen', async () => {
    httpAddressMock.mockReturnValueOnce(null as any)
    await expect(startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })).rejects.toThrow(
      'Failed to resolve app-server dev bridge address',
    )
  })

  it('close is idempotent and handles rejected app-server loop', async () => {
    runAppServerMock.mockImplementationOnce(async () => {
      throw new Error('loop boom')
    })
    const bridge = await startAppServerDevBridge({ host: '127.0.0.1', port: 3777 })
    await bridge.close()
    await bridge.close()
    expect(wsServerCloseMock).toHaveBeenCalledTimes(1)
    expect(httpCloseMock).toHaveBeenCalledTimes(1)
  })
})
async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for condition')
}
