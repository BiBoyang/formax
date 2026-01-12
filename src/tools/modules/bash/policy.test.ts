import { describe, it, expect } from 'vitest'
import { classifyBashCommand } from './policy'

describe('classifyBashCommand', () => {
  it('allows tree without output flags', () => {
    const res = classifyBashCommand({ command: 'tree -L 2', agentDepth: 1 })
    expect(res.risk).toBe('allow')
    expect(res.matchedRule).toBe('allow_tree')
  })

  it('unwraps bash -lc and classifies the inner command', () => {
    const res = classifyBashCommand({ command: 'bash -lc \"tree -L 2\"', agentDepth: 1 })
    expect(res.risk).toBe('allow')
    expect(res.matchedRule).toBe('allow_tree')
  })

  it('does not treat < or > inside quotes as redirection', () => {
    const res = classifyBashCommand({ command: "echo '<div>'", agentDepth: 0 })
    expect(res.risk).toBe('allow')
  })

  it('treats unquoted < or > as redirection', () => {
    const res = classifyBashCommand({ command: 'echo ok > out.txt', agentDepth: 0 })
    expect(res.risk).toBe('confirm')
    expect(res.matchedRule).toBe('confirm_redirection')
  })

  it('does not treat tee as redirection when it is an argument', () => {
    const res = classifyBashCommand({ command: 'echo tee', agentDepth: 0 })
    expect(res.risk).toBe('allow')
  })

  it('requires confirmation for tree -o (writes output file)', () => {
    const res = classifyBashCommand({ command: 'tree -o out.txt', agentDepth: 1 })
    expect(res.risk).toBe('confirm')
    expect(res.matchedRule).toBe('confirm_tree_output')
  })

  it('unwraps bash -lc and preserves tree -o confirmation', () => {
    const res = classifyBashCommand({ command: 'bash -lc \"tree -o out.txt\"', agentDepth: 1 })
    expect(res.risk).toBe('confirm')
    expect(res.matchedRule).toBe('confirm_tree_output')
  })
})
