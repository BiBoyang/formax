import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FileStore } from '../adapters/fs/fileStore.js'
import { deleteHookCommand, persistHookCommand } from './settingsStore.js'

type MemoryStore = FileStore & {
  writes: Array<{ filePath: string; value: unknown }>
}

function createMemoryStore(initial: Record<string, string> = {}): MemoryStore {
  const files = new Map<string, string>(Object.entries(initial))
  const writes: Array<{ filePath: string; value: unknown }> = []

  return {
    async exists(filePath) {
      return files.has(filePath)
    },
    async readText(filePath) {
      if (!files.has(filePath)) throw new Error(`ENOENT: ${filePath}`)
      return files.get(filePath)!
    },
    async writeTextAtomic() {},
    async writeJsonAtomic(filePath, value) {
      writes.push({ filePath, value })
      files.set(filePath, JSON.stringify(value))
    },
    writes,
  }
}

function getWrittenValue(store: MemoryStore): Record<string, unknown> {
  const entry = store.writes.at(-1)
  expect(entry).toBeTruthy()
  return entry!.value as Record<string, unknown>
}

describe('settingsStore', () => {
  it('adds a new command rule for matcher-aware events', async () => {
    const store = createMemoryStore()

    await persistHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: '  Bash  ',
      command: '  echo hi  ',
    })

    const out = getWrittenValue(store)
    const hooks = out.hooks as Record<string, unknown>
    const pre = hooks.PreToolUse as Array<Record<string, unknown>>
    expect(pre).toHaveLength(1)
    expect(pre[0].matcher).toBe('Bash')
    expect(pre[0].hooks).toEqual([{ type: 'command', command: 'echo hi' }])
  })

  it('does not duplicate existing command in same matcher bucket', async () => {
    const settingsPath = '/repo/.formax/settings.local.json'
    const store = createMemoryStore({
      [settingsPath]: JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }],
        },
      }),
    })

    await persistHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo hi',
    })

    expect(store.writes).toHaveLength(0)
  })

  it('forces matcher-less events to wildcard and strips matcher from saved rule', async () => {
    const settingsPath = '/repo/.formax/settings.local.json'
    const store = createMemoryStore({
      [settingsPath]: JSON.stringify({
        hooks: {
          Stop: [{ matcher: 'Bash', hooks: [] }],
        },
      }),
    })

    await persistHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'Stop',
      matcher: 'Bash',
      command: 'echo stop',
    })

    const out = getWrittenValue(store)
    const hooks = out.hooks as Record<string, unknown>
    const stopRules = hooks.Stop as Array<Record<string, unknown>>
    expect(stopRules).toHaveLength(1)
    expect('matcher' in stopRules[0]).toBe(false)
    expect(stopRules[0].hooks).toEqual([{ type: 'command', command: 'echo stop' }])
  })

  it('ignores empty command on persist', async () => {
    const store = createMemoryStore()
    await persistHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: '   ',
    })
    expect(store.writes).toHaveLength(0)
  })

  it('deletes one command and removes empty event rules', async () => {
    const settingsPath = '/repo/.formax/settings.local.json'
    const store = createMemoryStore({
      [settingsPath]: JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }],
        },
      }),
    })

    await deleteHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo hi',
    })

    const out = getWrittenValue(store)
    const hooks = out.hooks as Record<string, unknown>
    expect(hooks.PreToolUse).toBeUndefined()
  })

  it('keeps unrelated rules and malformed rows when deleting', async () => {
    const settingsPath = '/repo/.formax/settings.local.json'
    const store = createMemoryStore({
      [settingsPath]: JSON.stringify({
        hooks: {
          PreToolUse: [
            null,
            { matcher: 'Read', hooks: [{ type: 'command', command: 'echo keep' }] },
            {
              matcher: 'Bash',
              hooks: [{ type: 'read', command: 'echo skip' }, { type: 'command', command: 'echo remove' }],
            },
          ],
        },
      }),
    })

    await deleteHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo remove',
    })

    const out = getWrittenValue(store)
    const hooks = out.hooks as Record<string, unknown>
    const pre = hooks.PreToolUse as Array<any>
    expect(pre[0]).toBeNull()
    expect(pre[1].matcher).toBe('Read')
    expect(pre[2].hooks).toEqual([{ type: 'read', command: 'echo skip' }])
  })

  it('returns early on delete when command is blank or settings do not exist', async () => {
    const store = createMemoryStore()

    await deleteHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: '   ',
    })
    await deleteHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo missing',
    })

    expect(store.writes).toHaveLength(0)
  })

  it('falls back to empty settings when stored json is invalid or non-object', async () => {
    const settingsPath = '/repo/.formax/settings.local.json'
    const store = createMemoryStore({
      [settingsPath]: '[',
    })

    await persistHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo after-invalid',
    })

    const out = getWrittenValue(store)
    const hooks = out.hooks as Record<string, unknown>
    expect(hooks.PreToolUse).toBeTruthy()

    const storeArrayRoot = createMemoryStore({
      [settingsPath]: '[]',
    })
    await persistHookCommand({
      fileStore: storeArrayRoot,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo after-array',
    })
    expect(storeArrayRoot.writes).toHaveLength(1)

    const storeEmpty = createMemoryStore({
      [settingsPath]: '',
    })
    await persistHookCommand({
      fileStore: storeEmpty,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo after-empty',
    })
    expect(storeEmpty.writes).toHaveLength(1)
  })

  it('supports project and user source path resolution', async () => {
    const projectStore = createMemoryStore()
    await persistHookCommand({
      fileStore: projectStore,
      cwd: '/repo',
      source: 'project',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo project',
    })
    expect(projectStore.writes[0].filePath).toBe('/repo/.formax/settings.json')

    const home = '/tmp/formax-home'
    const userStore = createMemoryStore()
    await persistHookCommand({
      fileStore: userStore,
      cwd: '/repo',
      source: 'user',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo user',
      homedir: home,
      platform: 'darwin',
    })
    expect(userStore.writes[0].filePath).toBe(path.join(home, '.formax', 'settings.json'))
  })

  it('handles readText failure by treating settings as empty', async () => {
    const store: MemoryStore = {
      async exists() {
        return true
      },
      async readText() {
        throw new Error('read failed')
      },
      async writeTextAtomic() {},
      async writeJsonAtomic(filePath, value) {
        this.writes.push({ filePath, value })
      },
      writes: [],
    }

    await persistHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo recover',
    })

    expect(store.writes).toHaveLength(1)
  })

  it('skips malformed rules when finding matcher and repairs non-array hooks on persist', async () => {
    const settingsPath = '/repo/.formax/settings.local.json'
    const store = createMemoryStore({
      [settingsPath]: JSON.stringify({
        hooks: {
          PreToolUse: [null, { matcher: 'Bash', hooks: { bad: true } }],
        },
      }),
    })

    await persistHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo repaired',
    })

    const out = getWrittenValue(store)
    const rules = ((out.hooks as Record<string, unknown>).PreToolUse as Array<any>).filter(Boolean)
    expect(rules[0].hooks).toEqual([{ type: 'command', command: 'echo repaired' }])
  })

  it('ignores malformed and non-command hook entries when checking duplicates', async () => {
    const settingsPath = '/repo/.formax/settings.local.json'
    const store = createMemoryStore({
      [settingsPath]: JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [null, { type: 'read', command: 'echo read' }] }],
        },
      }),
    })

    await persistHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo add',
    })

    const out = getWrittenValue(store)
    const hooks = ((out.hooks as Record<string, unknown>).PreToolUse as Array<any>)[0].hooks
    expect(hooks).toEqual([null, { type: 'read', command: 'echo read' }, { type: 'command', command: 'echo add' }])
  })

  it('does not treat malformed rows as matcher matches when matcher is empty', async () => {
    const settingsPath = '/repo/.formax/settings.local.json'
    const store = createMemoryStore({
      [settingsPath]: JSON.stringify({
        hooks: {
          PreToolUse: [null],
        },
      }),
    })

    await persistHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: '   ',
      command: 'echo safe',
    })

    const out = getWrittenValue(store)
    const rules = (out.hooks as Record<string, unknown>).PreToolUse as Array<any>
    expect(rules).toHaveLength(2)
    expect(rules[1]).toEqual({
      matcher: '',
      hooks: [{ type: 'command', command: 'echo safe' }],
    })
  })

  it('normalizes nullish matcher/command fields from malformed settings', async () => {
    const settingsPath = '/repo/.formax/settings.local.json'
    const store = createMemoryStore({
      [settingsPath]: JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [{ type: 'command' }],
            },
          ],
        },
      }),
    })

    await persistHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: '',
      command: 'echo fixed',
    })

    const out = getWrittenValue(store)
    const rules = (out.hooks as Record<string, unknown>).PreToolUse as Array<any>
    expect(rules[0].hooks).toEqual([{ type: 'command' }, { type: 'command', command: 'echo fixed' }])
  })

  it('keeps malformed hook entries when deleting a command', async () => {
    const settingsPath = '/repo/.formax/settings.local.json'
    const store = createMemoryStore({
      [settingsPath]: JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [null, [], { type: 'command', command: 'echo remove' }],
            },
          ],
        },
      }),
    })

    await deleteHookCommand({
      fileStore: store,
      cwd: '/repo',
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo remove',
    })

    const out = getWrittenValue(store)
    const rules = (out.hooks as Record<string, unknown>).PreToolUse as Array<any>
    expect(rules[0].hooks).toEqual([null, []])
  })

  it('uses default node file store when fileStore is omitted', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-settings-store-'))
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')
    const localSettings = path.join(project, '.formax', 'settings.local.json')

    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    await persistHookCommand({
      cwd,
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo real',
    })

    const text = await fs.readFile(localSettings, 'utf8')
    expect(text).toContain('echo real')

    await deleteHookCommand({
      cwd,
      source: 'projectLocal',
      eventName: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo real',
    })

    const textAfterDelete = await fs.readFile(localSettings, 'utf8')
    expect(textAfterDelete).toContain('"hooks"')
  })

  it('uses process.cwd() fallback when persist cwd is empty', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-settings-store-cwd-'))
    const project = path.join(tmp, 'project')
    const localSettings = path.join(project, '.formax', 'settings.local.json')
    const prevCwd = process.cwd()

    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })

    try {
      process.chdir(project)
      await persistHookCommand({
        cwd: '',
        source: 'projectLocal',
        eventName: 'PreToolUse',
        matcher: 'Bash',
        command: 'echo cwd-fallback',
      })
    } finally {
      process.chdir(prevCwd)
    }

    const text = await fs.readFile(localSettings, 'utf8')
    expect(text).toContain('echo cwd-fallback')
  })

  it('supports matcher-less delete with cwd fallback and non-array hooks shape', async () => {
    const writes: Array<{ filePath: string; value: unknown }> = []
    const store: FileStore = {
      async exists() {
        return true
      },
      async readText() {
        return JSON.stringify({
          hooks: {
            Stop: [{ matcher: 'ignored', hooks: { bad: true } }],
          },
        })
      },
      async writeTextAtomic() {},
      async writeJsonAtomic(filePath, value) {
        writes.push({ filePath, value })
      },
    }

    await deleteHookCommand({
      fileStore: store,
      cwd: '',
      source: 'projectLocal',
      eventName: 'Stop',
      matcher: 'Bash',
      command: 'echo stop',
    })

    expect(writes).toHaveLength(1)
    const out = writes[0].value as Record<string, unknown>
    expect((out.hooks as Record<string, unknown>).Stop).toBeUndefined()
  })
})
