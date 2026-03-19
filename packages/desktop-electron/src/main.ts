import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createDefaultWindowAppearanceState, type WindowAppearanceState } from './windowAppearanceState'

const DEFAULT_START_URL = 'http://127.0.0.1:3781'
const DEFAULT_BRIDGE_PORT = 3777

const LOAD_RETRY_ATTEMPTS = 10
const LOAD_RETRY_INTERVAL_MS = 500

const MANAGED_RUNTIME_WAIT_TIMEOUT_MS = 30_000
const MANAGED_RUNTIME_WAIT_POLL_MS = 250
const MANAGED_RUNTIME_KILL_GRACE_MS = 4_000
const DESKTOP_CHROME_HEIGHT_PX = 56
const MAC_TRAFFIC_LIGHT_SAFE_HEIGHT_PX = 20
const MAC_TRAFFIC_LIGHT_INSET_X_PX = 20
const MAC_TRAFFIC_LIGHT_SIZE_PX = 14
const MAC_TRAFFIC_LIGHT_INSET_Y_PX = Math.round(
  (DESKTOP_CHROME_HEIGHT_PX - MAC_TRAFFIC_LIGHT_SAFE_HEIGHT_PX) / 2,
)
const MAC_TRAFFIC_LIGHT_POSITION = {
  x: MAC_TRAFFIC_LIGHT_INSET_X_PX,
  y: MAC_TRAFFIC_LIGHT_INSET_Y_PX + Math.round((MAC_TRAFFIC_LIGHT_SAFE_HEIGHT_PX - MAC_TRAFFIC_LIGHT_SIZE_PX) / 2),
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const PICK_PROJECT_FOLDER_CHANNEL = 'formax:desktop:pick-project-folder'
const WINDOW_CONTROL_CHANNEL = 'formax:desktop:window-control'
const WINDOW_APPEARANCE_CHANNEL = 'formax:desktop:window-appearance'
const WINDOW_APPEARANCE_STATE_CHANNEL = 'formax:desktop:window-appearance:state'
const WINDOW_APPEARANCE_STATE_FILE = 'window-appearance.json'

type DesktopWindowControl = 'close' | 'minimize' | 'toggle-maximize'
type DesktopWindowAppearanceAction = 'get-state' | 'set-window-transparency'

type ManagedRuntimeConfig = {
  scriptPath: string
  host: string
  uiPort: number
  bridgePort: number
  startUrl: string
}

let managedRuntimeChild: ChildProcess | null = null
let managedRuntimeStopTimer: NodeJS.Timeout | null = null
let managedRuntimeStopping = false
const windowAppearanceStateByWebContentsId = new Map<number, WindowAppearanceState>()
const windowAppearanceQueueByWebContentsId = new Map<number, Promise<void>>()
let initialWindowAppearanceState: WindowAppearanceState = createDefaultWindowAppearanceState()

function normalizeHostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1)
  }
  return hostname
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

function shouldEnableManagedRuntime(): boolean {
  const flag = process.env.FORMAX_ELECTRON_MANAGED_RUNTIME?.trim()
  if (flag === '1') return true
  if (flag === '0') return false
  return app.isPackaged
}

function parseBridgePortFromEnv(): number {
  const raw = process.env.FORMAX_ELECTRON_BRIDGE_PORT?.trim()
  if (!raw) return DEFAULT_BRIDGE_PORT

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    process.stderr.write(
      `[formax-desktop] invalid FORMAX_ELECTRON_BRIDGE_PORT=${raw}, fallback to ${DEFAULT_BRIDGE_PORT}\n`,
    )
    return DEFAULT_BRIDGE_PORT
  }

  return parsed
}

function parseUiPort(startUrl: URL): number {
  if (!startUrl.port) {
    return startUrl.protocol === 'https:' ? 443 : 80
  }

  const parsed = Number.parseInt(startUrl.port, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid start-url port: ${startUrl.port}`)
  }

  return parsed
}

function resolveManagedRuntimeScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'runtime', 'cli.mjs')
  }
  return path.resolve(__dirname, '..', 'runtime', 'cli.mjs')
}

function resolveManagedRuntimeConfig(startUrl: string): ManagedRuntimeConfig | null {
  if (!shouldEnableManagedRuntime()) return null

  if (!isAllowedLocalUrl(startUrl)) {
    process.stderr.write(`[formax-desktop] skip managed runtime for non-local URL: ${startUrl}\n`)
    return null
  }

  const parsed = new URL(startUrl)
  if (parsed.protocol !== 'http:') {
    process.stderr.write(`[formax-desktop] skip managed runtime for unsupported protocol: ${parsed.protocol}\n`)
    return null
  }

  const scriptPath = resolveManagedRuntimeScriptPath()
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Managed runtime bundle is missing: ${scriptPath}`)
  }

  return {
    scriptPath,
    host: normalizeHostname(parsed.hostname),
    uiPort: parseUiPort(parsed),
    bridgePort: parseBridgePortFromEnv(),
    startUrl,
  }
}

