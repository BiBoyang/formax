import React from 'react'
import { Box } from 'ink'
import { ToolHeaderLine } from './ToolHeaderLine'
import { ToolIndentedLine, ToolSubline } from './ToolSubline'
import type { ToolUiBlock } from './toolUiBlocksTypes'

export function ToolUiBlocks({
  blocks,
  headerSuffix,
}: {
  blocks: ToolUiBlock[]
  headerSuffix?: string | null
}): React.ReactNode {
  if (!blocks.length) return null
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      {blocks.map((block, idx) => {
        if (block.kind === 'header') {
          return (
            <ToolHeaderLine
              key={`header-${idx}`}
              status={block.status}
              label={block.label}
              params={block.params ?? null}
              suffix={headerSuffix}
            />
          )
        }

        if (block.kind === 'subline') {
          return (
            <Box key={`subline-${idx}`} flexDirection="column">
              <ToolSubline status={block.status} text={block.text}>
                {block.children}
              </ToolSubline>
            </Box>
          )
        }

        if (block.kind === 'lines') {
          return (
            <Box key={`lines-${idx}`} flexDirection="column">
              {block.lines.map((l, lineIdx) => (
                <ToolIndentedLine
                  key={`line-${idx}-${lineIdx}`}
                  tone={l.tone ?? 'default'}
                  text={l.text}
                />
              ))}
            </Box>
          )
        }

        return (
          <Box key={`custom-${idx}`} flexDirection="column">
            {block.node}
          </Box>
        )
      })}
    </Box>
  )
}
