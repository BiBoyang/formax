import type { FileStore } from '../../adapters/fs/fileStore.js'
import type { ConfigShowResult } from '../../config/settings/show.js'
import type { LoadedPolicyRules } from '../policy/store.js'
import type { DoctorReport } from './doctor.js'
import type { StatusSnapshot } from './status.js'
import { redactJsonSecrets, redactTextSecrets } from './redaction.js'

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
  logsDir?: string
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

  const captureTextFile = async (sourcePath: string, rel: string): Promise<void> => {
    const bundlePath = joinPath(bundleDir, rel)
    const exists = await args.fileStore.exists(sourcePath)
    if (!exists) {
      files.push({ sourcePath, bundlePath: rel, status: 'missing', redacted: false })
      return
    }

    try {
      const raw = await args.fileStore.readText(sourcePath)
      const redactedText = redactTextSecrets(raw)
      await args.fileStore.writeTextAtomic(bundlePath, redactedText, { mode: 0o600 })
      files.push({ sourcePath, bundlePath: rel, status: 'written', redacted: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      warnings.push(`Failed to read ${sourcePath}: ${msg}`)
      files.push({ sourcePath, bundlePath: rel, status: 'error', redacted: false, error: msg })
    }
  }

  if (args.logsDir) {
    await captureTextFile(joinPath(args.logsDir, 'audit.ndjson'), 'logs/audit.ndjson')
  }

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

export const __testOnlyDebugBundle = {
  joinPath,
}
