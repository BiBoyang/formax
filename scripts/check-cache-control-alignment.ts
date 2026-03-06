import fs from 'node:fs/promises'
import path from 'node:path'

type CliOptions = {
  dir: string | null
  includeSimple: boolean
}

type CheckFailure = {
  file: string
  rule: string
  detail: string
}

type FileCheckResult = {
  file: string
  ok: boolean
  failureCount: number
}

type AlignmentReport = {
  kind: 'formax_cache_control_alignment_report_v1'
  createdAt: string
  targetDir: string
  includeSimple: boolean
  totalFiles: number
  passedFiles: number
  failedFiles: number
  failures: CheckFailure[]
}

const MESSAGE_CACHE_BREAKPOINTS = 2

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const targetDir = await resolveTargetDir(options, cwd)
  const files = await listRequestFiles(targetDir, options.includeSimple)
  if (files.length === 0) {
    throw new Error(`No request files matched under ${targetDir}`)
  }

  const failures: CheckFailure[] = []
  const fileResults: FileCheckResult[] = []

  for (const file of files) {
    const fileFailures = await checkFile(path.join(targetDir, file))
    failures.push(...fileFailures)
    fileResults.push({
      file,
      ok: fileFailures.length === 0,
      failureCount: fileFailures.length,
    })
  }

  const report: AlignmentReport = {
    kind: 'formax_cache_control_alignment_report_v1',
    createdAt: new Date().toISOString(),
    targetDir,
    includeSimple: options.includeSimple,
    totalFiles: files.length,
    passedFiles: fileResults.filter((f) => f.ok).length,
    failedFiles: fileResults.filter((f) => !f.ok).length,
    failures,
  }

  const reportPath = path.join(targetDir, 'cache-control-alignment-report.json')
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  renderConsoleSummary({
    report,
    fileResults,
    reportPath,
  })

  if (report.failedFiles > 0) {
    process.exitCode = 1
  }
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    dir: null,
    includeSimple: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') {
      printHelpAndExit()
    } else if (token === '--dir') {
      const value = argv[i + 1]
      if (!value) throw new Error('--dir requires a value')
      out.dir = value
      i += 1
    } else if (token === '--include-simple') {
      out.includeSimple = true
    } else {
      throw new Error(`Unknown option: ${token}`)
    }
  }

  return out
}

function printHelpAndExit(): never {
  const lines = [
    'Usage: bun run request:check:cache-control -- [options]',
    '',
    'Options:',
    '  --dir <path>         Target directory containing *_REQ__v1_messages*.json files',
    '  --include-simple     Include *.simple.json files in addition to raw files',
    '  --help               Show this help',
    '',
    'Default target directory:',
    '  Latest proxy/request-preview/traffic-log-* under current working directory.',
  ]
  console.log(lines.join('\n'))
  process.exit(0)
}

async function resolveTargetDir(options: CliOptions, cwd: string): Promise<string> {
  if (options.dir) return path.resolve(cwd, options.dir)

  const previewRoot = path.resolve(cwd, 'proxy', 'request-preview')
  const latestPreview = await findLatestTrafficLogDir(previewRoot)
  if (latestPreview) return latestPreview

  const proxyRoot = path.resolve(cwd, 'proxy')
  const latestProxy = await findLatestTrafficLogDir(proxyRoot)
  if (latestProxy) return latestProxy

  throw new Error(
    `Could not find any traffic-log-* directory under ${previewRoot} or ${proxyRoot}.`,
  )
}

async function findLatestTrafficLogDir(root: string): Promise<string | null> {
  let entries: Array<fs.Dirent> = []
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return null
  }
  const names = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('traffic-log-'))
    .map((entry) => entry.name)
    .sort()
  if (names.length === 0) return null
  return path.join(root, names[names.length - 1] as string)
}

async function listRequestFiles(dir: string, includeSimple: boolean): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => {
      const isRaw = /_REQ__v1_messages\.json$/i.test(name)
      const isSimple = /_REQ__v1_messages\.simple\.json$/i.test(name)
      if (includeSimple) return isRaw || isSimple
      return isRaw
    })
    .sort()
}

async function checkFile(filePath: string): Promise<CheckFailure[]> {
  const raw = await fs.readFile(filePath, 'utf8')
  const json = JSON.parse(raw) as any
  const body = json?.request?.body
  const rel = path.basename(filePath)
  const failures: CheckFailure[] = []

  if (!body || typeof body !== 'object') {
    failures.push({
      file: rel,
      rule: 'payload-shape',
      detail: 'request.body missing or invalid',
    })
    return failures
  }

  const system = Array.isArray(body.system) ? body.system : []
  for (let i = 0; i < system.length; i += 1) {
    const block = system[i]
    if (!block || typeof block !== 'object') continue
    if (block.type !== 'text') continue
    if (block?.cache_control?.type !== 'ephemeral') {
      failures.push({
        file: rel,
        rule: 'system-text-ephemeral',
        detail: `system[${i}] missing cache_control.type=ephemeral`,
      })
    }
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  const expectedMessageIndexes = pickTailMessageIndexes(messages, MESSAGE_CACHE_BREAKPOINTS)
  const expectedSet = new Set(expectedMessageIndexes)

  for (let mi = 0; mi < messages.length; mi += 1) {
    const message = messages[mi]
    const content = Array.isArray(message?.content) ? message.content : []
    if (content.length === 0) continue
    const lastIndex = content.length - 1

    for (let bi = 0; bi < content.length; bi += 1) {
      const block = content[bi]
      const hasCacheControl = block && typeof block === 'object' && 'cache_control' in block
      if (bi === lastIndex) {
        const shouldHave = expectedSet.has(mi)
        if (shouldHave && (!hasCacheControl || block?.cache_control?.type !== 'ephemeral')) {
          failures.push({
            file: rel,
            rule: 'message-last-ephemeral',
            detail: `messages[${mi}].content[${bi}] should be cache_control.type=ephemeral`,
          })
        } else if (!shouldHave && hasCacheControl) {
          failures.push({
            file: rel,
            rule: 'message-non-tail-no-cache-control',
            detail: `messages[${mi}].content[${bi}] should not carry cache_control (only tail messages may)`,
          })
        }
      } else if (hasCacheControl) {
        failures.push({
          file: rel,
          rule: 'message-nonlast-no-cache-control',
          detail: `messages[${mi}].content[${bi}] should not carry cache_control`,
        })
      }
    }
  }

  return failures
}

function pickTailMessageIndexes(messages: any[], maxCount: number): number[] {
  const out: number[] = []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = Array.isArray(messages[i]?.content) ? messages[i].content : []
    if (content.length === 0) continue
    out.push(i)
    if (out.length >= maxCount) break
  }
  return out
}

function renderConsoleSummary(args: {
  report: AlignmentReport
  fileResults: FileCheckResult[]
  reportPath: string
}): void {
  const { report, fileResults, reportPath } = args
  console.log('Cache-control alignment check completed')
  console.log(`- dir: ${report.targetDir}`)
  console.log(`- files: ${report.totalFiles}`)
  console.log(`- passed: ${report.passedFiles}`)
  console.log(`- failed: ${report.failedFiles}`)
  console.log(`- report: ${reportPath}`)

  const failed = fileResults.filter((entry) => !entry.ok)
  if (failed.length === 0) return

  console.log('- failed files:')
  for (const entry of failed) {
    console.log(`  - ${entry.file} (${entry.failureCount} issue${entry.failureCount > 1 ? 's' : ''})`)
  }
}

void main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`request:check:cache-control failed: ${msg}`)
  process.exit(1)
})
