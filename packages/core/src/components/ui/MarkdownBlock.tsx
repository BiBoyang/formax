import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../tui/theme'

type Block =
  | { kind: 'blank' }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; lines: string[] }

export function MarkdownBlock({ markdown }: { markdown: string }): React.ReactNode {
  const theme = getTheme()
  const blocks = parseMarkdown(markdown)

  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => {
        if (block.kind === 'blank') return <Text key={`b-${idx}`}> </Text>
        if (block.kind === 'code') {
          return (
            <Box key={`c-${idx}`} flexDirection="column">
              {block.lines.map((l, i) => (
                <Text key={`c-${idx}-${i}`}>{l.length === 0 ? ' ' : l}</Text>
              ))}
            </Box>
          )
        }
        if (block.kind === 'list') {
          return (
            <Box key={`l-${idx}`} flexDirection="column">
              {block.items.map((item, i) => (
                <Text key={`l-${idx}-${i}`}>- {renderInline(item, theme)}</Text>
              ))}
            </Box>
          )
        }
        return (
          <Box key={`p-${idx}`} flexDirection="column">
            {block.lines.map((l, i) => (
              <Text key={`p-${idx}-${i}`}>{renderInline(l, theme)}</Text>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

export function parseMarkdown(raw: string): Block[] {
  const lines = String(raw).replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim().length === 0) {
      while (i < lines.length && lines[i].trim().length === 0) i += 1
      blocks.push({ kind: 'blank' })
      continue
    }

    if (line.trimStart().startsWith('```')) {
      i += 1
      const codeLines: string[] = []
      while (i < lines.length && !String(lines[i]).trimStart().startsWith('```')) {
        codeLines.push(String(lines[i]))
        i += 1
      }
      if (i < lines.length && String(lines[i]).trimStart().startsWith('```')) i += 1
      blocks.push({ kind: 'code', lines: codeLines })
      continue
    }

    if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && String(lines[i]).startsWith('- ')) {
        items.push(String(lines[i]).slice(2))
        i += 1
      }
      blocks.push({ kind: 'list', items })
      continue
    }

    const paraLines: string[] = []
    while (i < lines.length) {
      const cur = String(lines[i])
      if (cur.trim().length === 0) break
      if (cur.trimStart().startsWith('```')) break
      if (cur.startsWith('- ')) break
      paraLines.push(cur)
      i += 1
    }
    blocks.push({ kind: 'paragraph', lines: paraLines })
  }

  while (blocks[0]?.kind === 'blank') blocks.shift()
  while (blocks.at(-1)?.kind === 'blank') blocks.pop()
  return blocks
}

export function renderInline(text: string, theme: ReturnType<typeof getTheme>): React.ReactNode {
  const parts: Array<{ kind: 'text' | 'code'; value: string }> = []
  const s = String(text)
  let i = 0

  while (i < s.length) {
    const tick = s.indexOf('`', i)
    if (tick === -1) {
      parts.push({ kind: 'text', value: s.slice(i) })
      break
    }
    if (tick > i) parts.push({ kind: 'text', value: s.slice(i, tick) })
    const end = s.indexOf('`', tick + 1)
    if (end === -1) {
      parts.push({ kind: 'text', value: s.slice(tick) })
      break
    }
    parts.push({ kind: 'code', value: s.slice(tick + 1, end) })
    i = end + 1
  }

  return (
    <>
      {parts.map((p, idx) =>
        p.kind === 'code' ? (
          <Text key={idx} bold color={theme.text}>
            {p.value}
          </Text>
        ) : (
          <Text key={idx}>{p.value}</Text>
        ),
      )}
    </>
  )
}
