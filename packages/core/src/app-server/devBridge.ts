import { createServer, type IncomingMessage } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { appendFile, lstat, mkdir, readFile, readlink } from 'node:fs/promises'
import path from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { createNodeFileStore } from '../config/nodeFileStore.js'
import { testSetupConnection } from '../adapters/setup/connectionTest.js'
import { writeSetupFiles } from '../adapters/setup/writeSetupFiles.js'
import { createSetupBridgeService, type SetupBridgeAction } from '../core/setup/bridgeService.js'
import type { SetupProviderOption } from '../core/setup/types.js'
import {
  authorizeBridgeConnection,
  buildWsUrl,
  evaluateBridgeRateLimit,
  type BridgeRateLimitOptions,
  type BridgeRateLimitState,
  type BridgeSecurityOptions,
} from '../runtime/network/runtime.js'
import { runAppServer } from './index.js'

export type AppServerDevBridgeOptions = {
  host?: string
  port?: number
  security?: BridgeSecurityOptions
  tls?: {
    certFile: string
    keyFile: string
  }
  rateLimit?: BridgeRateLimitOptions
  auditLogFile?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  maxRequestBytes?: number
  maxEventBytes?: number
  maxPendingInputsPerThread?: number
  defaultInputTtlMs?: number
  setupMode?: 'require-config' | 'allow'
  rpcOverrides?: {
    readDiff?: (cwd: string, params: BridgeReadDiffParams | undefined) => Promise<BridgeReadDiffResult>
    readDiffSummary?: (cwd: string, params: BridgeReadDiffSummaryParams | undefined) => Promise<BridgeReadDiffSummaryResult>
    readDiffFilePatch?: (cwd: string, params: BridgeReadDiffFilePatchParams | undefined) => Promise<BridgeReadDiffFilePatchResult>
  }
}

export type AppServerDevBridgeHandle = {
  url: string
  close: () => Promise<void>
}

type BridgeReadDiffParams = {
  maxBytes?: number
  cwd?: string
}

type BridgeReadDiffSummaryParams = {
  maxFiles?: number
  cwd?: string
}

type BridgeReadDiffFilePatchParams = {
  path?: string
  maxBytes?: number
  cwd?: string
}

type BridgeDiffFile = {
  path: string
  additions: number
  deletions: number
  patch: string
  untracked?: boolean
}

type BridgeDiffSummaryFile = Omit<BridgeDiffFile, 'patch'>

type BridgeReadDiffResult = {
  cwd: string
  generatedAt: string
  hasChanges: boolean
  truncated: boolean
  files: BridgeDiffFile[]
}

type BridgeReadDiffSummaryResult = {
  cwd: string
  generatedAt: string
  hasChanges: boolean
  truncated: boolean
  files: BridgeDiffSummaryFile[]
}

type BridgeReadDiffFilePatchResult = {
  cwd: string
  generatedAt: string
  path: string
  found: boolean
  truncated: boolean
  file: BridgeDiffFile | null
}

type BridgeAuditEntry = {
  ts: string
  event: string
  details?: Record<string, unknown>
}

const SETUP_PROVIDERS: SetupProviderOption[] = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI-compatible' },
  { id: 'gemini', label: 'Gemini', disabled: true },
]

function normalizeMaxBytes(value: unknown, fallback = 180 * 1024): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(32 * 1024, Math.min(parsed, 2 * 1024 * 1024))
}

function normalizeMaxFiles(value: unknown, fallback = 600): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(20, Math.min(Math.floor(parsed), 5000))
}

function resolveDiffCwd(defaultCwd: string, requestedCwd: unknown): string {
  if (typeof requestedCwd !== 'string') return defaultCwd
  const trimmed = requestedCwd.trim()
  if (!trimmed) return defaultCwd
  return path.resolve(trimmed)
}

function writeJsonlLine(stream: PassThrough, text: string): void {
  const line = text.trim()
  if (!line) return
  stream.write(line + '\n')
}

function createSetupJsonRpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
}

