import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
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
})
