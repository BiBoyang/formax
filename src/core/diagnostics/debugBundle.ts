import type { FileStore } from '../../adapters/fs/fileStore.js'
import type { ConfigShowResult } from '../config/show.js'
import type { LoadedPolicyRules } from '../policy/store.js'
import type { DoctorReport } from './doctor.js'
import type { StatusSnapshot } from './status.js'

type CapturedFile = {
  sourcePath: string
  bundlePath: string
  status: 'written' | 'missing' | 'error'
  redacted: boolean
  error?: string
}

export type DebugBundleManifestV1 = {
  schemaVersion: 1
  createdAt: string
  version: string
  cwd: string
  platform: string
  nodeVersion: string
  files: CapturedFile[]
  warnings: string[]
}

export type DebugBundleResult = {
  bundleDir: string
  manifestPath: string
  warnings: string[]
}

export async function createDebugBundle(args: {
  fileStore: FileStore
  bundleDir: string
  version: string
  cwd: string
  platform: string
  nodeVersion: string
  shown: ConfigShowResult
  status: StatusSnapshot
  doctor: DoctorReport
  policy: LoadedPolicyRules
}): Promise<DebugBundleResult> {
  const createdAt = new Date().toISOString()
  const bundleDir = args.bundleDir
  const warnings: string[] = []
  const files: CapturedFile[] = []

  const writeJson = async (rel: string, value: unknown): Promise<void> => {
    const bundlePath = joinPath(bundleDir, rel)
    await args.fileStore.writeJsonAtomic(bundlePath, value, { pretty: true, trailingNewline: true, mode: 0o600 })
    files.push({ sourcePath: '(generated)', bundlePath: rel, status: 'written', redacted: true })
  }

  await writeJson('doctor.json', args.doctor)
  await writeJson('status.json', args.status)
  await writeJson('config-show.json', args.shown)
  await writeJson('policy-rules.json', {
    paths: args.policy.paths,
    rules: args.policy.mergedRules,
    warnings: args.policy.warnings,
  })

  const captureJsonFile = async (sourcePath: string, rel: string): Promise<void> => {
    const bundlePath = joinPath(bundleDir, rel)
    const exists = await args.fileStore.exists(sourcePath)
    if (!exists) {
      files.push({ sourcePath, bundlePath: rel, status: 'missing', redacted: false })
      return
    }

    let raw = ''
    try {
      raw = await args.fileStore.readText(sourcePath)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      warnings.push(`Failed to read ${sourcePath}: ${msg}`)
      files.push({ sourcePath, bundlePath: rel, status: 'error', redacted: false, error: msg })
      return
    }

    try {
      const parsed = JSON.parse(raw)
      const redacted = redactJsonSecrets(parsed)
      await args.fileStore.writeJsonAtomic(bundlePath, redacted, { pretty: true, trailingNewline: true, mode: 0o600 })
      files.push({ sourcePath, bundlePath: rel, status: 'written', redacted: true })
    } catch {
      const redactedText = redactTextSecrets(raw)
      await args.fileStore.writeTextAtomic(bundlePath, redactedText, { mode: 0o600 })
      files.push({ sourcePath, bundlePath: rel, status: 'written', redacted: true })
    }
  }

  await captureJsonFile(args.shown.paths.globalConfigPath, 'config/global-config.json')
  await captureJsonFile(args.shown.paths.projectConfigPath, 'config/project-config.json')
  await captureJsonFile(args.shown.paths.globalAuthPath, 'config/auth.json')
  await captureJsonFile(args.shown.paths.globalRulesPath, 'config/global-rules.json')
  await captureJsonFile(args.shown.paths.projectRulesPath, 'config/project-rules.json')

  const manifest: DebugBundleManifestV1 = {
    schemaVersion: 1,
    createdAt,
    version: args.version,
    cwd: args.cwd,
    platform: args.platform,
    nodeVersion: args.nodeVersion,
    files,
    warnings,
  }

  const manifestPath = joinPath(bundleDir, 'manifest.json')
  await args.fileStore.writeJsonAtomic(manifestPath, manifest, { pretty: true, trailingNewline: true, mode: 0o600 })

  return { bundleDir, manifestPath, warnings }
}

function joinPath(baseRaw: string, relRaw: string): string {
  const base = String(baseRaw || '').trim()
  const rel = String(relRaw || '').trim()
  if (!base) return rel
  if (!rel) return base

  const sep = base.includes('\\') ? '\\' : '/'
  const normalizedBase = base.endsWith(sep) ? base.slice(0, -1) : base
  const normalizedRel = rel.replaceAll('\\', '/').replaceAll('/', sep).replace(new RegExp(`^${sep}+`), '')
  return normalizedBase + sep + normalizedRel
}

function redactJsonSecrets(value: unknown): unknown {
  if (typeof value === 'string') return redactTextSecrets(value)
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => redactJsonSecrets(v))
  if (typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(k)) out[k] = '<redacted>'
    else out[k] = redactJsonSecrets(v)
  }
  return out
}

function isSecretKey(key: string): boolean {
  const k = String(key || '').toLowerCase()
  return k.includes('apikey') || k.includes('api_key') || k.includes('token') || k.includes('authorization') || k.includes('password') || k.includes('secret')
}

function redactTextSecrets(text: string): string {
  let out = String(text || '')

  // Common key prefix patterns (OpenAI/Anthropic-style)
  out = out.replace(/\bsk-[a-z0-9_-]{6,}\b/gi, 'sk-<redacted>')

  // Common HTTP auth headers
  out = out.replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1<redacted>')
  out = out.replace(/(x-api-key:\s*)[^\s]+/gi, '$1<redacted>')

  return out
}
