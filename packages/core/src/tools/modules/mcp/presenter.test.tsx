import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'
import { isToolBlocksPresenter } from '../../../shared/toolPresenterContracts'
import type { Msg } from '../../../shared/toolMessageTypes'

const mocks = vi.hoisted(() => ({
  approvalBlockProps: null as null | { toolUseId: string; title: string; toolLabel: string },
}))

vi.mock('../../../components/tool/McpApprovalToolBlock', () => ({
  McpApprovalToolBlock: (props: any) => {
    mocks.approvalBlockProps = props
    return <Text>{`APPROVAL:${props.toolUseId}:${props.toolLabel}`}</Text>
  },
}))

import { McpToolPresenter } from './presenter'

function renderMcp(message: Msg): string {
  if (!isToolBlocksPresenter(McpToolPresenter)) throw new Error('Expected blocks presenter')
  const blocks = McpToolPresenter({ message }).blocks
  const { lastFrame } = render(<ToolUiBlocks blocks={blocks} />)
  return lastFrame() ?? ''
}

describe('McpToolPresenter', () => {
  beforeEach(() => {
    mocks.approvalBlockProps = null
  })

  it('renders a generic MCP header and completed summary', () => {
    const frame = renderMcp({
      id: 'tool-1',
      role: 'tool',
      content: 'created issue',
      timestamp: new Date(),
      toolInfo: {
        name: 'mcp__github__create_issue',
        input: { title: 'Hello' },
        status: 'completed',
      },
    })

    expect(frame).toContain('MCP github/create_issue')
    expect(frame).toContain('created issue')
  })

  it('renders running MCP tools with a pending approval block hook', () => {
    const frame = renderMcp({
      id: 'tool-2',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'mcp__github__create_issue',
        input: { title: 'Hello' },
        status: 'running',
        toolUseId: 'mcp-use-1',
      },
    })

    expect(frame).toContain('MCP github/create_issue')
    expect(frame).toContain('APPROVAL:mcp-use-1:MCP github/create_issue')
    expect(frame).not.toContain('⎿')
    expect(mocks.approvalBlockProps).toEqual({
      toolUseId: 'mcp-use-1',
      title: 'Approve MCP github/create_issue?',
      toolLabel: 'MCP github/create_issue',
    })
  })

  it('falls back cleanly for malformed MCP tool names', () => {
    const frame = renderMcp({
      id: 'tool-3',
      role: 'tool',
      content: 'done',
      timestamp: new Date(),
      toolInfo: {
        name: 'mcp__missing_tool_segment',
        input: {},
        status: 'completed',
      },
    })

    expect(frame).toContain('MCP tool')
    expect(frame).toContain('done')
  })
})
