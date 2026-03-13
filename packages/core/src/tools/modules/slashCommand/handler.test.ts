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
  it('matches only SlashCommand tool name', () => {
    expect(SlashCommandToolHandler.canHandle('SlashCommand')).toBe(true)
    expect(SlashCommandToolHandler.canHandle('Read')).toBe(false)
  })

  it('errors when command is missing', async () => {
    const result = await SlashCommandToolHandler.execute(
      { id: '1', name: 'SlashCommand', input: {} as any },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Missing required field command')
  })

  it('errors when input is omitted', async () => {
    const result = await SlashCommandToolHandler.execute(
      { id: 'missing-input', name: 'SlashCommand' } as any,
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

  it('uses process.cwd when ctx.cwd is missing', async () => {
    const result = await SlashCommandToolHandler.execute(
      { id: 'cwd-fallback', name: 'SlashCommand', input: { command: '/definitely-missing' } },
      { agentDepth: 0 } as any,
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Unknown slash command')
  })

  it('expands a .formax/commands/*.md command', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-slashcmd-expand-'))
    try {
      const filePath = path.join(tmpDir, '.formax', 'commands', 'foo.md')
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

  it('errors on invalid command format', async () => {
    const result = await SlashCommandToolHandler.execute(
      { id: 'invalid-format', name: 'SlashCommand', input: { command: 'foo' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Invalid command format')
  })

  it('errors on command format with newlines', async () => {
    const result = await SlashCommandToolHandler.execute(
      { id: 'invalid-format-newline', name: 'SlashCommand', input: { command: '/foo\nbar' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Invalid command format')
  })

  it('rejects commands disabled for model invocation', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-slashcmd-disabled-'))
    try {
      await writeFileEnsuringDir(
        path.join(tmpDir, '.formax', 'commands', 'secret.md'),
        ['---', 'description: Secret command', 'disable-model-invocation: true', '---', '', 'Body'].join('\n'),
      )

      const result = await SlashCommandToolHandler.execute(
        { id: 'disabled', name: 'SlashCommand', input: { command: '/secret' } },
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBe(true)
      expect(result.content).toContain('disabled for model invocation')
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('lists available commands on unknown command', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-slashcmd-list-'))
    try {
      await writeFileEnsuringDir(
        path.join(tmpDir, '.formax', 'commands', 'zeta.md'),
        ['---', 'description: Zeta command', '---', '', 'Body'].join('\n'),
      )
      await writeFileEnsuringDir(
        path.join(tmpDir, '.formax', 'commands', 'alpha.md'),
        ['---', 'description: Alpha command', '---', '', 'Body'].join('\n'),
      )

      const result = await SlashCommandToolHandler.execute(
        { id: 'unknown-list', name: 'SlashCommand', input: { command: '/missing' } },
        { cwd: tmpDir, agentDepth: 0 },
      )

      expect(result.is_error).toBe(true)
      expect(result.content).toContain('Available commands: /alpha, /zeta')
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('converts non-Error throwables into error text', async () => {
    const call = { id: 'slash-non-error', name: 'SlashCommand' } as any
    Object.defineProperty(call, 'input', {
      get() {
        throw 'boom'
      },
    })

    const result = await SlashCommandToolHandler.execute(call, { cwd: process.cwd(), agentDepth: 0 })
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Error: boom')
  })

  it('converts Error throwables into error text', async () => {
    const result = await SlashCommandToolHandler.execute(
      {
        id: 'slash-error',
        name: 'SlashCommand',
        input: { command: '/foo', extra: true },
      } as any,
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('unknown field')
  })

  it('rejects slash command names with nested path and backslash', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-slashcmd-path-unsafe-'))
    try {
      const nested = await SlashCommandToolHandler.execute(
        { id: 'unsafe-nested', name: 'SlashCommand', input: { command: '/foo/bar' } },
        { cwd: tmpDir, agentDepth: 0 },
      )
      expect(nested.is_error).toBe(true)
      expect(nested.content).toContain('Invalid command name')

      const backslash = await SlashCommandToolHandler.execute(
        { id: 'unsafe-backslash', name: 'SlashCommand', input: { command: '/foo\\bar' } },
        { cwd: tmpDir, agentDepth: 0 },
      )
      expect(backslash.is_error).toBe(true)
      expect(backslash.content).toContain('Invalid command name')
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('rejects empty slash command name', async () => {
    const result = await SlashCommandToolHandler.execute(
      { id: 'unsafe-empty', name: 'SlashCommand', input: { command: '/' } },
      { cwd: process.cwd(), agentDepth: 0 },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Invalid command name')
  })
})
