import { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker, shell } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { spawn as spawnPty, type IPty } from 'node-pty'
import { createDefaultWindowAppearanceState, type WindowAppearanceState } from './windowAppearanceState'

const DEFAULT_START_URL = 'http://127.0.0.1:3781'
const DEFAULT_BRIDGE_PORT = 3777

const LOAD_RETRY_ATTEMPTS = 10
const LOAD_RETRY_INTERVAL_MS = 500

const MANAGED_RUNTIME_WAIT_TIMEOUT_MS = 30_000
const MANAGED_RUNTIME_WAIT_POLL_MS = 250
const MANAGED_RUNTIME_KILL_GRACE_MS = 4_000
const WINDOW_TRANSPARENCY_FADE_SETTLE_MS = 160
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
const POWER_MANAGEMENT_CHANNEL = 'formax:desktop:power-management'
const OPEN_TARGETS_CHANNEL = 'formax:desktop:open-targets'
const TERMINAL_CHANNEL = 'formax:desktop:terminal'
const TERMINAL_EVENT_CHANNEL = 'formax:desktop:terminal:event'
const SETUP_CHANNEL = 'formax:desktop:setup'
const TERMINAL_OUTPUT_MAX_BYTES = 512 * 1024
const DEFAULT_TERMINAL_COLS = 120
const DEFAULT_TERMINAL_ROWS = 36

type DesktopWindowControl = 'close' | 'minimize' | 'toggle-maximize'
type DesktopWindowAppearanceAction = 'get-state' | 'set-window-transparency'
type DesktopPowerManagementAction = 'get-prevent-sleep' | 'set-prevent-sleep'
type DesktopOpenTargetsAction = 'list-available' | 'open-path'
type DesktopTerminalAction = 'ensure-session' | 'get-snapshot' | 'write' | 'resize' | 'destroy-session'
type DesktopSetupAction = 'complete' | 'cancel'

type OpenTargetDescriptor = {
  id: 'vscode' | 'cursor' | 'antigravity' | 'finder' | 'terminal' | 'iterm2' | 'xcode'
  label: string
}

type TerminalEnsureSessionResult = {
  created: boolean
  exists: boolean
}

type TerminalSnapshotResult = {
  exists: boolean
  output: string
  exitCode?: number | null
  dataSeq?: number
}

type TerminalEventPayload =
  | { type: 'data'; threadId: string; chunk: string; dataSeq: number }
  | { type: 'exit'; threadId: string; exitCode: number | null }

type TerminalSession = {
  threadId: string
  cwd: string
  pty: IPty
  output: string
  outputBytes: number
  exited: boolean
  exitCode: number | null
  dataSeq: number
  disposeData: () => void
  disposeExit: () => void
}

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
let managedRuntimeSetupMode: 'require-config' | 'allow' | null = null
const windowAppearanceStateByWebContentsId = new Map<number, WindowAppearanceState>()
const windowAppearanceQueueByWebContentsId = new Map<number, Promise<void>>()
const terminalSessionsByWebContentsId = new Map<number, Map<string, TerminalSession>>()
let terminalSpawnHelperChecked = false
let initialWindowAppearanceState: WindowAppearanceState = createDefaultWindowAppearanceState()
let preventSleepBlockerId: number | null = null

class ManagedRuntimeStartupError extends Error {
  constructor(
    message: string,
    readonly setupMode: 'require-config' | 'allow',
    readonly stderrTail: string,
  ) {
    super(message)
    this.name = 'ManagedRuntimeStartupError'
  }
}

const MAC_OPEN_TARGET_CANDIDATES: Array<{ id: OpenTargetDescriptor['id']; label: string; appName: string }> = [
  { id: 'vscode', label: 'VS Code', appName: 'Visual Studio Code' },
  { id: 'cursor', label: 'Cursor', appName: 'Cursor' },
  { id: 'antigravity', label: 'Antigravity', appName: 'Antigravity' },
  { id: 'finder', label: 'Finder', appName: 'Finder' },
  { id: 'terminal', label: 'Terminal', appName: 'Terminal' },
  { id: 'iterm2', label: 'iTerm2', appName: 'iTerm' },
  { id: 'xcode', label: 'Xcode', appName: 'Xcode' },
]

