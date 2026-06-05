import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'

type MockUserInput = {
  isPending: (toolUseId: string) => boolean
  submitAnswers: (toolUseId: string, answers: Record<string, string>) => void
}

const mocks = vi.hoisted(() => ({
  userInput: null as MockUserInput | null,
  promptProps: null as null | {
    title: string
    toolLabel: string
    rememberLabel: string
    onDecision: (decision: { kind: string; feedback?: string }) => void
  },
}))

vi.mock('../../tools/runtime/userInputContext', () => ({
  useUserInputManager: () => mocks.userInput,
}))

vi.mock('./mcpApprovalPrompt', () => ({
  McpApprovalPrompt: (props: any) => {
    mocks.promptProps = props
    return <Text>{props.title}</Text>
  },
}))

import { McpApprovalToolBlock } from './McpApprovalToolBlock.js'

describe('McpApprovalToolBlock', () => {
  beforeEach(() => {
    mocks.userInput = null
    mocks.promptProps = null
  })

  it('renders nothing when user input manager is unavailable or not pending', () => {
    let view = render(
      <McpApprovalToolBlock toolUseId="mcp-1" title="Approve MCP?" toolLabel="MCP server/tool" />,
    )
    expect(view.lastFrame()).toBe('')

    mocks.userInput = {
      isPending: () => false,
      submitAnswers: vi.fn(),
    }
    view = render(
      <McpApprovalToolBlock toolUseId="mcp-1" title="Approve MCP?" toolLabel="MCP server/tool" />,
    )
    expect(view.lastFrame()).toBe('')
  })

  it('renders prompt and maps all decision kinds to submitAnswers payloads', () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      isPending: () => true,
      submitAnswers,
    }

    const { lastFrame } = render(
      <McpApprovalToolBlock toolUseId="mcp-approve" title="Approve MCP tool?" toolLabel="MCP github/create_issue" />,
    )

    expect(lastFrame()).toContain('Approve MCP tool?')
    expect(mocks.promptProps).not.toBe(null)
    if (!mocks.promptProps) throw new Error('Expected prompt props')
    expect(mocks.promptProps.rememberLabel).toBe('Yes, allow MCP github/create_issue during this session')

    mocks.promptProps.onDecision({ kind: 'approve' })
    mocks.promptProps.onDecision({ kind: 'approve_remember' })
    mocks.promptProps.onDecision({ kind: 'feedback', feedback: 'use another tool' })
    mocks.promptProps.onDecision({ kind: 'cancel' })

    expect(submitAnswers).toHaveBeenNthCalledWith(1, 'mcp-approve', { decision: 'approve' })
    expect(submitAnswers).toHaveBeenNthCalledWith(2, 'mcp-approve', { decision: 'approve_remember' })
    expect(submitAnswers).toHaveBeenNthCalledWith(3, 'mcp-approve', {
      decision: 'feedback',
      feedback: 'use another tool',
    })
    expect(submitAnswers).toHaveBeenNthCalledWith(4, 'mcp-approve', { decision: 'cancel' })
  })
})
