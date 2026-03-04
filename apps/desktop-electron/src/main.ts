import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'

const DEFAULT_START_URL = 'http://127.0.0.1:3781'
const LOAD_RETRY_ATTEMPTS = 10
const LOAD_RETRY_INTERVAL_MS = 500

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function normalizeHostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1)
  }
  return hostname
}

function getStartUrl(): string {
  const fromEnv = process.env.FORMAX_ELECTRON_START_URL
  if (!fromEnv || !fromEnv.trim()) return DEFAULT_START_URL

  try {
    const parsed = new URL(fromEnv)
    if (!isAllowedProtocol(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`)
    }
    return parsed.toString()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[formax-desktop] invalid FORMAX_ELECTRON_START_URL, fallback to default: ${message}\n`)
    return DEFAULT_START_URL
  }
}

function getMode(): string {
  const mode = process.env.FORMAX_ELECTRON_MODE?.trim()
  if (!mode) return 'dev'
  return mode
}

function shouldOpenDevTools(): boolean {
  return process.env.FORMAX_ELECTRON_OPEN_DEVTOOLS === '1'
}

function isAllowedProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:'
}

function isAllowedLocalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (!isAllowedProtocol(parsed.protocol)) return false
    return LOCAL_HOSTS.has(normalizeHostname(parsed.hostname))
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadWindowWithRetry(window: BrowserWindow, startUrl: string): Promise<void> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= LOAD_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await window.loadURL(startUrl)
      return
    } catch (error) {
      lastError = error
      if (attempt < LOAD_RETRY_ATTEMPTS) {
        await sleep(LOAD_RETRY_INTERVAL_MS)
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to load window URL')
}

function wireNavigationGuards(window: BrowserWindow): void {
  window.webContents.on('will-navigate', (event, url) => {
    if (isAllowedLocalUrl(url)) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedLocalUrl(url)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

async function createMainWindow(): Promise<BrowserWindow> {
  const preloadPath = path.join(__dirname, 'preload.js')
  const startUrl = getStartUrl()

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  })

  wireNavigationGuards(window)
  await loadWindowWithRetry(window, startUrl)

  if (shouldOpenDevTools()) {
    window.webContents.openDevTools({ mode: 'detach' })
  }

  return window
}

async function bootstrap(): Promise<void> {
  const mode = getMode()
  process.stderr.write(`[formax-desktop] mode=${mode}\n`)

  await app.whenReady()
  await createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    void createMainWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

void bootstrap().catch((error) => {
  console.error(error)
  app.exit(1)
})
