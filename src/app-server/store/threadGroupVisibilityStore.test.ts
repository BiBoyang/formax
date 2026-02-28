import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileThreadGroupVisibilityStore } from './threadGroupVisibilityStore.js'

const STATE_FILE = path.join('web-reference-react', 'thread-group-visibility.json')

function envWithConfigDir(configDir: string): NodeJS.ProcessEnv {
  return { ...process.env, FORMAX_CONFIG_DIR: configDir }
}

describe('FileThreadGroupVisibilityStore', () => {
  it('returns empty hidden groups when state file does not exist', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tgv-empty-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tgv-empty-config-'))
    const store = new FileThreadGroupVisibilityStore()

    const hidden = await store.listHiddenGroups({
      cwd,
      env: envWithConfigDir(configDir),
    })

    expect(hidden).toEqual([])
  })

  it('marks group hidden with normalization, dedupe, and sorted output', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tgv-mark-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tgv-mark-config-'))
    const store = new FileThreadGroupVisibilityStore()
    const env = envWithConfigDir(configDir)

    const first = await store.markGroupHidden({
      cwd,
      env,
      groupCwd: path.join(cwd, 'b', '..', 'b'),
    })
    expect(first).toEqual([path.join(cwd, 'b')])

    const second = await store.markGroupHidden({
      cwd,
      env,
      groupCwd: path.join(cwd, 'a'),
    })
    expect(second).toEqual([path.join(cwd, 'a'), path.join(cwd, 'b')])

    const third = await store.markGroupHidden({
      cwd,
      env,
      groupCwd: path.join(cwd, 'a'),
    })
    expect(third).toEqual([path.join(cwd, 'a'), path.join(cwd, 'b')])

    const persistedPath = path.join(configDir, STATE_FILE)
    const persisted = JSON.parse(await fs.readFile(persistedPath, 'utf8')) as {
      version: number
      hiddenGroupCwds: string[]
      updatedAt: string
    }
    expect(persisted.version).toBe(1)
    expect(persisted.hiddenGroupCwds).toEqual([path.join(cwd, 'a'), path.join(cwd, 'b')])
    expect(typeof persisted.updatedAt).toBe('string')
    expect(persisted.updatedAt.length).toBeGreaterThan(0)
  })

  it('recovers from malformed persisted content and filters invalid rows', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tgv-read-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tgv-read-config-'))
    const store = new FileThreadGroupVisibilityStore()
    const env = envWithConfigDir(configDir)
    const persistedPath = path.join(configDir, STATE_FILE)
    await fs.mkdir(path.dirname(persistedPath), { recursive: true })

    await fs.writeFile(persistedPath, '{bad-json', 'utf8')
    expect(await store.listHiddenGroups({ cwd, env })).toEqual([])

    await fs.writeFile(persistedPath, JSON.stringify('not-object'), 'utf8')
    expect(await store.listHiddenGroups({ cwd, env })).toEqual([])

    await fs.writeFile(
      persistedPath,
      JSON.stringify({
        version: 1,
        hiddenGroupCwds: ['  ', 1, path.join(cwd, 'x'), path.join(cwd, 'x'), path.join(cwd, 'y')],
        updatedAt: '   ',
      }),
      'utf8',
    )
    expect(await store.listHiddenGroups({ cwd, env })).toEqual([path.join(cwd, 'x'), path.join(cwd, 'y')])

    await fs.writeFile(
      persistedPath,
      JSON.stringify({
        version: 1,
        hiddenGroupCwds: 'not-array',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      'utf8',
    )
    expect(await store.listHiddenGroups({ cwd, env })).toEqual([])
  })

  it('supports omitted env by falling back to process.env', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tgv-default-env-cwd-'))
    const store = new FileThreadGroupVisibilityStore()
    const hidden = await store.listHiddenGroups({ cwd })
    expect(Array.isArray(hidden)).toBe(true)
  })
})
