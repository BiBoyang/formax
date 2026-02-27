import React from 'react'
import { Box, Text } from 'ink'
import { createToolBlocksPresenter } from './types'
import type { Msg } from '../../shared/toolMessageTypes'
import type { ToolBlocksOutput } from '../../shared/toolMessageTypes'
import { ToolIndentedLine, ToolSubline } from './ToolUiPrimitives'
import { getTheme } from '../../utils/theme'

function parseCommand(input: unknown): string {
  const rec = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : null
  const cmd = typeof rec?.command === 'string' ? rec.command : ''
  return cmd.trim()
}

function toLines(text: string): string[] {
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized) return []
  // Keep empty lines; CC renders them too.
  return normalized.split('\n')
}

export const LocalBashPresenter = createToolBlocksPresenter(
  ({ message }: { message: Msg }): ToolBlocksOutput => {
    const theme = getTheme()
    const toolInfo = message.toolInfo
    if (!toolInfo) return { blocks: [] }

    const command = parseCommand(toolInfo.input)
    const status = toolInfo.status

    const outputText = typeof toolInfo.result === 'string' ? toolInfo.result : ''
    const expanded = Boolean(toolInfo.expanded)
    const allLines = toLines(outputText)

    const maxPrimaryLines = 3
    const shownLines = expanded ? allLines : allLines.slice(0, maxPrimaryLines)
    const hidden = Math.max(0, allLines.length - shownLines.length)

    return {
      blocks: [
        {
          kind: 'custom',
          node: (
            <Box flexDirection="column">
              <Text
                color={theme.replUserPromptFg}
                backgroundColor={theme.replUserPromptBg}
              >
                {`! ${command} `}
              </Text>

              {status === 'running' ? null : shownLines.length > 0 ? (
                <>
                  <ToolSubline
                    status={status === 'error' ? 'error' : 'completed'}
                    text={shownLines[0]}
                  />
                  {shownLines.slice(1).map((line, idx) => (
                    <ToolIndentedLine key={idx} text={line} />
                  ))}
                </>
              ) : (
                <ToolSubline status={status === 'error' ? 'error' : 'completed'} text="(no output)" />
              )}

              {!expanded && hidden > 0 ? (
                <ToolIndentedLine tone="muted" text={`… +${hidden} lines (ctrl+o to expand)`} />
              ) : null}
            </Box>
          ),
        },
      ],
    }
  },
)
