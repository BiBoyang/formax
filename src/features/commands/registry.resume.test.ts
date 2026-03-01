import { describe, expect, it, vi } from 'vitest'

vi.mock('./CommandStore', () => {
  return {
    createCommandStore: () => ({
      listAll: () => [],
    }),
  }
})

import { createSlashCommandRegistry } from './registry'

describe('slash command: /resume', () => {
  it('dispatches to open the resume overlay', () => {
    const registry = createSlashCommandRegistry({
      cwd: '/tmp/repo',
      globalConfigDir: '/tmp/formax-test-config',
    })

    const effect = registry.dispatch('/resume')
    expect(effect).toEqual({ kind: 'open_resume_dialog' })
  })
})
