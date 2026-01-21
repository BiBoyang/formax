import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore.js'
import { loadMergedHooks } from './store.js'

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
})

