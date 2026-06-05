import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { McpApprovalPrompt } from './mcpApprovalPrompt'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5))
}

describe('McpApprovalPrompt', () => {
  it('renders MCP tool context and options', async () => {
    const onDecision = vi.fn()

    const { lastFrame } = render(
      <InputScopeProvider>
        <McpApprovalPrompt
          title="Approve MCP github/create_issue?"
          toolLabel="MCP github/create_issue"
          rememberLabel="Yes, allow MCP github/create_issue during this session"
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    await tick()
    const frame = lastFrame() || ''
    expect(frame).toContain('Approve MCP github/create_issue?')
    expect(frame).toContain('Tool: MCP github/create_issue')
    expect(frame).toContain('1. Yes')
    expect(frame).toContain('2. Yes, allow MCP github/create_issue during this session')
    expect(frame).toContain('Type here to tell Claude what to do differently')
    expect(frame).toContain('Esc to cancel')
  })

  it('esc cancels', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <McpApprovalPrompt
          title="Approve?"
          toolLabel="MCP github/create_issue"
          rememberLabel="Remember"
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    for (let i = 0; i < 3; i += 1) await tick()
    stdin.write('\u001B')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'cancel' })
  })

  it('enter approves Yes', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <McpApprovalPrompt
          title="Approve?"
          toolLabel="MCP github/create_issue"
          rememberLabel="Remember"
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    for (let i = 0; i < 3; i += 1) await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve' })
  })

  it('selects remember with arrow + enter', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <McpApprovalPrompt
          title="Approve?"
          toolLabel="MCP github/create_issue"
          rememberLabel="Remember"
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    for (let i = 0; i < 3; i += 1) await tick()
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'approve_remember' })
  })

  it('submits trimmed feedback', async () => {
    const onDecision = vi.fn()

    const { stdin } = render(
      <InputScopeProvider>
        <McpApprovalPrompt
          title="Approve?"
          toolLabel="MCP github/create_issue"
          rememberLabel="Remember"
          onDecision={onDecision}
        />
      </InputScopeProvider>,
    )

    for (let i = 0; i < 3; i += 1) await tick()
    stdin.write('3')
    await tick()
    stdin.write(' ')
    await tick()
    stdin.write('a')
    await tick()
    stdin.write(' ')
    await tick()
    stdin.write('\r')
    await tick()

    expect(onDecision).toHaveBeenCalledTimes(1)
    expect(onDecision).toHaveBeenCalledWith({ kind: 'feedback', feedback: 'a' })
  })
})
