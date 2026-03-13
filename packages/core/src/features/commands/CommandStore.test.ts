import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
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

  it('parses argument-hint/disable-model-invocation and normalizes get(id)', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      await writeFileEnsuringDir(
        path.join(cwd, '.formax', 'commands', 'run.md'),
        `---
argument-hint: <task>
disable-model-invocation: yes
---

Run something
`,
      )

      const store = createCommandStore({ cwd, globalConfigDir: cwd })
      const bySlash = store.get('/run')
      const byBare = store.get('run')
      expect(bySlash?.argumentHint).toBe('<task>')
      expect(bySlash?.disableModelInvocation).toBe(true)
      expect(byBare?.id).toBe('/run')
      expect(store.get('   ')).toBeUndefined()
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('skips invalid command files and handles non-directory command roots', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      // user commands root exists but is not a directory
      await writeFileEnsuringDir(path.join(cwd, 'commands'), 'not-a-dir')
      // empty body should be skipped
      await writeFileEnsuringDir(path.join(cwd, '.formax', 'commands', 'empty.md'), '   \n')
      // invalid id segment should be skipped
      await writeFileEnsuringDir(path.join(cwd, '.formax', 'commands', '-bad.md'), 'Bad\n')
      // empty segment id (".md") should be skipped
      await writeFileEnsuringDir(path.join(cwd, '.formax', 'commands', '.md'), 'Dot\n')
      // fallback description should use default when first meaningful line is empty after cleanup
      await writeFileEnsuringDir(path.join(cwd, '.formax', 'commands', 'fallback.md'), '#\nBody\n')
      // non-markdown file should be ignored
      await writeFileEnsuringDir(path.join(cwd, '.formax', 'commands', 'ignored.txt'), 'Ignored\n')
      // non-file dirent should be ignored
      await fsp.mkdir(path.join(cwd, '.formax', 'commands', 'nested-dir'), { recursive: true })
      // valid fallback description from first body line
      await writeFileEnsuringDir(path.join(cwd, '.formax', 'commands', 'ok.md'), 'First line\nSecond line\n')

      const store = createCommandStore({ cwd, globalConfigDir: cwd })
      const list = store.list()
      expect(list.map((c) => c.id)).toEqual(['/fallback', '/ok'])
      expect(list.find((c) => c.id === '/fallback')?.description).toBe('Custom command')
      expect(list.find((c) => c.id === '/ok')?.description).toBe('First line')
      expect(list.find((c) => c.id === '/ok')?.hasDescriptionFrontmatter).toBe(false)
      expect(store.listAll().map((c) => c.scope)).toEqual(['project', 'project'])
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('gracefully handles fs throws during scan/walk/read', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    const globalConfigDir = path.join(cwd, 'global')
    await fsp.mkdir(path.join(cwd, '.formax', 'commands'), { recursive: true })
    await fsp.mkdir(path.join(globalConfigDir, 'commands'), { recursive: true })
    await writeFileEnsuringDir(path.join(cwd, '.formax', 'commands', 'ok.md'), 'desc\nbody\n')

    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => {
      if (String(p).includes(`${path.sep}global${path.sep}commands`)) throw new Error('exists boom')
      return true
    })
    const readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementation((p: any, opts?: any) => {
      if (String(p).endsWith(`${path.sep}.formax${path.sep}commands`)) throw new Error('walk boom')
      return [] as any
    })
    try {
      const store = createCommandStore({ cwd, globalConfigDir })
      expect(store.list()).toEqual([])
      expect(store.get('/ok')).toBeUndefined()
    } finally {
      existsSpy.mockRestore()
      readdirSpy.mockRestore()
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('skips file when readFileSync throws', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      const filePath = path.join(cwd, '.formax', 'commands', 'boom.md')
      await writeFileEnsuringDir(filePath, 'Boom\n')

      const originalReadFileSync = fs.readFileSync
      const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((p: any, enc?: any) => {
        if (String(p).endsWith(`${path.sep}boom.md`)) throw new Error('read boom')
        return originalReadFileSync(p, enc as any)
      })
      try {
        const store = createCommandStore({ cwd, globalConfigDir: cwd })
        expect(store.get('/boom')).toBeUndefined()
      } finally {
        readSpy.mockRestore()
      }
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('ignores markdown entries that resolve outside baseDir', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      const root = path.join(cwd, '.formax', 'commands')
      await fsp.mkdir(root, { recursive: true })
      await writeFileEnsuringDir(path.join(cwd, '.formax', 'outside.md'), 'Outside\n')

      const originalReaddirSync = fs.readdirSync
      const readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementation((p: any, opts?: any) => {
        if (String(p).endsWith(`${path.sep}.formax${path.sep}commands`)) {
          return [
            {
              name: '..' + path.sep + 'outside.md',
              isDirectory: () => false,
              isFile: () => true,
            },
          ] as any
        }
        return originalReaddirSync(p, opts as any) as any
      })
      try {
        const store = createCommandStore({ cwd, globalConfigDir: cwd })
        expect(store.list()).toEqual([])
      } finally {
        readdirSpy.mockRestore()
      }
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('treats nullish command id as empty in get()', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      const store = createCommandStore({ cwd, globalConfigDir: cwd })
      expect(store.get(undefined as any)).toBeUndefined()
      expect(store.get(null as any)).toBeUndefined()
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })

  it('ignores non-file markdown dirents', async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-commands-'))
    try {
      await fsp.mkdir(path.join(cwd, '.formax', 'commands'), { recursive: true })
      const originalReaddirSync = fs.readdirSync
      const readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementation((p: any, opts?: any) => {
        if (String(p).endsWith(`${path.sep}.formax${path.sep}commands`)) {
          return [
            {
              name: 'odd.md',
              isDirectory: () => false,
              isFile: () => false,
            },
          ] as any
        }
        return originalReaddirSync(p, opts as any) as any
      })
      try {
        const store = createCommandStore({ cwd, globalConfigDir: cwd })
        expect(store.list()).toEqual([])
      } finally {
        readdirSpy.mockRestore()
      }
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true })
    }
  })
})
