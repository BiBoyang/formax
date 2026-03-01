import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createCommandStore } from './CommandStore'

async function writeFileEnsuringDir(filePath: string, content: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

describe('CommandStore', () => {
  it('loads commands from .formax/commands and maps nested paths to /dir:cmd', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      await writeFileEnsuringDir(
        path.join(cwd, '.formax', 'commands', 'dir', 'hello.md'),
        'Say hello\n',
      )

      const store = createCommandStore({ cwd, globalConfigDir: cwd })
      const ids = store.list().map((c) => c.id)
      expect(ids).toContain('/dir:hello')
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('project overrides user when ids conflict', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      await writeFileEnsuringDir(
        path.join(cwd, 'commands', 'hello.md'),
        'User says hello\n',
      )
      await writeFileEnsuringDir(
        path.join(cwd, '.formax', 'commands', 'hello.md'),
        'Project says hello\n',
      )

      const store = createCommandStore({ cwd, globalConfigDir: cwd })
      expect(store.get('/hello')?.body).toContain('Project says hello')
      const all = store.listAll().filter((c) => c.id === '/hello')
      expect(all.map((c) => c.scope).sort()).toEqual(['project', 'user'])
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('reads description from frontmatter when present', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      await writeFileEnsuringDir(
        path.join(cwd, '.formax', 'commands', 'hello.md'),
        `---\ndescription: Hello desc\n---\n\nSay hello\n`,
      )

      const store = createCommandStore({ cwd, globalConfigDir: cwd })
      expect(store.get('/hello')?.description).toBe('Hello desc')
      expect(store.get('/hello')?.hasDescriptionFrontmatter).toBe(true)
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })
})
