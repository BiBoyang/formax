import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createSlashCommandToolModule } from './index.js'
import { getConfigPaths } from '../../../adapters/fs/configPaths.js'
import { createCommandStore } from '../../../commands/CommandStore.js'
import { parseMarkdownFrontmatter } from '../../../shared/frontmatter.js'

async function withTempRepo<T>(fn: (args: { root: string; globalConfigDir: string }) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-slashcmd-'))
  const root = path.join(dir, 'repo')
  const globalConfigDir = path.join(dir, 'global')
  await fs.mkdir(path.join(root, '.formax'), { recursive: true })
  await fs.mkdir(globalConfigDir, { recursive: true })

  const prev = process.env.FORMAX_CONFIG_DIR
  process.env.FORMAX_CONFIG_DIR = globalConfigDir
  try {
    return await fn({ root, globalConfigDir })
  } finally {
    if (prev === undefined) delete process.env.FORMAX_CONFIG_DIR
    else process.env.FORMAX_CONFIG_DIR = prev
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe('createSlashCommandToolModule', () => {
  it('renders (none found) when no commands exist', async () => {
    await withTempRepo(async ({ root }) => {
      const mod = createSlashCommandToolModule({ cwd: root })
      const spec = typeof mod.spec === 'function' ? mod.spec() : mod.spec
      expect(spec.description).toContain('\nAvailable Commands:\n(none found)\n')
    })
  })

  it('lists commands and filters disable-model-invocation', async () => {
    await withTempRepo(async ({ root }) => {
      const commandsDir = path.join(root, '.formax', 'commands')
      await fs.mkdir(path.join(commandsDir, 'git'), { recursive: true })

      await fs.writeFile(path.join(commandsDir, 'hello.md'), 'Hello command\n', 'utf8')
      await fs.writeFile(path.join(commandsDir, 'git', 'status.md'), 'Project git status\n', 'utf8')
      await fs.writeFile(
        path.join(commandsDir, 'blocked.md'),
        ['---', 'disable-model-invocation: true', '---', '', 'Should not show'].join('\n'),
        'utf8',
      )

      const blockedRaw = await fs.readFile(path.join(commandsDir, 'blocked.md'), 'utf8')
      expect(blockedRaw.startsWith('---')).toBe(true)
      expect(parseMarkdownFrontmatter(blockedRaw)).toEqual({
        attributes: { 'disable-model-invocation': 'true' },
        body: 'Should not show',
      })

      const configPaths = getConfigPaths({ cwd: root, env: process.env })
      const store = createCommandStore({ cwd: root, globalConfigDir: configPaths.globalConfigDir })
      const blocked = store.get('/blocked')
      expect(blocked?.filePath).toBe(path.join(commandsDir, 'blocked.md'))
      expect(blocked?.body).toBe('Should not show')
      expect(blocked?.description).toBe('Should not show')
      expect(blocked?.disableModelInvocation).toBe(true)

      const mod = createSlashCommandToolModule({ cwd: root })
      const spec = typeof mod.spec === 'function' ? mod.spec() : mod.spec
      const desc = spec.description

      expect(desc).toContain('Available Commands:')
      expect(desc).toContain('- /hello: Hello command')
      expect(desc).toContain('- /git:status: Project git status')
      expect(desc).not.toContain('/blocked')
      expect(desc).not.toContain('Should not show')
    })
  })
})