const WINDOWS_OPEN_TARGET_CANDIDATES: Array<{
  id: OpenTargetDescriptor['id']
  label: string
  command?: string
  alwaysAvailable?: boolean
}> = [
  { id: 'vscode', label: 'VS Code', command: 'code' },
  { id: 'cursor', label: 'Cursor', command: 'cursor' },
  { id: 'antigravity', label: 'Antigravity', command: 'antigravity' },
  { id: 'finder', label: 'Explorer', alwaysAvailable: true },
  { id: 'terminal', label: 'Terminal', command: 'wt' },
]

const LINUX_OPEN_TARGET_CANDIDATES: Array<{
  id: OpenTargetDescriptor['id']
  label: string
  command?: string
  alwaysAvailable?: boolean
}> = [
  { id: 'vscode', label: 'VS Code', command: 'code' },
  { id: 'cursor', label: 'Cursor', command: 'cursor' },
  { id: 'antigravity', label: 'Antigravity', command: 'antigravity' },
  { id: 'finder', label: 'Files', alwaysAvailable: true },
  { id: 'terminal', label: 'Terminal', command: 'x-terminal-emulator' },
]

function isPreventSleepEnabled(): boolean {
  if (preventSleepBlockerId == null) return false
  return powerSaveBlocker.isStarted(preventSleepBlockerId)
}

function setPreventSleepEnabled(enabled: boolean): boolean {
  if (enabled) {
    if (!isPreventSleepEnabled()) {
      preventSleepBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    }
    return true
  }

  if (preventSleepBlockerId != null && powerSaveBlocker.isStarted(preventSleepBlockerId)) {
    powerSaveBlocker.stop(preventSleepBlockerId)
  }
  preventSleepBlockerId = null
  return false
}

function isMacApplicationAvailable(appName: string): boolean {
  const result = spawnSync('open', ['-Ra', appName], {
    stdio: 'ignore',
  })
  return result.status === 0
}

function isCommandAvailable(command: string): boolean {
  if (!command.trim()) return false
  if (process.platform === 'win32') {
    const result = spawnSync('where', [command], {
      stdio: 'ignore',
    })
    return result.status === 0
  }
  const result = spawnSync('which', [command], {
    stdio: 'ignore',
  })
  return result.status === 0
}

function listAvailableOpenTargets(): OpenTargetDescriptor[] {
  if (process.platform === 'darwin') {
    const targets = MAC_OPEN_TARGET_CANDIDATES
      .filter((candidate) => isMacApplicationAvailable(candidate.appName))
      .map((candidate) => ({ id: candidate.id, label: candidate.label }))

    if (targets.length > 0) return targets
    return [{ id: 'finder', label: 'Finder' }]
  }

  const candidates = process.platform === 'win32' ? WINDOWS_OPEN_TARGET_CANDIDATES : LINUX_OPEN_TARGET_CANDIDATES
  const targets = candidates
    .filter((candidate) => candidate.alwaysAvailable === true || (candidate.command != null && isCommandAvailable(candidate.command)))
    .map((candidate) => ({ id: candidate.id, label: candidate.label }))

  if (targets.length > 0) return targets
  return [{ id: 'finder', label: process.platform === 'win32' ? 'Explorer' : 'Files' }]
}

function runOpenCommand(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, {
        stdio: 'ignore',
        shell: false,
        detached: true,
        windowsHide: true,
      })

      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        resolve(ok)
      }

      child.once('error', () => finish(false))
      child.once('spawn', () => {
        child.unref()
        finish(true)
      })
    } catch {
      resolve(false)
    }
  })
}

