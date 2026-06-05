import React from 'react'
import { parseMcpModelToolName } from '../../../mcp/names'
import { formatToolCallParts } from '../../../shared/utils/toolFormatting'
import { createToolBlocksPresenter } from '../../../shared/toolPresenterContracts'
import type { Msg, ToolBlocksOutput } from '../../../shared/toolMessageTypes'
import { McpApprovalToolBlock } from '../../../components/tool/McpApprovalToolBlock'

export const McpToolPresenter = createToolBlocksPresenter(
  ({ message }: { message: Msg }): ToolBlocksOutput => {
    if (!message.toolInfo) {
      return { blocks: [{ kind: 'header', status: 'completed', label: 'MCP tool' }] }
    }

    const { name, input, status, middleLines, expandInfo } = message.toolInfo
    const { params } = formatToolCallParts(name, input ?? {}, { preferRelativePaths: true })
    const toolLabel = formatMcpToolLabel(name)
    const toolUseId =
      message.toolInfo.toolUseId || (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)
    const blocks: ToolBlocksOutput['blocks'] = [
      {
        kind: 'header',
        status,
        label: toolLabel,
        params: params.trim() ? params : null,
      },
    ]

    if (status === 'running') {
      blocks.push({
        kind: 'custom',
        node: (
          <McpApprovalToolBlock
            toolUseId={toolUseId}
            title={`Approve ${toolLabel}?`}
            toolLabel={toolLabel}
          />
        ),
      })
      return { blocks }
    }

    const summary = String(message.content ?? '').trim()
    if (summary) {
      blocks.push({
        kind: 'subline',
        status: status === 'error' ? 'error' : 'completed',
        text: summary,
      })
    }

    const lines: Array<{ text: string; tone?: 'default' | 'muted' | 'error' }> = []
    if (middleLines) {
      lines.push(...middleLines.map((line) => ({
        text: line,
        ...(status === 'error' ? { tone: 'error' as const } : {}),
      })))
    }
    if (expandInfo) lines.push({ tone: 'muted', text: expandInfo })
    if (lines.length > 0) blocks.push({ kind: 'lines', lines })

    return { blocks }
  },
)

function formatMcpToolLabel(name: string): string {
  const parsed = parseMcpModelToolName(name)
  if (!parsed) return 'MCP tool'
  return `MCP ${parsed.serverId}/${parsed.toolName}`
}
