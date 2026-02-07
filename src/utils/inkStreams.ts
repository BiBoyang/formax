import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const stdoutProxyCache = new WeakMap<NodeJS.WriteStream, NodeJS.WriteStream>()
const surfaceDebugEnabled = process.env.FORMAX_SURFACE_DEBUG === '1'
let inkInstancesPromise: Promise<WeakMap<any, any> | null> | null = null

function appendSurfaceDebug(line: string): void {
  if (!surfaceDebugEnabled) return
  try {
    const file = path.resolve(process.cwd(), '.tmp/surface-owner.log')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // Ignore debug logging failures.
  }
}

export function createSafeInkStdout<T extends NodeJS.WriteStream>(stdout: T): T {
  if (!stdout.isTTY) return stdout

  const cached = stdoutProxyCache.get(stdout)
  if (cached) return cached as T

  const proxy = new Proxy(stdout, {
    get(target, prop, receiver) {
      if (prop === 'columns') {
        const cols = (target as any).columns
        return typeof cols === 'number' && cols > 0 ? cols : 80
      }
      if (prop === 'rows') {
        const rows = (target as any).rows
        return typeof rows === 'number' && rows > 0 ? rows : 24
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as T

  stdoutProxyCache.set(stdout, proxy)
  return proxy
}

async function loadInkInstancesMap(): Promise<WeakMap<any, any> | null> {
  if (inkInstancesPromise) return inkInstancesPromise

  inkInstancesPromise = (async () => {
    try {
      const require = createRequire(import.meta.url)
      const inkEntryPath = require.resolve('ink')
      const instancesPath = path.join(path.dirname(inkEntryPath), 'instances.js')
      const instancesMod = (await import(pathToFileURL(instancesPath).href)) as {
        default?: WeakMap<any, any>
      }
      return instancesMod.default ?? null
    } catch (error) {
      appendSurfaceDebug(`resetInkStaticOutput:instances-load-failed:${String((error as any)?.code ?? 'unknown')}`)
      return null
    }
  })()

  return inkInstancesPromise
}

export async function resetInkStaticOutputForStdout(stdout: NodeJS.WriteStream): Promise<void> {
  // Ink maintains `fullStaticOutput` internally and can replay it when the last output height
  // exceeded terminal rows. When we clear the terminal surface, we want a true reset.
  try {
    const safeStdout = createSafeInkStdout(stdout)
    const instances = await loadInkInstancesMap()
    if (!instances) {
      appendSurfaceDebug('resetInkStaticOutput:instances-missing')
      return
    }
    const inkInstance = instances.get(safeStdout)
    if (!inkInstance || typeof inkInstance !== 'object') {
      appendSurfaceDebug('resetInkStaticOutput:instance-missing')
      return
    }

    appendSurfaceDebug(
      `resetInkStaticOutput:found fullStaticLen=${String((inkInstance as any).fullStaticOutput?.length ?? 0)} ` +
        `lastOutputHeight=${String((inkInstance as any).lastOutputHeight ?? 'na')}`,
    )

    if ('fullStaticOutput' in inkInstance) (inkInstance as any).fullStaticOutput = ''
    if ('lastOutput' in inkInstance) (inkInstance as any).lastOutput = ''
    if ('lastOutputHeight' in inkInstance) (inkInstance as any).lastOutputHeight = 0
    appendSurfaceDebug('resetInkStaticOutput:cleared')
  } catch {
    // Best-effort: avoid hard dependency on Ink internals.
  }
}