function openPathWithTarget(target: OpenTargetDescriptor['id'], rawPath: string): Promise<boolean> {
  const targetPath = rawPath.trim()
  if (!targetPath) return Promise.resolve(false)

  if (process.platform === 'darwin') {
    switch (target) {
      case 'vscode':
        return runOpenCommand('open', ['-a', 'Visual Studio Code', targetPath])
      case 'cursor':
        return runOpenCommand('open', ['-a', 'Cursor', targetPath])
      case 'antigravity':
        return runOpenCommand('open', ['-a', 'Antigravity', targetPath])
      case 'finder':
        return runOpenCommand('open', [targetPath])
      case 'terminal':
        return runOpenCommand('open', ['-a', 'Terminal', targetPath])
      case 'iterm2':
        return runOpenCommand('open', ['-a', 'iTerm', targetPath])
      case 'xcode':
        return runOpenCommand('open', ['-a', 'Xcode', targetPath])
      default:
        return Promise.resolve(false)
    }
  }

  if (process.platform === 'win32') {
    switch (target) {
      case 'vscode':
        return runOpenCommand('code', [targetPath])
      case 'cursor':
        return runOpenCommand('cursor', [targetPath])
      case 'antigravity':
        return runOpenCommand('antigravity', [targetPath])
      case 'terminal':
        return runOpenCommand('wt', ['-d', targetPath])
      case 'finder':
      case 'iterm2':
      case 'xcode':
        return runOpenCommand('explorer', [targetPath])
      default:
        return Promise.resolve(false)
    }
  }

  switch (target) {
    case 'vscode':
      return runOpenCommand('code', [targetPath])
    case 'cursor':
      return runOpenCommand('cursor', [targetPath])
    case 'antigravity':
      return runOpenCommand('antigravity', [targetPath])
    case 'terminal':
      return runOpenCommand('x-terminal-emulator', ['--working-directory', targetPath])
    case 'finder':
    case 'iterm2':
    case 'xcode':
      return runOpenCommand('xdg-open', [targetPath])
    default:
      return Promise.resolve(false)
  }
}

function findWindowByWebContentsId(webContentsId: number): BrowserWindow | null {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.webContents.id === webContentsId) return window
  }
  return null
}

function readTerminalSessionsMap(webContentsId: number, create = false): Map<string, TerminalSession> | null {
  const existing = terminalSessionsByWebContentsId.get(webContentsId)
  if (existing) return existing
  if (!create) return null
  const next = new Map<string, TerminalSession>()
  terminalSessionsByWebContentsId.set(webContentsId, next)
  return next
}

