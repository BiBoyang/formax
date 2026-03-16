import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildHttpUrl,
  createBridgeAuthToken,
  decodeRequestPathname,
  displayHostForLogs,
} from '../network/runtime.js'
import { startServeBridge } from '../serve/localServer.js'
import type { WebCommandOptions } from '../cli/webCommand.js'
import { renderWebLogo } from './logo.js'

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function runtimeBridgeScript(bridgePort: number, bridgeToken: string): string {
  return (
    `<script>(function(){` +
    `var protocol=window.location.protocol==='https:'?'wss':'ws';` +
    `var hostname=window.location.hostname;` +
    `if(hostname.indexOf(':')!==-1&&hostname.charAt(0)!=='['){hostname='['+hostname+']';}` +
    `var token=${JSON.stringify(bridgeToken)};` +
    `window.__FORMAX_BRIDGE_URL__=protocol+'://'+hostname+':${bridgePort}'+'?token='+encodeURIComponent(token);` +
    `})();</script>`
  )
}

async function resolveWebAssetsDir(): Promise<string | null> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(currentDir, 'web'),
    path.resolve(currentDir, '../../../dist/web'),
    path.resolve(currentDir, '../../../packages/web-reference-react/dist'),
  ]

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isDirectory()) return candidate
    } catch {
      // Try next candidate.
    }
  }

  return null
}

function injectRuntimeConfig(indexHtml: string, bridgePort: number, bridgeToken: string): string {
  const configScript = runtimeBridgeScript(bridgePort, bridgeToken)
  if (indexHtml.includes('</head>')) {
    return indexHtml.replace('</head>', `${configScript}</head>`)
  }
  return `${configScript}${indexHtml}`
}

async function readStaticFile(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function startStaticWebServer(args: {
  host: string
  uiPort: number
  rootDir: string
  bridgePort: number
  bridgeToken: string
}): Promise<{ url: string; close: () => Promise<void> }> {
  const indexPath = path.join(args.rootDir, 'index.html')
  const indexBuffer = await readStaticFile(indexPath)
  if (!indexBuffer) {
    throw new Error(`Missing Web UI index: ${indexPath}`)
  }
  const indexHtml = injectRuntimeConfig(indexBuffer.toString('utf8'), args.bridgePort, args.bridgeToken)

  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.end('Method Not Allowed')
      return
    }

    const decoded = decodeRequestPathname(req.url)
    if (decoded.ok === false) {
      res.statusCode = decoded.statusCode
      res.end(decoded.message)
      return
    }
    const pathname = decoded.pathname === '/' ? '/index.html' : decoded.pathname

    if (pathname === '/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.statusCode = 200
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.end(indexHtml)
      return
    }

    const candidatePath = path.resolve(args.rootDir, `.${pathname}`)
    const safePrefix = `${args.rootDir}${path.sep}`
    if (!(candidatePath === args.rootDir || candidatePath.startsWith(safePrefix))) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    const payload = await readStaticFile(candidatePath)
    if (!payload) {
      const shouldFallbackToIndex = path.extname(pathname) === ''
      if (shouldFallbackToIndex) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.statusCode = 200
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        res.end(indexHtml)
        return
      }
      res.statusCode = 404
      res.end('Not Found')
      return
    }

    res.setHeader('Content-Type', contentTypeFor(candidatePath))
    res.statusCode = 200
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(payload)
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(args.uiPort, args.host)
  })

  return {
    url: buildHttpUrl(args.host, args.uiPort),
    close: async () => closeServer(server),
  }
}

export async function runWebUi(options: WebCommandOptions): Promise<void> {
  const assetsDir = await resolveWebAssetsDir()
  if (!assetsDir) {
    throw new Error(
      'Web UI assets are missing. Reinstall package or build with `bun run build:web-ui` before running `formax web`.',
    )
  }

  const bridgeToken = createBridgeAuthToken()
  const bridge = await startServeBridge({
    host: options.host,
    port: options.bridgePort,
    token: bridgeToken,
    allowedOrigins: [],
  })

  let webServer: { url: string; close: () => Promise<void> } | null = null
  try {
    webServer = await startStaticWebServer({
      host: options.host,
      uiPort: options.uiPort,
      rootDir: assetsDir,
      bridgePort: options.bridgePort,
      bridgeToken,
    })
  } catch (err) {
    await bridge.close()
    throw err
  }

  const connectHost = displayHostForLogs(options.host)
  process.stderr.write(renderWebLogo())
  process.stderr.write(
    `[formax] app-server bridge: ws://${connectHost}:${options.bridgePort} (token-protected; browser token is injected automatically)\n`,
  )
  process.stderr.write(`[formax] web ui: http://${connectHost}:${options.uiPort}\n`)

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    await Promise.allSettled([bridge.close(), webServer?.close()])
  }

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0))
  })
}