function parseSetupAction(value: unknown): SetupBridgeAction | null {
  if (!value || typeof value !== 'object') return null
  const action = value as Record<string, unknown>
  switch (action.type) {
    case 'setProvider':
      return action.provider === 'anthropic' || action.provider === 'openai' || action.provider === 'gemini'
        ? ({ type: 'setProvider', provider: action.provider as any })
        : null
    case 'setAnthropicVendor':
      return action.vendor === 'deepseek' ||
        action.vendor === 'anthropic' ||
        action.vendor === 'glm' ||
        action.vendor === 'kimi' ||
        action.vendor === 'minimax' ||
        action.vendor === 'custom'
        ? ({ type: 'setAnthropicVendor', vendor: action.vendor as any })
        : null
    case 'setBaseUrl':
      return typeof action.baseUrl === 'string' ? { type: 'setBaseUrl', baseUrl: action.baseUrl } : null
    case 'setApiKey':
      return typeof action.apiKey === 'string' ? { type: 'setApiKey', apiKey: action.apiKey } : null
    case 'setModelMode':
      return action.mode === 'quick' || action.mode === 'advanced'
        ? ({ type: 'setModelMode', mode: action.mode as any })
        : null
    case 'setModel':
      return typeof action.model === 'string' ? { type: 'setModel', model: action.model } : null
    case 'next':
      return { type: 'next' }
    case 'back':
      return { type: 'back' }
    default:
      return null
  }
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

function createBridgeAuditWriter(auditLogFile: string | undefined): {
  write: (entry: BridgeAuditEntry) => void
  flush: () => Promise<void>
} {
  if (!auditLogFile) {
    return {
      write: () => undefined,
      flush: async () => undefined,
    }
  }

  const filePath = path.resolve(auditLogFile)
  let ensureDirPromise: Promise<void> | null = null
  let queue: Promise<void> = Promise.resolve()

  const ensureDir = (): Promise<void> => {
    if (!ensureDirPromise) {
      ensureDirPromise = mkdir(path.dirname(filePath), { recursive: true }).then(() => undefined)
    }
    return ensureDirPromise
  }

  return {
    write: (entry) => {
      queue = queue
        .then(async () => {
          await ensureDir()
          await appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8')
        })
        .catch(() => undefined)
    },
    flush: async () => {
      await queue
    },
  }
}

async function runGit(
  cwd: string,
  args: string[],
  deps?: {
    execFileFn?: typeof execFile
  },
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  const execFileFn = deps?.execFileFn ?? execFile
  return new Promise((resolve) => {
    execFileFn(
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
    const first = lines[0]
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(first.trim())
    const path = match ? match[2] : 'unknown'
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

type GitRenamePair = {
  oldPath: string
  newPath: string
}

function parseRenamePairs(nameStatusText: string): GitRenamePair[] {
  if (!nameStatusText.trim()) return []
  const out: GitRenamePair[] = []
  for (const rawLine of nameStatusText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const status = parts[0]
    if (!status.startsWith('R')) continue
    const oldPath = parts[1]?.trim()
    const newPath = parts[2]?.trim()
    if (!oldPath || !newPath) continue
    out.push({ oldPath, newPath })
  }
  return out
}

function parseNumstatFiles(diffText: string, renamePairs: GitRenamePair[]): BridgeDiffSummaryFile[] {
  if (!diffText.trim()) return []
  const files: BridgeDiffSummaryFile[] = []
  for (const rawLine of diffText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = /^([0-9-]+)\t([0-9-]+)\t(.+)$/.exec(line)
    if (!match) continue
    const [, addText, delText, rawPath] = match
    const filePath = normalizeNumstatPath(rawPath, renamePairs)
    files.push({
      path: filePath,
      additions: addText === '-' ? 0 : Number(addText),
      deletions: delText === '-' ? 0 : Number(delText),
    })
  }
  return files
}

function normalizeNumstatPath(rawPath: string, renamePairs: GitRenamePair[]): string {
  if (!rawPath.includes(' => ')) return rawPath
  if (renamePairs.length === 0) return rawPath

  // Plain rename shape: old/path.ts => new/path.ts
  const direct = renamePairs.find((pair) => `${pair.oldPath} => ${pair.newPath}` === rawPath)
  if (direct) return direct.newPath

  // Brace shape: path/{old => new}.ts or {old => new}/path.ts.
  const braceExpanded = rawPath.replace(/\{([^{}]*?) => ([^{}]*?)\}/g, '$2')
  if (braceExpanded !== rawPath) {
    const matched = renamePairs.find((pair) => pair.newPath === braceExpanded)
    if (matched) return matched.newPath
  }

  return rawPath
}

function mergeSummaryFiles(
  tracked: BridgeDiffSummaryFile[],
  untrackedPaths: string[],
): BridgeDiffSummaryFile[] {
  const merged = new Map<string, BridgeDiffSummaryFile>()
  for (const file of tracked) {
    merged.set(file.path, file)
  }
  for (const filePath of untrackedPaths) {
    if (merged.has(filePath)) continue
    merged.set(filePath, {
      path: filePath,
      additions: 0,
      deletions: 0,
      untracked: true,
    })
  }
  return Array.from(merged.values())
}

function estimateDiffFileBaseBytes(filePath: string): number {
  return Buffer.byteLength(filePath, 'utf8') + 128
}

function appendDiffFileWithinBudget(
  out: BridgeDiffFile[],
  file: BridgeDiffFile,
  used: number,
  maxBytes: number,
): { used: number; truncated: boolean } {
  const baseBytes = estimateDiffFileBaseBytes(file.path)
  if (used + baseBytes >= maxBytes) {
    return { used, truncated: true }
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
  return { used: used + baseBytes + Buffer.byteLength(patch, 'utf8'), truncated }
}

function countContentLines(text: string): number {
  if (text.length === 0) return 0
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (normalized.endsWith('\n')) lines.pop()
  return lines.length
}

async function buildUntrackedDiffFile(
  cwd: string,
  filePath: string,
  deps?: {
    readlinkFn?: typeof readlink
  },
): Promise<BridgeDiffFile> {
  const absPath = path.resolve(cwd, filePath)
  const readlinkFn = deps?.readlinkFn ?? readlink
  try {
    const stats = await lstat(absPath)
    if (stats.isSymbolicLink()) {
      const linkTarget = await readlinkFn(absPath).catch(() => null)
      const linkLine = linkTarget ? `+${linkTarget}` : '+(unavailable)'
      return {
        path: filePath,
        additions: linkTarget ? 1 : 0,
        deletions: 0,
        patch: [
          `diff --git a/${filePath} b/${filePath}`,
          'new file mode 120000',
          'index 0000000..0000000',
          '--- /dev/null',
          `+++ b/${filePath}`,
          '@@ -0,0 +1 @@',
          linkLine,
        ].join('\n'),
        untracked: true,
      }
    }

    if (!stats.isFile()) {
      return {
        path: filePath,
        additions: 0,
        deletions: 0,
        patch: `diff --git a/${filePath} b/${filePath}\nnew file mode 100644\n(file content unavailable)`,
        untracked: true,
      }
    }

    const raw = await readFile(absPath)
    const text = raw.toString('utf8')
    if (text.includes('\u0000')) {
      return {
        path: filePath,
        additions: 0,
        deletions: 0,
        patch: `diff --git a/${filePath} b/${filePath}\nnew file mode 100644\nBinary files /dev/null and b/${filePath} differ`,
        untracked: true,
      }
    }

    const normalized = text.replace(/\r\n/g, '\n')
    const lines = normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n')
    const additions = countContentLines(text)
    const hunk =
      additions > 0 ? `@@ -0,0 +1,${additions} @@\n${lines.map((line) => `+${line}`).join('\n')}` : ''
    const patchLines = [
      `diff --git a/${filePath} b/${filePath}`,
      'new file mode 100644',
      'index 0000000..0000000',
      '--- /dev/null',
      `+++ b/${filePath}`,
      hunk,
    ].filter((line) => line.length > 0)

    return {
      path: filePath,
      additions,
      deletions: 0,
      patch: patchLines.join('\n'),
      untracked: true,
    }
  } catch {
    return {
      path: filePath,
      additions: 0,
      deletions: 0,
      patch: `diff --git a/${filePath} b/${filePath}\nnew file mode 100644\n(file content unavailable)`,
      untracked: true,
    }
  }
}

async function readWorkspaceDiff(
  cwd: string,
  params: BridgeReadDiffParams | undefined,
  deps?: {
    runGitFn?: typeof runGit
    buildUntrackedDiffFileFn?: typeof buildUntrackedDiffFile
  },
): Promise<BridgeReadDiffResult> {
  const runGitFn = deps?.runGitFn ?? runGit
  const buildUntrackedDiffFileFn = deps?.buildUntrackedDiffFileFn ?? buildUntrackedDiffFile
  const maxBytes = normalizeMaxBytes(params?.maxBytes)
  const generatedAt = new Date().toISOString()

  const [diffFromHead, fallbackDiff, untracked] = await Promise.all([
    runGitFn(cwd, ['diff', 'HEAD', '--no-color', '--patch', '--find-renames']),
    runGitFn(cwd, ['diff', '--no-color', '--patch', '--find-renames']),
    runGitFn(cwd, ['ls-files', '--others', '--exclude-standard']),
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
          patch: `git diff unavailable in ${cwd}\n${String(firstError)}`,
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
  const untrackedPaths = untracked.ok
    ? untracked.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : []

  const files: BridgeDiffFile[] = []
  let usedBytes = 0
  let truncated = false

  for (const file of trackedFiles) {
    const appended = appendDiffFileWithinBudget(files, file, usedBytes, maxBytes)
    usedBytes = appended.used
    if (appended.truncated) {
      truncated = true
      break
    }
  }

  if (!truncated) {
    for (const filePath of untrackedPaths) {
      // Stop before expensive file reads when there is no byte budget for another file.
      if (usedBytes + estimateDiffFileBaseBytes(filePath) >= maxBytes) {
        truncated = true
        break
      }
      const file = await buildUntrackedDiffFileFn(cwd, filePath)
      const appended = appendDiffFileWithinBudget(files, file, usedBytes, maxBytes)
      usedBytes = appended.used
      if (appended.truncated) {
        truncated = true
        break
      }
    }
  }

  return {
    cwd,
    generatedAt,
    hasChanges: trackedFiles.length + untrackedPaths.length > 0,
    truncated,
    files,
  }
}

async function readWorkspaceDiffSummary(
  cwd: string,
  params: BridgeReadDiffSummaryParams | undefined,
  deps?: {
    runGitFn?: typeof runGit
  },
): Promise<BridgeReadDiffSummaryResult> {
  const runGitFn = deps?.runGitFn ?? runGit
  const maxFiles = normalizeMaxFiles(params?.maxFiles)
  const generatedAt = new Date().toISOString()

  const [diffFromHeadNumstat, fallbackDiffNumstat, diffFromHeadNameStatus, fallbackDiffNameStatus, untracked] = await Promise.all([
    runGitFn(cwd, ['diff', 'HEAD', '--no-color', '--numstat', '--find-renames']),
    runGitFn(cwd, ['diff', '--no-color', '--numstat', '--find-renames']),
    runGitFn(cwd, ['diff', 'HEAD', '--name-status', '--find-renames']),
    runGitFn(cwd, ['diff', '--name-status', '--find-renames']),
    runGitFn(cwd, ['ls-files', '--others', '--exclude-standard']),
  ])

  if (!diffFromHeadNumstat.ok && !fallbackDiffNumstat.ok && !untracked.ok) {
    return {
      cwd,
      generatedAt,
      hasChanges: true,
      truncated: false,
      files: [{ path: 'git-diff-error', additions: 0, deletions: 0 }],
    }
  }

  const trackedDiff =
    (diffFromHeadNumstat.ok && diffFromHeadNumstat.stdout.trim()
      ? diffFromHeadNumstat.stdout
      : fallbackDiffNumstat.ok
        ? fallbackDiffNumstat.stdout
        : '') || ''
  const renameStatusText =
    (diffFromHeadNameStatus.ok && diffFromHeadNameStatus.stdout.trim()
      ? diffFromHeadNameStatus.stdout
      : fallbackDiffNameStatus.ok
        ? fallbackDiffNameStatus.stdout
        : '') || ''
  const renamePairs = parseRenamePairs(renameStatusText)
  const trackedFiles = parseNumstatFiles(trackedDiff, renamePairs)
  const untrackedPaths = untracked.ok
    ? untracked.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : []

  const merged = mergeSummaryFiles(trackedFiles, untrackedPaths)
  const truncated = merged.length > maxFiles
  const files = truncated ? merged.slice(0, maxFiles) : merged
  return {
    cwd,
    generatedAt,
    hasChanges: merged.length > 0,
    truncated,
    files,
  }
}

function findPatchByRequestedPath(files: BridgeDiffFile[], requestedPath: string): BridgeDiffFile | null {
  for (const file of files) {
    if (file.path === requestedPath) return file
  }
  for (const file of files) {
    if (file.path.endsWith(`/${requestedPath}`) || requestedPath.endsWith(`/${file.path}`)) return file
  }
  return null
}

function clipDiffFileWithinBudget(file: BridgeDiffFile, maxBytes: number): { file: BridgeDiffFile; truncated: boolean } {
  const out: BridgeDiffFile[] = []
  const appended = appendDiffFileWithinBudget(out, file, 0, maxBytes)
  if (out.length === 0) {
    return {
      file: { ...file, patch: '' },
      truncated: true,
    }
  }
  return {
    file: out[0],
    truncated: appended.truncated,
  }
}

async function readWorkspaceDiffFilePatch(
  cwd: string,
  params: BridgeReadDiffFilePatchParams | undefined,
  deps?: {
    runGitFn?: typeof runGit
    buildUntrackedDiffFileFn?: typeof buildUntrackedDiffFile
  },
): Promise<BridgeReadDiffFilePatchResult> {
  const runGitFn = deps?.runGitFn ?? runGit
  const buildUntrackedDiffFileFn = deps?.buildUntrackedDiffFileFn ?? buildUntrackedDiffFile
  const generatedAt = new Date().toISOString()
  const requestedPath = typeof params?.path === 'string' ? params.path.trim() : ''
  const maxBytes = normalizeMaxBytes(params?.maxBytes, 256 * 1024)
  if (!requestedPath) {
    return {
      cwd,
      generatedAt,
      path: '',
      found: false,
      truncated: false,
      file: null,
    }
  }

  const [diffFromHead, fallbackDiff, untracked] = await Promise.all([
    runGitFn(cwd, ['diff', 'HEAD', '--no-color', '--patch', '--find-renames', '--', requestedPath]),
    runGitFn(cwd, ['diff', '--no-color', '--patch', '--find-renames', '--', requestedPath]),
    runGitFn(cwd, ['ls-files', '--others', '--exclude-standard', '--', requestedPath]),
  ])

  const trackedPatch =
    (diffFromHead.ok && diffFromHead.stdout.trim()
      ? diffFromHead.stdout
      : fallbackDiff.ok
        ? fallbackDiff.stdout
        : '') || ''

  let file: BridgeDiffFile | null = null
  if (trackedPatch.trim()) {
    file = findPatchByRequestedPath(parsePatchFiles(trackedPatch), requestedPath)
  }

  if (!file) {
    const untrackedPaths = untracked.ok
      ? untracked.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      : []
    if (untrackedPaths.includes(requestedPath)) {
      file = await buildUntrackedDiffFileFn(cwd, requestedPath)
    }
  }

  if (!file) {
    return {
      cwd,
      generatedAt,
      path: requestedPath,
      found: false,
      truncated: false,
      file: null,
    }
  }

  const clipped = clipDiffFileWithinBudget(file, maxBytes)
  return {
    cwd,
    generatedAt,
    path: requestedPath,
    found: true,
    truncated: clipped.truncated,
    file: clipped.file,
  }
}

export async function startAppServerDevBridge(options: AppServerDevBridgeOptions = {}): Promise<AppServerDevBridgeHandle> {
  const input = new PassThrough()
  const output = new PassThrough()
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 3777
  const secure = Boolean(options.tls)
  const audit = createBridgeAuditWriter(options.auditLogFile)
  const rateLimit = options.rateLimit
  const tlsServerOptions = options.tls
    ? {
        cert: await readFile(options.tls.certFile),
        key: await readFile(options.tls.keyFile),
      }
    : null
  const httpServer = tlsServerOptions ? createHttpsServer(tlsServerOptions) : createServer()
  const wsServer = new WebSocketServer({ server: httpServer })
  const clients = new Set<WebSocket>()
  let outputBuffer = ''
  let closed = false
  const setupFileStore = createNodeFileStore()
  const setupService = createSetupBridgeService({
    providers: SETUP_PROVIDERS,
    fileStore: setupFileStore,
    testConnection: testSetupConnection,
    createSessionId: randomUUID,
    cwd: options.cwd,
    env: options.env,
    writeSetup: async (draft, writeOptions) => {
      if (!draft.provider) throw new Error('Missing provider')
      return writeSetupFiles({
        fileStore: setupFileStore,
        cwd: options.cwd,
        env: options.env,
        provider: draft.provider,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
        persistApiKey: writeOptions?.persistApiKey,
        authRef: writeOptions?.authRef,
        model: draft.model,
        tierModels: draft.tierModels,
        tierContextWindowTokens: draft.tierContextWindowTokens,
        tierContextWindowSources: draft.tierContextWindowSources,
        tierContextWindowConfidence: draft.tierContextWindowConfidence,
        tierContextWindowBindings: draft.tierContextWindowBindings,
        contextWindowTokens: draft.contextWindowTokens,
        contextWindowSource: draft.tierContextWindowSources?.sonnet,
      })
    },
  })

  audit.write({
    ts: new Date().toISOString(),
    event: 'bridge_start',
    details: {
      host,
      port,
      secure,
      hasToken: Boolean(options.security?.authToken),
      allowedOrigins: options.security?.allowedOrigins?.length ?? 0,
      rateLimit,
      setupMode: options.setupMode ?? 'require-config',
    },
  })

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

  wsServer.on('connection', (socket, request: IncomingMessage) => {
    const remoteAddress = request.socket?.remoteAddress ?? null
    const authorization = authorizeBridgeConnection({
      requestUrl: request.url,
      originHeader: request.headers.origin,
      authorizationHeader: typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined,
      security: options.security,
    })
    if (authorization.ok === false) {
      audit.write({
        ts: new Date().toISOString(),
        event: 'connection_rejected',
        details: {
          reason: authorization.reason,
          remoteAddress,
          origin: request.headers.origin ?? null,
        },
      })
      try {
        socket.close(1008, authorization.reason)
      } catch {
        // Ignore close failures for rejected sockets.
      }
      return
    }

    audit.write({
      ts: new Date().toISOString(),
      event: 'connection_open',
      details: {
        remoteAddress,
        origin: request.headers.origin ?? null,
      },
    })

    clients.add(socket)
    const setupSessionIds = new Set<string>()
    socket.on('close', () => {
      clients.delete(socket)
      for (const sessionId of setupSessionIds) setupService.disposeSession(sessionId)
      setupSessionIds.clear()
      audit.write({
        ts: new Date().toISOString(),
        event: 'connection_close',
        details: {
          remoteAddress,
        },
      })
    })
    socket.on('error', () => undefined)

    let rateLimitState: BridgeRateLimitState | null = null
    socket.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8')
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue

        if (rateLimit) {
          const decision = evaluateBridgeRateLimit({
            state: rateLimitState,
            nowMs: Date.now(),
            options: rateLimit,
          })
          rateLimitState = decision.state
          if (!decision.allowed) {
            audit.write({
              ts: new Date().toISOString(),
              event: 'message_rejected_rate_limit',
              details: {
                remoteAddress,
                count: decision.state.count,
                windowMs: rateLimit.windowMs,
                maxMessages: rateLimit.maxMessages,
              },
            })
            try {
              socket.close(1008, 'Rate limit exceeded')
            } catch {
              // Ignore close failures for limited sockets.
            }
            return
          }
        }

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

        if (isRequest && String(parsed.method).startsWith('bridge/setup/')) {
          audit.write({
            ts: new Date().toISOString(),
            event: 'bridge_rpc',
            details: {
              method: parsed.method,
              remoteAddress,
            },
          })
          const setupAllowed = options.setupMode === 'allow'
          const params = (parsed.params ?? {}) as Record<string, unknown>
          void (async () => {
            if (parsed.method === 'bridge/setup/status') return setupService.status()
            if (!setupAllowed) {
              throw Object.assign(new Error('Setup mode is not enabled for this bridge.'), { code: -32003 })
            }
            if (parsed.method === 'bridge/setup/session/create') {
              const session = setupService.createSession()
              setupSessionIds.add(session.id)
              return session
            }
            if (parsed.method === 'bridge/setup/session/action') {
              const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
              const action = parseSetupAction(params.action)
              if (!sessionId || !action) {
                throw Object.assign(new Error('Invalid setup session action.'), { code: -32602 })
              }
              if (!setupSessionIds.has(sessionId)) {
                return { ok: false, code: 'session_not_found', message: 'Setup session was not found or has expired.' }
              }
              return setupService.applyAction(sessionId, action)
            }
            if (parsed.method === 'bridge/setup/session/commit') {
              const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
              if (!sessionId) throw Object.assign(new Error('Missing setup session id.'), { code: -32602 })
              if (!setupSessionIds.has(sessionId)) {
                return { ok: false, code: 'session_not_found', message: 'Setup session was not found or has expired.' }
              }
              const result = await setupService.commit(sessionId)
              if (result.ok) setupSessionIds.delete(sessionId)
              return result
            }
            if (parsed.method === 'bridge/setup/session/dispose') {
              const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
              if (!sessionId) throw Object.assign(new Error('Missing setup session id.'), { code: -32602 })
              if (!setupSessionIds.has(sessionId)) {
                return { ok: false, code: 'session_not_found', message: 'Setup session was not found or has expired.' }
              }
              setupService.disposeSession(sessionId)
              setupSessionIds.delete(sessionId)
              return { ok: true }
            }
            throw Object.assign(new Error(`Unknown setup method: ${parsed.method}`), { code: -32601 })
          })()
            .then((result) => {
              if (socket.readyState !== WebSocket.OPEN) return
              socket.send(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }))
            })
            .catch((error) => {
              if (socket.readyState !== WebSocket.OPEN) return
              const code = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : -32603
              socket.send(createSetupJsonRpcError(parsed.id, code, error instanceof Error ? error.message : String(error)))
            })
          continue
        }

        if (
          isRequest &&
          (parsed.method === 'bridge/readDiff' ||
            parsed.method === 'bridge/readDiffSummary' ||
            parsed.method === 'bridge/readDiffFilePatch')
        ) {
          audit.write({
            ts: new Date().toISOString(),
            event: 'bridge_rpc',
            details: {
              method: parsed.method,
              remoteAddress,
            },
          })
          const baseCwd = options.cwd ?? process.cwd()
          const rawParams = (parsed.params ?? {}) as { cwd?: unknown }
          const diffCwd = resolveDiffCwd(baseCwd, rawParams.cwd)
          const rpcPromise =
            parsed.method === 'bridge/readDiff'
              ? (options.rpcOverrides?.readDiff ?? readWorkspaceDiff)(diffCwd, (parsed.params ?? {}) as BridgeReadDiffParams)
              : parsed.method === 'bridge/readDiffSummary'
                ? (options.rpcOverrides?.readDiffSummary ?? readWorkspaceDiffSummary)(
                    diffCwd,
                    (parsed.params ?? {}) as BridgeReadDiffSummaryParams,
                  )
                : (options.rpcOverrides?.readDiffFilePatch ?? readWorkspaceDiffFilePatch)(
                    diffCwd,
                    (parsed.params ?? {}) as BridgeReadDiffFilePatchParams,
                  )

          void rpcPromise
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
              audit.write({
                ts: new Date().toISOString(),
                event: 'bridge_rpc_error',
                details: {
                  method: parsed.method,
                  remoteAddress,
                  message: String(error instanceof Error ? error.message : error),
                },
              })
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
  const url = buildWsUrl(host, addr.port, secure)

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
      setupService.shutdown()
      await runPromise.catch(() => undefined)
      await audit.flush()
    },
  }
}

export const __devBridgeTestHooks = {
  normalizeMaxBytes,
  normalizeMaxFiles,
  resolveDiffCwd,
  writeJsonlLine,
  broadcastLine,
  createBridgeAuditWriter,
  runGit,
  parsePatchFiles,
  parseRenamePairs,
  parseNumstatFiles,
  normalizeNumstatPath,
  mergeSummaryFiles,
  estimateDiffFileBaseBytes,
  appendDiffFileWithinBudget,
  countContentLines,
  buildUntrackedDiffFile,
  readWorkspaceDiff,
  readWorkspaceDiffSummary,
  findPatchByRequestedPath,
  clipDiffFileWithinBudget,
  readWorkspaceDiffFilePatch,
}
