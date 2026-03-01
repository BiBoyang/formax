import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const stdoutProxyCache = new WeakMap<NodeJS.WriteStream, NodeJS.WriteStream>()
let inkInstancesPromise: Promise<WeakMap<any, any> | null> | null = null

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
      return
    }
    const inkInstance = instances.get(safeStdout)
    if (!inkInstance || typeof inkInstance !== 'object') {
      return
    }

    if ('fullStaticOutput' in inkInstance) (inkInstance as any).fullStaticOutput = ''
    if ('lastOutput' in inkInstance) (inkInstance as any).lastOutput = ''
    if ('lastOutputHeight' in inkInstance) (inkInstance as any).lastOutputHeight = 0
  } catch {
    // Best-effort: avoid hard dependency on Ink internals.
  }
}
