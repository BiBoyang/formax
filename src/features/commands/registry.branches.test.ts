import { beforeEach, describe, expect, it, vi } from 'vitest'

const { commandEntriesRef } = vi.hoisted(() => ({
  commandEntriesRef: { current: [] as any[] },
}))

vi.mock('./CommandStore', () => ({
  createCommandStore: () => ({
    listAll: () => commandEntriesRef.current,
  }),
}))

import { createSlashCommandRegistry } from './registry'

describe('createSlashCommandRegistry branch coverage', () => {
  beforeEach(() => {
    commandEntriesRef.current = []
  })

  it('deduplicates repeated command ids from command store', () => {
    commandEntriesRef.current = [
      {
        scope: 'project',
        id: '/dup',
        description: 'Duplicate command',
        hasDescriptionFrontmatter: true,
        disableModelInvocation: false,
        body: 'one',
      },
      {
        scope: 'project',
        id: '/dup',
        description: 'Duplicate command second',
        hasDescriptionFrontmatter: true,
        disableModelInvocation: false,
        body: 'two',
      },
    ]
    const reg = createSlashCommandRegistry({
      cwd: '/tmp/repo',
      globalConfigDir: '/tmp/formax-test-config',
    })
    const variants = reg.list().filter((spec) => spec.id === 'project:/dup')
    expect(variants).toHaveLength(1)
  })

  it('falls back to first candidate when source is not builtin/project/user', () => {
    commandEntriesRef.current = [
      {
        scope: 'other',
        id: '/odd',
        description: 'Odd source command',
        hasDescriptionFrontmatter: true,
        disableModelInvocation: false,
        body: 'odd',
      },
    ]
    const reg = createSlashCommandRegistry({
      cwd: '/tmp/repo',
      globalConfigDir: '/tmp/formax-test-config',
    })
    const effect = reg.dispatch('/odd')
    expect(effect?.kind).toBe('llm')
  })
})
