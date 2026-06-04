import { describe, expect, it } from 'vitest'
import { createSingleCwdMcpRootsList } from './roots.js'

describe('MCP roots projection', () => {
  it('projects exactly one cwd root', () => {
    const roots = createSingleCwdMcpRootsList('/tmp/formax-worktree')

    expect(roots).toEqual({
      roots: [{ uri: 'file:///tmp/formax-worktree', name: 'formax-worktree' }],
    })
    expect(roots.roots).toHaveLength(1)
  })
})
