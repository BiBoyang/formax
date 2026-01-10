import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { SlashCommandToolHandler } from './handler'

async function writeFileEnsuringDir(filePath: string, content: string) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

describe('SlashCommandToolHandler', () => {
  it('errors when command is missing', async () => {
    const result = await SlashCommandToolHandler.execute(
      { id: '1', name: 'SlashCommand', input: {} as any },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Missing required field command')
  })

  it('errors when command is not a custom command', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-slashcmd-'))
    try {
      const result = await SlashCommandToolHandler.execute(
        { id: '2', name: 'SlashCommand', input: { command: '/help' } },
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBe(true)
      expect(result.content).toContain('Unknown slash command')
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('expands a .claude/commands/*.md command', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-slashcmd-expand-'))
    try {
      const filePath = path.join(tmpDir, '.claude', 'commands', 'foo.md')
      await writeFileEnsuringDir(
        filePath,
        `---\ndescription: Foo command\n---\n\nPrint today's date.\n`,
      )

      const result = await SlashCommandToolHandler.execute(
        { id: '3', name: 'SlashCommand', input: { command: '/foo 123' } },
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBeUndefined()
      expect(result.content).toContain('<command-message>foo is running…</command-message>')
      expect(result.content).toContain('<command-name>/foo</command-name>')
      expect(result.content).toContain('<command-args>123</command-args>')
      expect(result.content).toContain("Print today's date.")
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('rejects unsafe command names', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-slashcmd-unsafe-'))
    try {
      const result = await SlashCommandToolHandler.execute(
        { id: '4', name: 'SlashCommand', input: { command: '/../oops' } },
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBe(true)
      expect(result.content).toContain('Invalid command name')
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