function writeRuntimeStream(prefix: string, chunk: string | Buffer): void {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) continue
    process.stderr.write(`[${prefix}] ${line}\n`)
  }
}

function requestManagedRuntimeShutdown(): void {
  const child = managedRuntimeChild
  if (!child || child.exitCode != null || child.killed) return

  managedRuntimeStopping = true
  child.kill('SIGTERM')

  if (managedRuntimeStopTimer) {
    clearTimeout(managedRuntimeStopTimer)
  }

  managedRuntimeStopTimer = setTimeout(() => {
    if (child.exitCode == null && !child.killed) {
      child.kill('SIGKILL')
    }
  }, MANAGED_RUNTIME_KILL_GRACE_MS)

  managedRuntimeStopTimer.unref()
}

async function waitForUiReady(startUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + MANAGED_RUNTIME_WAIT_TIMEOUT_MS
  let spawnError: Error | null = null
  child.once('error', (error) => {
    spawnError = error
  })

  while (Date.now() < deadline) {
    if (spawnError) {
      throw spawnError
    }

    if (child.exitCode != null) {
      throw new Error(`Managed runtime exited early (code=${child.exitCode})`)
    }

    try {
      const response = await fetch(startUrl, {
        method: 'GET',
        cache: 'no-store',
      })
      if (response.status >= 200 && response.status < 500) {
        return
      }
    } catch {
      // Keep polling.
    }

    await sleep(MANAGED_RUNTIME_WAIT_POLL_MS)
  }

  throw new Error(`Timed out waiting for managed runtime UI at ${startUrl}`)
}

