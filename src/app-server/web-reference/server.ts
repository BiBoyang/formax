import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type WebReferenceServerOptions = {
  host?: string
  port?: number
  bridgeUrl: string
}

export type WebReferenceServerHandle = {
  url: string
  close: () => Promise<void>
}

const assetDir = path.dirname(fileURLToPath(import.meta.url))

async function readAsset(fileName: string): Promise<string> {
  const filePath = path.join(assetDir, fileName)
  return fs.readFile(filePath, 'utf8')
}

function writeText(res: ServerResponse, code: number, contentType: string, body: string): void {
  res.statusCode = code
  res.setHeader('content-type', contentType)
  res.end(body)
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, bridgeUrl: string): Promise<void> {
  const reqUrl = new URL(req.url ?? '/', 'http://localhost')

  if (reqUrl.pathname === '/') {
    const html = await readAsset('index.html')
    writeText(res, 200, 'text/html; charset=utf-8', html)
    return
  }

  if (reqUrl.pathname === '/styles.css') {
    const css = await readAsset('styles.css')
    writeText(res, 200, 'text/css; charset=utf-8', css)
    return
  }

  if (reqUrl.pathname === '/app.js') {
    const js = await readAsset('app.js')
    writeText(res, 200, 'text/javascript; charset=utf-8', js)
    return
  }

  if (reqUrl.pathname === '/config.js') {
    const configJs = `window.__FORMAX_BRIDGE_URL__ = ${JSON.stringify(bridgeUrl)};\n`
    writeText(res, 200, 'text/javascript; charset=utf-8', configJs)
    return
  }

  writeText(res, 404, 'text/plain; charset=utf-8', 'Not Found\n')
}

export async function startWebReferenceServer(options: WebReferenceServerOptions): Promise<WebReferenceServerHandle> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 3780

  const server = createServer((req, res) => {
    void handleRequest(req, res, options.bridgeUrl).catch((err) => {
      writeText(res, 500, 'text/plain; charset=utf-8', `Server Error: ${err instanceof Error ? err.message : String(err)}\n`)
    })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('error', onError)
      reject(err)
    }
    server.once('error', onError)
    try {
      server.listen(port, host, () => {
        server.off('error', onError)
        resolve()
      })
    } catch (err) {
      server.off('error', onError)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('Failed to resolve web reference server address')
  }

  return {
    url: `http://${host}:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
