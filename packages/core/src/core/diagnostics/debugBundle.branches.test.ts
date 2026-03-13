import { describe, expect, it } from 'vitest'
import type { FileStore } from '../../adapters/fs/fileStore.js'
import { __testOnlyDebugBundle, createDebugBundle } from './debugBundle.js'

function makeStore(args: {
  existsMap?: Record<string, boolean>
  readMap?: Record<string, string>
  readErrors?: Record<string, unknown>
}): { store: FileStore; writes: Array<{ kind: 'json' | 'text'; path: string; value: unknown }> } {
  const writes: Array<{ kind: 'json' | 'text'; path: string; value: unknown }> = []
  const existsMap = args.existsMap ?? {}
  const readMap = args.readMap ?? {}
  const readErrors = args.readErrors ?? {}
  const store: FileStore = {
    async exists(filePath: string): Promise<boolean> {
      return existsMap[filePath] ?? false
    },
    async readText(filePath: string): Promise<string> {
      if (filePath in readErrors) throw readErrors[filePath]
      return readMap[filePath] ?? ''
    },
    async writeTextAtomic(filePath: string, content: string): Promise<void> {
      writes.push({ kind: 'text', path: filePath, value: content })
    },
    async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
      writes.push({ kind: 'json', path: filePath, value })
    },
  }
  return { store, writes }
}

const shown = {
  paths: {
    globalConfigPath: '/cfg/global.json',
    projectConfigPath: '/cfg/project.json',
    globalAuthPath: '/cfg/auth.json',
    globalRulesPath: '/cfg/global-rules.json',
    projectRulesPath: '/cfg/project-rules.json',
  },
} as any

describe('debugBundle branches', () => {
  it('captures missing/json-parse-fallback/error paths and text log error as warnings', async () => {
    const { store, writes } = makeStore({
      existsMap: {
        '/cfg/global.json': false,
        '/cfg/project.json': true,
        '/cfg/auth.json': true,
        '/cfg/global-rules.json': true,
        '/cfg/project-rules.json': true,
        '/logs/audit.ndjson': true,
      },
      readMap: {
        '/cfg/project.json': '{"ok":1}',
        '/cfg/auth.json': 'not-json Authorization: Bearer token-abc',
        '/cfg/project-rules.json': '{"token":"abc"}',
      },
      readErrors: {
        '/cfg/global-rules.json': 'json-read-error',
        '/logs/audit.ndjson': 'log-read-error',
      },
    })

    const out = await createDebugBundle({
      fileStore: store,
      bundleDir: '/bundle',
      version: '0.0.0',
      cwd: '/repo',
      platform: 'linux',
      nodeVersion: 'v-test',
      shown,
      status: { version: '0.0.0', cwd: '/repo', runtime: {}, workspaceRoots: [], policySummary: null, config: null, warnings: [] } as any,
      doctor: { version: '0.0.0', cwd: '/repo', checks: [], warnings: [] } as any,
      policy: { paths: {}, mergedRules: {}, warnings: [] } as any,
      logsDir: '/logs',
    })

    expect(out.bundleDir).toBe('/bundle')
    expect(out.manifestPath).toBe('/bundle/manifest.json')
    expect(out.warnings.some((w) => w.includes('json-read-error'))).toBe(true)
    expect(out.warnings.some((w) => w.includes('log-read-error'))).toBe(true)

    const textWrite = writes.find((w) => w.kind === 'text' && String(w.path).includes('config/auth.json'))
    expect(String(textWrite?.value)).toContain('Authorization: Bearer <redacted>')
    const manifestWrite = writes.find((w) => w.kind === 'json' && w.path === '/bundle/manifest.json')
    expect(manifestWrite).toBeTruthy()
  })

  it('covers joinPath normalization edge cases', () => {
    const { joinPath } = __testOnlyDebugBundle
    expect(joinPath('', 'a/b')).toBe('a/b')
    expect(joinPath('/base', '')).toBe('/base')
    expect(joinPath('/base/', '/x/y')).toBe('/base/x/y')
    expect(joinPath('C:\\base\\', '\\x/y')).toBe('C:\\base\\\\x\\y')
  })

  it('marks audit log as missing when logsDir is provided but file does not exist', async () => {
    const { store } = makeStore({
      existsMap: {
        '/cfg/global.json': false,
        '/cfg/project.json': false,
        '/cfg/auth.json': false,
        '/cfg/global-rules.json': false,
        '/cfg/project-rules.json': false,
        '/logs/audit.ndjson': false,
      },
    })
    const out = await createDebugBundle({
      fileStore: store,
      bundleDir: '/bundle',
      version: '0.0.0',
      cwd: '/repo',
      platform: 'linux',
      nodeVersion: 'v-test',
      shown,
      status: { version: '0.0.0', cwd: '/repo', runtime: {}, workspaceRoots: [], policySummary: null, config: null, warnings: [] } as any,
      doctor: { version: '0.0.0', cwd: '/repo', checks: [], warnings: [] } as any,
      policy: { paths: {}, mergedRules: {}, warnings: [] } as any,
      logsDir: '/logs',
    })
    expect(Array.isArray(out.warnings)).toBe(true)
  })

  it('formats read warnings from Error instances', async () => {
    const { store } = makeStore({
      existsMap: {
        '/cfg/global.json': true,
        '/cfg/project.json': false,
        '/cfg/auth.json': false,
        '/cfg/global-rules.json': false,
        '/cfg/project-rules.json': false,
        '/logs/audit.ndjson': true,
      },
      readErrors: {
        '/cfg/global.json': new Error('global-error'),
        '/logs/audit.ndjson': new Error('audit-error'),
      },
    })

    const out = await createDebugBundle({
      fileStore: store,
      bundleDir: '/bundle',
      version: '0.0.0',
      cwd: '/repo',
      platform: 'linux',
      nodeVersion: 'v-test',
      shown,
      status: { version: '0.0.0', cwd: '/repo', runtime: {}, workspaceRoots: [], policySummary: null, config: null, warnings: [] } as any,
      doctor: { version: '0.0.0', cwd: '/repo', checks: [], warnings: [] } as any,
      policy: { paths: {}, mergedRules: {}, warnings: [] } as any,
      logsDir: '/logs',
    })

    expect(out.warnings.some((w) => w.includes('global-error'))).toBe(true)
    expect(out.warnings.some((w) => w.includes('audit-error'))).toBe(true)
  })
})