async function startManagedRuntimeIfNeeded(startUrl: string): Promise<void> {
  const config = resolveManagedRuntimeConfig(startUrl)
  if (!config) return

  if (managedRuntimeChild && managedRuntimeChild.exitCode == null && !managedRuntimeChild.killed) {
    return
  }

  const runtimeArgs = [
    config.scriptPath,
    'web',
    '--host',
    config.host,
    '--ui-port',
    String(config.uiPort),
    '--bridge-port',
    String(config.bridgePort),
  ]

  process.stderr.write(
    `[formax-desktop] starting managed runtime: host=${config.host} ui=${config.uiPort} bridge=${config.bridgePort}\n`,
  )

  const child = spawn(process.execPath, runtimeArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      FORMAX_ELECTRON_MODE: 'packaged-runtime',
    },
  })

  managedRuntimeStopping = false
  managedRuntimeChild = child

  child.stdout?.on('data', (chunk) => {
    writeRuntimeStream('formax-runtime:stdout', chunk)
  })
  child.stderr?.on('data', (chunk) => {
    writeRuntimeStream('formax-runtime:stderr', chunk)
  })

  child.once('exit', (code, signal) => {
    if (managedRuntimeChild === child) {
      managedRuntimeChild = null
    }

    if (managedRuntimeStopTimer) {
      clearTimeout(managedRuntimeStopTimer)
      managedRuntimeStopTimer = null
    }

    if (managedRuntimeStopping) return
    process.stderr.write(`[formax-desktop] managed runtime exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})\n`)
  })

  try {
    await waitForUiReady(config.startUrl, child)
    process.stderr.write('[formax-desktop] managed runtime is ready\n')
  } catch (error) {
    requestManagedRuntimeShutdown()
    throw error
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildRecoveryCommand(startUrl: string, bridgePort: number): string {
  try {
    const parsed = new URL(startUrl)
    const host = normalizeHostname(parsed.hostname)
    const uiPort = parseUiPort(parsed)
    return `bun run app-server:web-reference -- --host ${host} --bridge-port ${bridgePort} --ui-port ${uiPort}`
  } catch {
    return `bun run app-server:web-reference -- --host 127.0.0.1 --bridge-port ${bridgePort} --ui-port 3781`
  }
}

function buildLoadErrorHtml(startUrl: string, errorMessage: string, recoveryCommand: string): string {
  const escapedUrl = escapeHtml(startUrl)
  const escapedError = escapeHtml(errorMessage)
  const escapedRecoveryCommand = escapeHtml(recoveryCommand)
  const reloadTarget = JSON.stringify(startUrl)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Formax Desktop</title>
    <style>
      :root {
        color-scheme: light dark;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: linear-gradient(135deg, #f4f7ff, #fdf8f4);
        color: #1f2937;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .card {
        width: min(740px, 92vw);
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 16px;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14);
        padding: 26px 26px 20px;
      }

      h1 {
        margin: 0 0 10px;
        font-size: 22px;
        line-height: 1.3;
      }

      p {
        margin: 0 0 10px;
        font-size: 14px;
        line-height: 1.6;
      }

      code {
        display: block;
        margin: 8px 0 12px;
        padding: 10px 12px;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 10px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        overflow-x: auto;
      }

      .meta {
        margin-top: 12px;
        color: #475569;
      }

      button {
        margin-top: 8px;
        border: 0;
        border-radius: 10px;
        padding: 10px 14px;
        background: #0f172a;
        color: #fff;
        cursor: pointer;
        font-size: 13px;
      }

      button:hover {
        background: #1e293b;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Formax Desktop cannot reach local runtime</h1>
      <p>Target URL:</p>
      <code>${escapedUrl}</code>
      <p>The app attempted to start an embedded runtime but did not connect successfully.</p>
      <p>Try relaunching the app, or during development run this command and click Reload:</p>
      <code>${escapedRecoveryCommand}</code>
      <button onclick="window.location.assign(${reloadTarget})">Reload</button>
      <p class="meta">Last error: ${escapedError}</p>
    </main>
  </body>
</html>`
}

async function loadFallbackPage(window: BrowserWindow, startUrl: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const bridgePort = parseBridgePortFromEnv()
  const recoveryCommand = buildRecoveryCommand(startUrl, bridgePort)
  const html = buildLoadErrorHtml(startUrl, message, recoveryCommand)
  const fallbackUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  await window.loadURL(fallbackUrl)
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

function resolveOwnerWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return (
    BrowserWindow.fromWebContents(event.sender) ??
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows()[0] ??
    null
  )
}

function windowAppearanceStateFilePath(): string {
  return path.join(app.getPath('userData'), WINDOW_APPEARANCE_STATE_FILE)
}

function readPersistedWindowTransparencyEnabled(): boolean | null {
  try {
    const statePath = windowAppearanceStateFilePath()
    const raw = fs.readFileSync(statePath, 'utf8')
    const payload = JSON.parse(raw)
    if (!payload || typeof payload !== 'object') return null
    const candidate = payload as { windowTransparencyEnabled?: unknown }
    return candidate.windowTransparencyEnabled === true
  } catch {
    return null
  }
}

function writePersistedWindowTransparencyEnabled(enabled: boolean): void {
  try {
    const statePath = windowAppearanceStateFilePath()
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(
      statePath,
      JSON.stringify({ windowTransparencyEnabled: enabled === true }, null, 2),
      'utf8',
    )
  } catch {
    // Do not block UI interactions if persistence fails.
  }
}

function initializeWindowAppearanceState(): void {
  const fallbackState = createDefaultWindowAppearanceState()
  const persistedEnabled = readPersistedWindowTransparencyEnabled()
  if (persistedEnabled == null) {
    initialWindowAppearanceState = fallbackState
    return
  }
  initialWindowAppearanceState = {
    revision: 0,
    windowTransparencyEnabled: persistedEnabled,
  }
}

function readWindowAppearanceState(webContentsId: number): WindowAppearanceState {
  const existing = windowAppearanceStateByWebContentsId.get(webContentsId)
  if (existing) return existing
  const initial = { ...initialWindowAppearanceState }
  windowAppearanceStateByWebContentsId.set(webContentsId, initial)
  return initial
}

function publishWindowAppearanceState(window: BrowserWindow, state: WindowAppearanceState): void {
  const webContentsId = window.webContents.id
  windowAppearanceStateByWebContentsId.set(webContentsId, state)
  window.webContents.send(WINDOW_APPEARANCE_STATE_CHANNEL, state)
}

function queueWindowAppearanceMutation(
  window: BrowserWindow,
  runMutation: (currentState: WindowAppearanceState) => WindowAppearanceState,
): Promise<WindowAppearanceState> {
  const webContentsId = window.webContents.id
  const previousQueue = windowAppearanceQueueByWebContentsId.get(webContentsId) ?? Promise.resolve()
  const nextStatePromise = previousQueue.then(() => {
    const currentState = readWindowAppearanceState(webContentsId)
    const nextState = runMutation(currentState)
    publishWindowAppearanceState(window, nextState)
    return nextState
  })
  windowAppearanceQueueByWebContentsId.set(
    webContentsId,
    nextStatePromise.then(() => undefined, () => undefined),
  )
  return nextStatePromise
}

function registerDesktopIpcHandlers(): void {
  ipcMain.removeHandler(PICK_PROJECT_FOLDER_CHANNEL)
  ipcMain.removeHandler(WINDOW_CONTROL_CHANNEL)
  ipcMain.removeHandler(WINDOW_APPEARANCE_CHANNEL)

  ipcMain.handle(PICK_PROJECT_FOLDER_CHANNEL, async (event) => {
    const ownerWindow = resolveOwnerWindow(event)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Select project folder',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle(WINDOW_CONTROL_CHANNEL, (event, action: DesktopWindowControl) => {
    const ownerWindow = resolveOwnerWindow(event)
    if (!ownerWindow) return false

    if (action === 'close') {
      ownerWindow.close()
      return true
    }

    if (action === 'minimize') {
      ownerWindow.minimize()
      return true
    }

    if (action === 'toggle-maximize') {
      if (ownerWindow.isMaximized()) {
        ownerWindow.unmaximize()
      } else {
        ownerWindow.maximize()
      }
      return true
    }

    return false
  })

  ipcMain.handle(
    WINDOW_APPEARANCE_CHANNEL,
    (event, action: DesktopWindowAppearanceAction, enabled?: boolean) => {
      const ownerWindow = resolveOwnerWindow(event)
      if (!ownerWindow) return createDefaultWindowAppearanceState()

      const webContentsId = ownerWindow.webContents.id
      if (action === 'get-state') {
        return readWindowAppearanceState(webContentsId)
      }

      if (action !== 'set-window-transparency') {
        return readWindowAppearanceState(webContentsId)
      }

      const shouldEnable = enabled === true
      return queueWindowAppearanceMutation(ownerWindow, (currentState) => {
        writePersistedWindowTransparencyEnabled(shouldEnable)
        const nextState: WindowAppearanceState = {
          revision: currentState.revision + 1,
          windowTransparencyEnabled: shouldEnable,
        }
        initialWindowAppearanceState = {
          revision: 0,
          windowTransparencyEnabled: shouldEnable,
        }
        return nextState
      })
    },
  )
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

async function createMainWindow(startUrl: string): Promise<BrowserWindow> {
  const preloadPath = path.join(__dirname, 'preload.js')
  const supportsWindowTransparency = process.platform === 'darwin' || process.platform === 'win32'

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    ...(supportsWindowTransparency ? { transparent: true, backgroundColor: '#00000000' } : {}),
    ...(process.platform === 'darwin'
      ? {
          frame: false,
          titleBarStyle: 'hidden',
          visualEffectState: 'active',
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  })
  const webContentsId = window.webContents.id
  const defaultWindowAppearanceState = { ...initialWindowAppearanceState }
  windowAppearanceStateByWebContentsId.set(webContentsId, {
    ...defaultWindowAppearanceState,
  })
  window.on('closed', () => {
    windowAppearanceStateByWebContentsId.delete(webContentsId)
    windowAppearanceQueueByWebContentsId.delete(webContentsId)
  })

  if (process.platform === 'darwin' && typeof window.setWindowButtonPosition === 'function') {
    window.setWindowButtonPosition(MAC_TRAFFIC_LIGHT_POSITION)
  }

  wireNavigationGuards(window)
  try {
    await loadWindowWithRetry(window, startUrl)
  } catch (error) {
    process.stderr.write(`[formax-desktop] failed to load start URL, showing fallback page: ${String(error)}\n`)
    await loadFallbackPage(window, startUrl, error)
  }

  if (shouldOpenDevTools()) {
    window.webContents.openDevTools({ mode: 'detach' })
  }

  return window
}

async function bootstrap(): Promise<void> {
  const mode = getMode()
  const startUrl = getStartUrl()
  process.stderr.write(`[formax-desktop] mode=${mode}\n`)

  await app.whenReady()
  initializeWindowAppearanceState()
  registerDesktopIpcHandlers()

  try {
    await startManagedRuntimeIfNeeded(startUrl)
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    process.stderr.write(`[formax-desktop] managed runtime startup failed: ${message}\n`)
  }

  await createMainWindow(startUrl)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    void createMainWindow(startUrl)
  })

  app.on('before-quit', () => {
    requestManagedRuntimeShutdown()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

void bootstrap().catch((error) => {
  console.error(error)
  requestManagedRuntimeShutdown()
  app.exit(1)
})
