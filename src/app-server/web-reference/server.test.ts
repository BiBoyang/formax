import { afterEach, describe, expect, it, vi } from 'vitest'
import { startWebReferenceServer } from './server.js'

const {
  createServerMock,
  closeMock,
  readFileMock,
  listenMock,
  offMock,
  onceMock,
  getRequestHandler,
  resetState,
} = vi.hoisted(() => {
  let requestHandler = null

  const closeMock = vi.fn((cb) => cb?.())
  const listenMock = vi.fn((_port, _host, cb) => cb?.())
  const offMock = vi.fn()
  const onceMock = vi.fn()
  const addressMock = vi.fn(() => ({ address: '127.0.0.1', family: 'IPv4', port: 3780 }))

  const createServerMock = vi.fn((handler) => {
    requestHandler = handler
    return {
      close: closeMock,
      listen: listenMock,
      off: offMock,
      once: onceMock,
      address: addressMock,
    }
  })

  const readFileMock = vi.fn(async (filePath) => {
    const name = String(filePath)
    if (name.endsWith('index.html')) return '<html>ok</html>'
    if (name.endsWith('styles.css')) return 'body{}'
    if (name.endsWith('app.js')) return 'console.log("ok")'
    throw new Error('file not found')
  })

  return {
    createServerMock,
    closeMock,
    readFileMock,
    listenMock,
    offMock,
    onceMock,
    getRequestHandler: () => requestHandler,
    resetState: () => {
      requestHandler = null
    },
  }
})

vi.mock('node:http', () => ({
  createServer: createServerMock,
}))

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: readFileMock,
  },
}))

function createRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(value) {
      this.body = String(value ?? '')
    },
  }
}

afterEach(() => {
  resetState()
  vi.clearAllMocks()
})

describe('startWebReferenceServer', () => {
  it('serves config.js with injected bridge url', async () => {
    const handle = await startWebReferenceServer({
      host: '127.0.0.1',
      port: 3780,
      bridgeUrl: 'ws://127.0.0.1:3777',
    })

    expect(handle.url).toBe('http://127.0.0.1:3780')

    const req = { url: '/config.js' }
    const res = createRes()
    getRequestHandler()?.(req, res)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(res.body).toContain('window.__FORMAX_BRIDGE_URL__')
    expect(res.body).toContain('ws://127.0.0.1:3777')

    await handle.close()
    expect(closeMock).toHaveBeenCalledTimes(1)
  })

  it('rejects when listen throws synchronously', async () => {
    listenMock.mockImplementationOnce(() => {
      throw new Error('listen boom')
    })

    await expect(
      startWebReferenceServer({
        host: '127.0.0.1',
        port: 3780,
        bridgeUrl: 'ws://127.0.0.1:3777',
      }),
    ).rejects.toThrow('listen boom')
    expect(offMock).toHaveBeenCalled()
  })
})
