import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  wsWarn: vi.fn(),
  wsInfo: vi.fn(),
  getBuiltinSubagents: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  default: {
    readdir: (...args: unknown[]) => mocks.readdir(...args),
    readFile: (...args: unknown[]) => mocks.readFile(...args),
  },
}))
vi.mock('../../tui/consoleLogger', () => ({
  wsWarn: (...args: unknown[]) => mocks.wsWarn(...args),
  wsInfo: (...args: unknown[]) => mocks.wsInfo(...args),
  wsError: vi.fn(),
}))
vi.mock('./builtins', () => ({
  getBuiltinSubagents: () => mocks.getBuiltinSubagents(),
}))

import { __testOnlyRegistry, createSubAgentRegistry } from './registry'

describe('subagent registry branch coverage', () => {
  beforeEach(() => {
    mocks.readdir.mockReset()
    mocks.readFile.mockReset()
    mocks.wsWarn.mockReset()
    mocks.wsInfo.mockReset()
    mocks.getBuiltinSubagents.mockReset()
    mocks.getBuiltinSubagents.mockReturnValue([
      { name: 'builtin-a', description: 'A', tools: ['*'], systemPrompt: 'x' },
      { name: '', description: 'skip', tools: ['*'], systemPrompt: 'x' },
    ])
  })

  it('seeds builtins and ignores empty builtin names', async () => {
    const registry = createSubAgentRegistry()
    mocks.readdir.mockResolvedValue([])
    await registry.loadFromDirectories([])

    expect(registry.list()).toContainEqual({ name: 'builtin-a', description: 'A' })
    expect(registry.get('')).toBeUndefined()
    expect(mocks.wsInfo).toHaveBeenCalledWith(expect.stringContaining('builtins=true'))
  })

  it('handles ENOENT silently and warns for non-missing directory errors', async () => {
    const registry = createSubAgentRegistry({ includeBuiltins: false })
    mocks.readdir
      .mockRejectedValueOnce({ code: 'ENOENT' })
      .mockRejectedValueOnce('boom-non-object')
      .mockRejectedValueOnce(new Error('EACCES'))

    await registry.loadFromDirectories(['/missing', '/bad', '/nope'])
    expect(mocks.wsWarn).toHaveBeenCalledTimes(2)
    expect(String(mocks.wsWarn.mock.calls[0]?.[0])).toContain('Failed to read directory /bad')
    expect(String(mocks.wsWarn.mock.calls[1]?.[0])).toContain('Failed to read directory /nope')
  })

  it('warns on parse failures and accepts non-string tools as empty list', async () => {
    const registry = createSubAgentRegistry({ includeBuiltins: false })
    mocks.readdir.mockResolvedValue(['bad.md', 'ok.md'])
    mocks.readFile
      .mockRejectedValueOnce(new Error('read-failed'))
      .mockResolvedValueOnce(`---
name: object-tools
description: object tools
tools:
---
prompt
`)

    await registry.loadFromDirectories(['/d'])
    expect(mocks.wsWarn).toHaveBeenCalledWith('[SubAgentRegistry] Failed to parse bad.md:', expect.any(Error))
    expect(registry.get('object-tools')).toEqual({
      name: 'object-tools',
      description: 'object tools',
      tools: [],
      systemPrompt: 'prompt',
    })
  })

  it('covers parseToolsField/object fallback and isMissingDir helper', () => {
    expect(__testOnlyRegistry.parseToolsField({} as any)).toEqual([])
    expect(__testOnlyRegistry.parseToolsField('')).toEqual([])
    expect(__testOnlyRegistry.parseToolsField('*')).toEqual(['*'])
    expect(__testOnlyRegistry.isMissingDir({ code: 'ENOENT' })).toBe(true)
    expect(__testOnlyRegistry.isMissingDir({ code: 'EACCES' })).toBe(false)
    expect(__testOnlyRegistry.isMissingDir(null)).toBe(false)
  })

  it('covers frontmatter/yaml parsing helpers', () => {
    expect(__testOnlyRegistry.parseFrontmatter('plain')).toEqual({ data: {}, content: 'plain' })
    expect(__testOnlyRegistry.parseFrontmatter('---\nname: a')).toEqual({ data: {}, content: '---\nname: a' })

    const parsed = __testOnlyRegistry.parseFrontmatter(`---
name: "agent-x"
tools:
  - Read
badline
---
prompt
`)
    expect(parsed.data).toEqual({ name: 'agent-x', tools: ['Read'] })
    expect(parsed.content.trim()).toBe('prompt')

    expect(__testOnlyRegistry.parseSimpleYaml(['# c', '', 'x', 'k: v'])).toEqual({ k: 'v' })
    expect(__testOnlyRegistry.parseSimpleYaml(['tools:', 'nonsense', 'next: v'])).toEqual({
      tools: [],
      next: 'v',
    })
    expect(__testOnlyRegistry.parseSimpleYaml([undefined as any, 'k:'])).toEqual({ k: [] })
    expect(__testOnlyRegistry.parseSimpleYaml(['tools:', undefined as any])).toEqual({ tools: [] })
    expect(__testOnlyRegistry.unquote('"quoted"')).toBe('quoted')
    expect(__testOnlyRegistry.unquote("'single'")).toBe('single')
  })

  it('handles non-array directories input defensively', async () => {
    const registry = createSubAgentRegistry({ includeBuiltins: false })
    await (registry as any).loadFromDirectories(null)
    await (registry as any).loadFromDirectories([undefined])
    expect(registry.list()).toEqual([])
  })
})
