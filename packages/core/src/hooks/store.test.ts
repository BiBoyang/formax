import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FileStore } from '../adapters/fs/fileStore.js'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore.js'
import { loadHooksBySource, loadMergedHooks } from './store.js'

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8')
}

describe('loadMergedHooks', () => {
  it('loads hooks from projectLocal, project, user and dedupes by command', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    await writeJson(path.join(home, '.formax', 'settings.json'), {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: 'echo user-1', timeout: 1 },
              { type: 'command', command: 'echo shared', timeoutMs: 5000 },
            ],
          },
        ],
      },
    })

    await writeJson(path.join(project, '.formax', 'settings.json'), {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: 'echo project-1' },
              { type: 'command', command: 'echo shared' }, // should be deduped (project beats user)
            ],
          },
        ],
      },
    })

    await writeJson(path.join(project, '.formax', 'settings.local.json'), {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: 'echo local-1' },
              { type: 'command', command: 'echo project-1' }, // should be deduped (local beats project)
            ],
          },
        ],
      },
    })

    const fileStore = createNodeFileStore()
    const merged = await loadMergedHooks({ fileStore, cwd, homedir: home, platform: 'darwin' })

    const commands = merged.PreToolUse.map((e) => e.command)
    expect(commands).toEqual(['echo local-1', 'echo project-1', 'echo shared', 'echo user-1'])

    const timeoutByCommand = new Map(merged.PreToolUse.map((e) => [e.command, e.timeoutMs]))
    expect(timeoutByCommand.get('echo user-1')).toBe(1000)
    expect(timeoutByCommand.get('echo shared')).toBe(5000)
  })

  it('ignores hook rules with blank matcher and records a warning', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    await writeJson(path.join(project, '.formax', 'settings.local.json'), {
      hooks: {
        PreToolUse: [
          {
            // Invalid: blank matcher should be ignored (use "*" explicitly).
            matcher: '',
            hooks: [{ type: 'command', command: 'echo should-not-load' }],
          },
          {
            matcher: '*',
            hooks: [{ type: 'command', command: 'echo ok' }],
          },
        ],
      },
    })

    const fileStore = createNodeFileStore()
    const merged = await loadMergedHooks({ fileStore, cwd, homedir: home, platform: 'darwin' })

    expect(merged.PreToolUse.map((e) => e.command)).toEqual(['echo ok'])
    expect(merged.warnings.join('\n')).toContain('empty matcher')
  })

  it('includes explicit "*" matchers in matchersBySource (even when hooks are empty)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    await writeJson(path.join(project, '.formax', 'settings.local.json'), {
      hooks: {
        PreToolUse: [
          { matcher: '', hooks: [] }, // ignored
          { matcher: '*', hooks: [] }, // should still appear as selectable matcher
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo ok' }] },
        ],
      },
    })

    const fileStore = createNodeFileStore()
    const bySource = await loadHooksBySource({ fileStore, cwd, homedir: home, platform: 'darwin' })

    const matchers = (bySource.matchersBySource.projectLocal.PreToolUse ?? []).map((m) => m.matcher)
    expect(matchers).toContain('*')
    expect(matchers).toContain('Bash')
    expect(matchers).not.toContain('')
  })

  it('treats missing matcher as "*" for matcher-less events (UserPromptSubmit)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    await writeJson(path.join(project, '.formax', 'settings.local.json'), {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [{ type: 'command', command: 'echo ok' }],
          },
        ],
      },
    })

    const fileStore = createNodeFileStore()
    const merged = await loadMergedHooks({ fileStore, cwd, homedir: home, platform: 'darwin' })

    expect(merged.UserPromptSubmit.map((e) => e.command)).toEqual(['echo ok'])

    const bySource = await loadHooksBySource({ fileStore, cwd, homedir: home, platform: 'darwin' })
    const matchers = (bySource.matchersBySource.projectLocal.UserPromptSubmit ?? []).map((m) => m.matcher)
    expect(matchers).toEqual(['*'])
  })

  it('supports implicit wildcard matcher for SessionStart', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    await writeJson(path.join(project, '.formax', 'settings.local.json'), {
      hooks: {
        SessionStart: [
          {
            hooks: [{ type: 'command', command: 'echo ok' }],
          },
        ],
      },
    })

    const fileStore = createNodeFileStore()
    const merged = await loadMergedHooks({ fileStore, cwd, homedir: home, platform: 'darwin' })

    expect(merged.SessionStart.map((e) => e.command)).toEqual(['echo ok'])

    const bySource = await loadHooksBySource({ fileStore, cwd, homedir: home, platform: 'darwin' })
    const matchers = (bySource.matchersBySource.projectLocal.SessionStart ?? []).map((m) => m.matcher)
    expect(matchers).toEqual(['*'])
  })

  it('normalizes SessionStart matcher values consistently in merged hooks and matcher summaries', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    await writeJson(path.join(project, '.formax', 'settings.local.json'), {
      hooks: {
        SessionStart: [
          {
            matcher: 'CLEAR',
            hooks: [{ type: 'command', command: 'echo clear-hook' }],
          },
          {
            matcher: 'NotSupported',
            hooks: [{ type: 'command', command: 'echo fallback' }],
          },
        ],
      },
    })

    const fileStore = createNodeFileStore()
    const merged = await loadMergedHooks({ fileStore, cwd, homedir: home, platform: 'darwin' })
    expect(merged.SessionStart.map((entry) => entry.matcher)).toEqual(['clear', '*'])

    const bySource = await loadHooksBySource({ fileStore, cwd, homedir: home, platform: 'darwin' })
    expect(bySource.matchersBySource.projectLocal.SessionStart.map((entry) => entry.matcher)).toEqual(['clear', '*'])
  })

  it('treats missing matcher as "*" for matcher-less events (Stop)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    await writeJson(path.join(project, '.formax', 'settings.local.json'), {
      hooks: {
        Stop: [
          {
            hooks: [{ type: 'command', command: 'echo ok' }],
          },
        ],
      },
    })

    const fileStore = createNodeFileStore()
    const merged = await loadMergedHooks({ fileStore, cwd, homedir: home, platform: 'darwin' })

    expect(merged.Stop.map((e) => e.command)).toEqual(['echo ok'])

    const bySource = await loadHooksBySource({ fileStore, cwd, homedir: home, platform: 'darwin' })
    const matchers = (bySource.matchersBySource.projectLocal.Stop ?? []).map((m) => m.matcher)
    expect(matchers).toEqual(['*'])
  })

  it('warns and normalizes non-wildcard matcher for matcher-less events', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    await writeJson(path.join(project, '.formax', 'settings.local.json'), {
      hooks: {
        Stop: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo ok' }],
          },
        ],
      },
    })

    const merged = await loadMergedHooks({ fileStore: createNodeFileStore(), cwd, homedir: home, platform: 'darwin' })
    expect(merged.Stop.map((entry) => entry.matcher)).toEqual(['*'])
    expect(merged.warnings.join('\n')).toContain('Ignoring matcher "Bash" for projectLocal Stop hook rule')
  })

  it('adds warning when settings json is invalid and treats hooks as empty', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    const mockFileStore: FileStore = {
      async exists(filePath) {
        return filePath.endsWith(path.join('.formax', 'settings.local.json'))
      },
      async readText() {
        return '{'
      },
      async writeTextAtomic() {},
      async writeJsonAtomic() {},
    }

    const bySource = await loadHooksBySource({ fileStore: mockFileStore, cwd, homedir: home, platform: 'darwin' })
    expect(bySource.projectLocal.PreToolUse).toEqual([])
    expect(bySource.warnings.join('\n')).toContain('Invalid JSON in projectLocal settings')
  })

  it('adds warning when settings read fails with non-error value', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    const mockFileStore: FileStore = {
      async exists(filePath) {
        return filePath.endsWith(path.join('.formax', 'settings.local.json'))
      },
      async readText() {
        throw 'boom'
      },
      async writeTextAtomic() {},
      async writeJsonAtomic() {},
    }

    const bySource = await loadHooksBySource({ fileStore: mockFileStore, cwd, homedir: home, platform: 'darwin' })
    expect(bySource.projectLocal.PreToolUse).toEqual([])
    expect(bySource.warnings.join('\n')).toContain('Failed to read projectLocal settings')
    expect(bySource.warnings.join('\n')).toContain('boom')
  })

  it('counts duplicate matcher only once and handles non-array hooks in matcher summary', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    await writeJson(path.join(project, '.formax', 'settings.local.json'), {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo first' }] },
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo second' }] },
          { matcher: 'Read', hooks: { type: 'command', command: 'echo ignored-shape' } },
        ],
      },
    })

    const bySource = await loadHooksBySource({ fileStore: createNodeFileStore(), cwd, homedir: home, platform: 'darwin' })
    expect(bySource.matchersBySource.projectLocal.PreToolUse).toEqual([
      { source: 'projectLocal', matcher: 'Bash', hooksCount: 1 },
      { source: 'projectLocal', matcher: 'Read', hooksCount: 0 },
    ])
  })

  it('uses default fileStore and falls back to process.cwd when cwd is empty', async () => {
    const bySource = await loadHooksBySource({ cwd: '' })
    expect(bySource.projectLocal.PreToolUse).toEqual(expect.any(Array))
    expect(bySource.project.PreToolUse).toEqual(expect.any(Array))
    expect(bySource.user.PreToolUse).toEqual(expect.any(Array))
  })

  it('adds warning when settings read fails with Error instance', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    const mockFileStore: FileStore = {
      async exists(filePath) {
        return filePath.endsWith(path.join('.formax', 'settings.local.json'))
      },
      async readText() {
        throw new Error('read failed')
      },
      async writeTextAtomic() {},
      async writeJsonAtomic() {},
    }

    const bySource = await loadHooksBySource({ fileStore: mockFileStore, cwd, homedir: home, platform: 'darwin' })
    expect(bySource.projectLocal.PreToolUse).toEqual([])
    expect(bySource.warnings.join('\n')).toContain('Failed to read projectLocal settings')
    expect(bySource.warnings.join('\n')).toContain('read failed')
  })

  it('treats empty settings file as invalid json record', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    const mockFileStore: FileStore = {
      async exists(filePath) {
        return filePath.endsWith(path.join('.formax', 'settings.local.json'))
      },
      async readText() {
        return ''
      },
      async writeTextAtomic() {},
      async writeJsonAtomic() {},
    }

    const bySource = await loadHooksBySource({ fileStore: mockFileStore, cwd, homedir: home, platform: 'darwin' })
    expect(bySource.warnings.join('\n')).toContain('Invalid JSON in projectLocal settings')
  })

  it('treats non-object json payload as invalid hooks settings', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    const mockFileStore: FileStore = {
      async exists(filePath) {
        return filePath.endsWith(path.join('.formax', 'settings.local.json'))
      },
      async readText() {
        return '[]'
      },
      async writeTextAtomic() {},
      async writeJsonAtomic() {},
    }

    const bySource = await loadHooksBySource({ fileStore: mockFileStore, cwd, homedir: home, platform: 'darwin' })
    expect(bySource.warnings.join('\n')).toContain('Invalid JSON in projectLocal settings')
  })

  it('ignores non-object hooks roots and malformed rule/hook entries', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-store-'))
    const home = path.join(tmp, 'home')
    const project = path.join(tmp, 'project')
    const cwd = path.join(project, 'src')

    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(project, '.git'), { recursive: true })
    await fs.mkdir(path.join(project, '.formax'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })

    await writeJson(path.join(project, '.formax', 'settings.local.json'), {
      hooks: {
        PreToolUse: [
          null,
          [],
          {
            matcher: 'Bash',
            hooks: [
              null,
              [],
              { type: 'read', command: 'echo skip-type' },
              { type: 'command', command: 123 },
              { type: 'command', command: '   ' },
              { type: 'command', command: 'echo ok' },
            ],
          },
        ],
      },
    })
    await writeJson(path.join(project, '.formax', 'settings.json'), {
      hooks: [],
    })

    const bySource = await loadHooksBySource({ fileStore: createNodeFileStore(), cwd, homedir: home, platform: 'darwin' })
    expect(bySource.projectLocal.PreToolUse.map((entry) => entry.command)).toEqual(['echo ok'])
    expect(bySource.project.PreToolUse).toEqual([])
    expect(bySource.matchersBySource.project.PreToolUse).toEqual([])
  })
})