function resolveTerminalThreadId(rawThreadId: unknown): string | null {
  if (typeof rawThreadId !== 'string') return null
  const trimmed = rawThreadId.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveTerminalCwd(rawCwd: unknown): string {
  if (typeof rawCwd === 'string' && rawCwd.trim()) {
    const resolved = path.resolve(rawCwd)
    if (fs.existsSync(resolved)) return resolved
  }
  const processCwd = process.cwd()
  if (processCwd && fs.existsSync(processCwd)) return processCwd
  return app.getPath('home')
}

function resolveTerminalShellCommand(): string {
  if (process.platform === 'win32') {
    const comSpec = process.env.ComSpec?.trim()
    return comSpec && comSpec.length > 0 ? comSpec : 'powershell.exe'
  }
  const shellName = process.env.SHELL?.trim()
  return shellName && shellName.length > 0 ? shellName : '/bin/bash'
}

function resolveTerminalShellArgs(shellCommand: string): string[] {
  if (process.platform !== 'win32') return []
  const normalized = path.basename(shellCommand).toLowerCase()
  if (normalized.includes('powershell')) return ['-NoLogo']
  return []
}

function ensureTerminalSpawnHelperExecutable(): void {
  if (terminalSpawnHelperChecked) return
  terminalSpawnHelperChecked = true
  if (process.platform !== 'darwin') return

  let nodePtyRoot: string
  try {
    nodePtyRoot = path.dirname(require.resolve('node-pty/package.json'))
  } catch {
    return
  }

  const helperCandidates = [
    path.join(nodePtyRoot, 'prebuilds', 'darwin-arm64', 'spawn-helper'),
    path.join(nodePtyRoot, 'prebuilds', 'darwin-x64', 'spawn-helper'),
  ]

  for (const helperPath of helperCandidates) {
    try {
      const stats = fs.statSync(helperPath)
      if (!stats.isFile()) continue
      if ((stats.mode & 0o111) !== 0) continue
      fs.chmodSync(helperPath, stats.mode | 0o755)
    } catch {
      // Ignore permission auto-fix failures and let session spawn attempt report details.
    }
  }
}

function appendTerminalOutput(session: TerminalSession, chunk: string): void {
  if (!chunk) return
  session.output += chunk
  session.outputBytes += Buffer.byteLength(chunk, 'utf8')
  if (session.outputBytes <= TERMINAL_OUTPUT_MAX_BYTES) return

  let bytesToTrim = session.outputBytes - TERMINAL_OUTPUT_MAX_BYTES
  let trimIndex = 0
  while (bytesToTrim > 0 && trimIndex < session.output.length) {
    const codePoint = session.output.codePointAt(trimIndex)
    if (codePoint == null) break
    const char = String.fromCodePoint(codePoint)
    bytesToTrim -= Buffer.byteLength(char, 'utf8')
    trimIndex += char.length
  }

  if (trimIndex > 0) {
    session.output = session.output.slice(trimIndex)
    session.outputBytes = Buffer.byteLength(session.output, 'utf8')
  }
}

function publishTerminalEvent(webContentsId: number, payload: TerminalEventPayload): void {
  const window = findWindowByWebContentsId(webContentsId)
  if (!window || window.isDestroyed()) return
  window.webContents.send(TERMINAL_EVENT_CHANNEL, payload)
}

function disposeTerminalSession(session: TerminalSession): void {
  try {
    session.disposeData()
  } catch {
    // Ignore listener cleanup failures during shutdown.
  }
  try {
    session.disposeExit()
  } catch {
    // Ignore listener cleanup failures during shutdown.
  }
  if (!session.exited) {
    try {
      session.pty.kill()
    } catch {
      // Ignore process-kill errors when shell already terminated.
    }
  }
  session.exited = true
}

function readTerminalSnapshot(webContentsId: number, rawThreadId: unknown): TerminalSnapshotResult {
  const threadId = resolveTerminalThreadId(rawThreadId)
  if (!threadId) return { exists: false, output: '' }
  const sessions = readTerminalSessionsMap(webContentsId)
  const session = sessions?.get(threadId)
  if (!session) return { exists: false, output: '' }
  return {
    exists: !session.exited,
    output: session.output,
    dataSeq: session.dataSeq,
    ...(session.exited ? { exitCode: session.exitCode } : {}),
  }
}

function ensureTerminalSession(
  webContentsId: number,
  rawThreadId: unknown,
  rawCwd: unknown,
): TerminalEnsureSessionResult {
  const threadId = resolveTerminalThreadId(rawThreadId)
  if (!threadId) return { created: false, exists: false }

  const sessions = readTerminalSessionsMap(webContentsId, true)
  if (!sessions) return { created: false, exists: false }

  const existing = sessions.get(threadId)
  if (existing && !existing.exited) {
    return { created: false, exists: true }
  }
  if (existing) {
    sessions.delete(threadId)
    disposeTerminalSession(existing)
  }

  const cwd = resolveTerminalCwd(rawCwd)
  const shellCommand = resolveTerminalShellCommand()
  const shellArgs = resolveTerminalShellArgs(shellCommand)
  ensureTerminalSpawnHelperExecutable()

  try {
    const pty = spawnPty(shellCommand, shellArgs, {
      name: 'xterm-256color',
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    })

    const session: TerminalSession = {
      threadId,
      cwd,
      pty,
      output: '',
      outputBytes: 0,
      exited: false,
      exitCode: null,
      dataSeq: 0,
      disposeData: () => undefined,
      disposeExit: () => undefined,
    }

    const dataDisposable = pty.onData((chunk: string) => {
      if (session.exited) return
      appendTerminalOutput(session, chunk)
      session.dataSeq += 1
      publishTerminalEvent(webContentsId, { type: 'data', threadId, chunk, dataSeq: session.dataSeq })
    })
    session.disposeData = () => {
      dataDisposable.dispose()
    }
    const exitDisposable = pty.onExit((event: { exitCode?: number }) => {
      session.exited = true
      session.exitCode = typeof event.exitCode === 'number' && Number.isFinite(event.exitCode) ? event.exitCode : null
      publishTerminalEvent(webContentsId, { type: 'exit', threadId, exitCode: session.exitCode })
    })
    session.disposeExit = () => {
      exitDisposable.dispose()
    }

    sessions.set(threadId, session)
    return { created: true, exists: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[formax-desktop] failed to start terminal session for ${threadId}: ${message}\n`)
    return { created: false, exists: false }
  }
}

function writeTerminalSessionInput(webContentsId: number, rawThreadId: unknown, rawData: unknown): boolean {
  const threadId = resolveTerminalThreadId(rawThreadId)
  if (!threadId) return false
  if (typeof rawData !== 'string') return false
  const sessions = readTerminalSessionsMap(webContentsId)
  const session = sessions?.get(threadId)
  if (!session || session.exited) return false
  try {
    session.pty.write(rawData)
    return true
  } catch {
    return false
  }
}

function normalizeTerminalDimension(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.max(1, Math.floor(value))
  return Math.min(rounded, 2000)
}

function resizeTerminalSession(webContentsId: number, rawThreadId: unknown, rawCols: unknown, rawRows: unknown): boolean {
  const threadId = resolveTerminalThreadId(rawThreadId)
  if (!threadId) return false
  const sessions = readTerminalSessionsMap(webContentsId)
  const session = sessions?.get(threadId)
  if (!session || session.exited) return false
  const cols = normalizeTerminalDimension(rawCols, DEFAULT_TERMINAL_COLS)
  const rows = normalizeTerminalDimension(rawRows, DEFAULT_TERMINAL_ROWS)
  try {
    session.pty.resize(cols, rows)
    return true
  } catch {
    return false
  }
}

function destroyTerminalSession(webContentsId: number, rawThreadId: unknown): boolean {
  const threadId = resolveTerminalThreadId(rawThreadId)
  if (!threadId) return false
  const sessions = readTerminalSessionsMap(webContentsId)
  if (!sessions) return false
  const session = sessions.get(threadId)
  if (!session) return false
  sessions.delete(threadId)
  disposeTerminalSession(session)
  if (sessions.size === 0) {
    terminalSessionsByWebContentsId.delete(webContentsId)
  }
  return true
}

function destroyTerminalSessionsForWindow(webContentsId: number): void {
  const sessions = readTerminalSessionsMap(webContentsId)
  if (!sessions) return
  for (const session of sessions.values()) {
    disposeTerminalSession(session)
  }
  sessions.clear()
  terminalSessionsByWebContentsId.delete(webContentsId)
}

function destroyAllTerminalSessions(): void {
  const webContentsIds = Array.from(terminalSessionsByWebContentsId.keys())
  for (const webContentsId of webContentsIds) {
    destroyTerminalSessionsForWindow(webContentsId)
  }
}

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

function appendRuntimeStderrTail(current: string, chunk: string | Buffer): string {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  return (current + text).slice(-8192)
}

function isSetupRequiredManagedRuntimeError(error: unknown): boolean {
  if (!(error instanceof ManagedRuntimeStartupError) || error.setupMode !== 'require-config') return false
  return /requires setup first|formax setup|failed to parse .*config|invalid config|missing_(api_key|base_url|model)|zoderror/i.test(error.stderrTail)
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
    if (child.exitCode == null) {
      child.kill('SIGKILL')
    }
  }, MANAGED_RUNTIME_KILL_GRACE_MS)

  managedRuntimeStopTimer.unref()
}

async function waitForManagedRuntimeExit(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode != null) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for managed runtime to exit'))
    }, MANAGED_RUNTIME_KILL_GRACE_MS + 1000)
    timer.unref()
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
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

function buildSetupUrl(startUrl: string): string {
  const parsed = new URL(startUrl)
  const basePath = resolveUrlBasePath(parsed.pathname)
  parsed.pathname = path.posix.join(basePath, 'setup')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

function buildSetupStatusUrl(startUrl: string): string {
  const parsed = new URL(startUrl)
  const basePath = resolveUrlBasePath(parsed.pathname)
  parsed.pathname = path.posix.join(basePath, '__formax/setup/status')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

function resolveUrlBasePath(pathname: string): string {
  if (pathname.endsWith('/')) return pathname
  const lastSegment = pathname.split('/').pop() ?? ''
  if (lastSegment.includes('.')) return path.posix.dirname(pathname)
  return pathname
}

async function shouldOpenSetupWindow(startUrl: string): Promise<boolean> {
  if (!isAllowedLocalUrl(startUrl)) return false
  try {
    const statusUrl = buildSetupStatusUrl(startUrl)
    const response = await fetch(statusUrl, { method: 'GET', cache: 'no-store' })
    if (response.status === 404 || response.status === 405 || response.status === 501) return false
    if (!response.ok) return true
    const body = await response.json() as { complete?: unknown }
    return body.complete === false
  } catch (error) {
    process.stderr.write(`[formax-desktop] setup status probe failed: ${String(error)}\n`)
    return true
  }
}

async function resolveInitialWindowUrl(startUrl: string): Promise<string> {
  return (await shouldOpenSetupWindow(startUrl)) ? buildSetupUrl(startUrl) : startUrl
}

async function startManagedRuntimeIfNeeded(startUrl: string, setupMode: 'require-config' | 'allow' = 'require-config'): Promise<void> {
  const config = resolveManagedRuntimeConfig(startUrl)
  if (!config) return

  if (managedRuntimeChild && managedRuntimeChild.exitCode == null && !managedRuntimeChild.killed) {
    if (managedRuntimeSetupMode === setupMode) return
    const exitPromise = waitForManagedRuntimeExit(managedRuntimeChild)
    requestManagedRuntimeShutdown()
    await exitPromise
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
    '--setup-mode',
    setupMode,
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
  managedRuntimeSetupMode = setupMode
  let stderrTail = ''

  child.stdout?.on('data', (chunk) => {
    writeRuntimeStream('formax-runtime:stdout', chunk)
  })
  child.stderr?.on('data', (chunk) => {
    stderrTail = appendRuntimeStderrTail(stderrTail, chunk)
    writeRuntimeStream('formax-runtime:stderr', chunk)
  })

  child.once('exit', (code, signal) => {
    if (managedRuntimeChild === child) {
      managedRuntimeChild = null
      managedRuntimeSetupMode = null
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
    const message = error instanceof Error ? error.message : String(error)
    throw new ManagedRuntimeStartupError(message, setupMode, stderrTail)
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
  runMutation: (currentState: WindowAppearanceState) => WindowAppearanceState | Promise<WindowAppearanceState>,
): Promise<WindowAppearanceState> {
  const webContentsId = window.webContents.id
  const previousQueue = windowAppearanceQueueByWebContentsId.get(webContentsId) ?? Promise.resolve()
  const nextStatePromise = previousQueue.then(async () => {
    const currentState = readWindowAppearanceState(webContentsId)
    const nextState = await runMutation(currentState)
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
  ipcMain.removeHandler(POWER_MANAGEMENT_CHANNEL)
  ipcMain.removeHandler(OPEN_TARGETS_CHANNEL)
  ipcMain.removeHandler(TERMINAL_CHANNEL)
  ipcMain.removeHandler(SETUP_CHANNEL)

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

  ipcMain.handle(SETUP_CHANNEL, async (event, action: DesktopSetupAction) => {
    const ownerWindow = resolveOwnerWindow(event)
    if (action === 'cancel') {
      ownerWindow?.close()
      return true
    }
    if (action !== 'complete') return false

    const startUrl = getStartUrl()
    const child = managedRuntimeChild
    ownerWindow?.hide()
    try {
      const exitPromise = waitForManagedRuntimeExit(child)
      requestManagedRuntimeShutdown()
      await exitPromise
      await startManagedRuntimeIfNeeded(startUrl, 'require-config')
      const nextUrl = await resolveInitialWindowUrl(startUrl)
      if (nextUrl === buildSetupUrl(startUrl)) {
        if (ownerWindow && !ownerWindow.isDestroyed()) {
          await ownerWindow.loadURL(nextUrl)
          ownerWindow.show()
        } else {
          await createMainWindow(nextUrl)
        }
        return false
      }
      await createMainWindow(nextUrl)
      if (ownerWindow && !ownerWindow.isDestroyed()) {
        setImmediate(() => {
          if (!ownerWindow.isDestroyed()) ownerWindow.close()
        })
      }
      return true
    } catch (error) {
      process.stderr.write(`[formax-desktop] setup completion failed: ${String(error)}\n`)
      if (ownerWindow && !ownerWindow.isDestroyed()) {
        if (isSetupRequiredManagedRuntimeError(error)) {
          try {
            await startManagedRuntimeIfNeeded(startUrl, 'allow')
            await ownerWindow.loadURL(buildSetupUrl(startUrl))
          } catch (recoveryError) {
            process.stderr.write(`[formax-desktop] setup recovery failed: ${String(recoveryError)}\n`)
          }
        }
        if (!ownerWindow.isDestroyed()) {
          ownerWindow.show()
        }
      }
      return false
    }
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
      return queueWindowAppearanceMutation(ownerWindow, async (currentState) => {
        writePersistedWindowTransparencyEnabled(shouldEnable)
        const nextState: WindowAppearanceState = {
          revision: currentState.revision + 1,
          windowTransparencyEnabled: shouldEnable,
        }
        initialWindowAppearanceState = {
          revision: 0,
          windowTransparencyEnabled: shouldEnable,
        }
        if (process.platform === 'darwin') {
          if (shouldEnable) {
            // Enabling: activate native vibrancy before renderer goes transparent
            ownerWindow.setVibrancy('sidebar')
          } else {
            // Disabling: let renderer fill in opaque background first,
            // then remove native vibrancy after CSS transition completes
            publishWindowAppearanceState(ownerWindow, nextState)
            await sleep(WINDOW_TRANSPARENCY_FADE_SETTLE_MS)
            ownerWindow.setVibrancy(null)
          }
        }
        return nextState
      })
    },
  )

  ipcMain.handle(
    POWER_MANAGEMENT_CHANNEL,
    (_event, action: DesktopPowerManagementAction, enabled?: boolean) => {
      if (action === 'get-prevent-sleep') {
        return isPreventSleepEnabled()
      }
      if (action === 'set-prevent-sleep') {
        return setPreventSleepEnabled(enabled === true)
      }
      return isPreventSleepEnabled()
    },
  )

  ipcMain.handle(
    OPEN_TARGETS_CHANNEL,
    (_event, action: DesktopOpenTargetsAction, target?: OpenTargetDescriptor['id'], pathToOpen?: string) => {
      if (action === 'list-available') {
        return listAvailableOpenTargets()
      }
      if (action === 'open-path') {
        if (typeof target !== 'string' || typeof pathToOpen !== 'string') return false
        return openPathWithTarget(target, pathToOpen)
      }
      return listAvailableOpenTargets()
    },
  )

  ipcMain.handle(
    TERMINAL_CHANNEL,
    (event, action: DesktopTerminalAction, threadId?: string, payloadA?: unknown, payloadB?: unknown) => {
      const ownerWindow = resolveOwnerWindow(event)
      if (!ownerWindow) {
        if (action === 'get-snapshot') return { exists: false, output: '' }
        if (action === 'ensure-session') return { created: false, exists: false }
        return false
      }
      const webContentsId = ownerWindow.webContents.id
      if (action === 'ensure-session') {
        return ensureTerminalSession(webContentsId, threadId, payloadA)
      }
      if (action === 'get-snapshot') {
        return readTerminalSnapshot(webContentsId, threadId)
      }
      if (action === 'write') {
        return writeTerminalSessionInput(webContentsId, threadId, payloadA)
      }
      if (action === 'resize') {
        return resizeTerminalSession(webContentsId, threadId, payloadA, payloadB)
      }
      if (action === 'destroy-session') {
        return destroyTerminalSession(webContentsId, threadId)
      }
      return false
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
          vibrancy: initialWindowAppearanceState.windowTransparencyEnabled ? 'sidebar' : undefined,
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: preloadPath,
    },
  })
  const webContentsId = window.webContents.id
  const defaultWindowAppearanceState = { ...initialWindowAppearanceState }
  windowAppearanceStateByWebContentsId.set(webContentsId, {
    ...defaultWindowAppearanceState,
  })
  window.on('closed', () => {
    destroyTerminalSessionsForWindow(webContentsId)
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
    await startManagedRuntimeIfNeeded(startUrl, 'require-config')
  } catch (error) {
    if (!isSetupRequiredManagedRuntimeError(error)) throw error
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    process.stderr.write(`[formax-desktop] managed runtime startup failed: ${message}\n`)
    try {
      await startManagedRuntimeIfNeeded(startUrl, 'allow')
    } catch (setupError) {
      const setupMessage = setupError instanceof Error ? setupError.stack ?? setupError.message : String(setupError)
      process.stderr.write(`[formax-desktop] setup runtime startup failed: ${setupMessage}\n`)
      throw setupError
    }
  }

  await createMainWindow(await resolveInitialWindowUrl(startUrl))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    void resolveInitialWindowUrl(startUrl).then((url) => createMainWindow(url))
  })

  app.on('before-quit', () => {
    destroyAllTerminalSessions()
    setPreventSleepEnabled(false)
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
