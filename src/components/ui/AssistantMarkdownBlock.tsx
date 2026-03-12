import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../tui/theme'

type AssistantBlock =
  | { kind: 'blank' }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; items: AssistantListItem[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; lines: string[]; language?: string | null }
  | { kind: 'rule' }
  | { kind: 'table'; lines: string[] }

type QuoteRenderLine = {
  text: string
  tone: 'text' | 'code'
}

type AssistantListItem = {
  indent: number
  marker: string
  text: string
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/
const RULE_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/
const FENCE_START_RE = /^\s{0,3}(`{3,}|~{3,})([^\n]*)$/
const INDENTED_CODE_RE = /^(?: {4}|\t)/
const LIST_RE = /^(\s*)([-+*]|\d+\.)\s+(.*)$/
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/
const REF_DEF_RE = /^\s*\[([^\]]+)\]:\s*(<[^>\n]+>|\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/
const TABLE_DIVIDER_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/
const HTML_TAG_LINE_RE = /^\s*<\/?[a-zA-Z][^>]*>\s*$/
const HTML_WRAPPED_TEXT_LINE_RE = /^\s*<([a-zA-Z][\w-]*)(?:\s+[^>]*)?>.*<\/\1>\s*$/
const AUTOLINK_LINE_RE = /^\s*<(?:https?:\/\/[^>\s]+|mailto:[^>\s]+)>\s*$/
const INLINE_HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g
const SIMPLE_ANGLE_TOKEN_RE = /^\s*<\/?([A-Za-z][\w-]*)>\s*$/
const INLINE_IMAGE_LINK_RE = /!\[([^\]]*)\]\(((?:\\.|[^\s()]+|\([^\s()]*\))+)(?:\s+"[^"]*")?\)/g
const INLINE_LINK_RE = /\[([^\]]+)\]\(((?:\\.|[^\s()]+|\([^\s()]*\))+)(?:\s+"[^"]*")?\)/g
const FOOTNOTE_DEF_RE = /^\s*\[\^[^\]]+\]:\s*(.*)$/
const URLISH_RE = /(?:https?:\/\/[^\s]+)|(?:mailto:[^\s]+)|(?:\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b)/g
const CODE_KEYWORD_RE =
  /\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|interface|type|import|export|from|async|await|try|catch|throw|new|extends|null|undefined|true|false)\b/g
const BASH_KEYWORD_RE = /\b(?:set|echo|export|cd|ls|cat|grep|sed|awk|find|pwd|chmod|chown|mkdir|rm|mv|cp)\b/g
const STRING_RE = /(`(?:\\`|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g

type CodeTokenTone = 'plain' | 'keyword' | 'string' | 'comment' | 'diffAdd' | 'diffDel'

type CodeToken = {
  tone: CodeTokenTone
  text: string
}

type FenceInfo = {
  markerChar: '`' | '~'
  markerLen: number
  language: string | null
}

type InlineStyleState = {
  bold: boolean
  italic: boolean
  strikethrough: boolean
}

type InlineFragment =
  | ({ kind: 'text'; text: string } & InlineStyleState)
  | ({ kind: 'code'; text: string } & InlineStyleState)

const KNOWN_HTML_TAGS = new Set([
  'a',
  'abbr',
  'address',
  'area',
  'article',
  'aside',
  'audio',
  'b',
  'base',
  'bdi',
  'bdo',
  'blockquote',
  'body',
  'br',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'i',
  'iframe',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'link',
  'main',
  'map',
  'mark',
  'meta',
  'meter',
  'nav',
  'noscript',
  'object',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'param',
  'picture',
  'pre',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'script',
  'section',
  'select',
  'small',
  'source',
  'span',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'title',
  'tr',
  'track',
  'u',
  'ul',
  'var',
  'video',
  'wbr',
])

export function AssistantMarkdownBlock({
  markdown,
  linePrefix,
}: {
  markdown: string
  linePrefix?: string
}): React.ReactNode {
  const theme = getTheme()
  const blocks = useMemo(() => parseAssistantMarkdown(markdown), [markdown])
  const refs = useMemo(() => collectReferenceLinks(markdown), [markdown])
  const ruleWidth = Math.max((process.stdout.columns || 80) - 6, 20)
  let shouldPrefix = true

  const prefixForLine = () => {
    if (!linePrefix || !shouldPrefix) return ''
    shouldPrefix = false
    return linePrefix
  }

  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => {
        if (block.kind === 'blank') return <Text key={`b-${idx}`}> </Text>

        if (block.kind === 'heading') {
          return (
            <Text key={`h-${idx}`} bold color={theme.markdown.heading}>
              {prefixForLine()}
              {renderAssistantInline(block.text, theme, refs)}
            </Text>
          )
        }

        if (block.kind === 'code') {
          return (
            <Box key={`c-${idx}`} flexDirection="column">
              {block.lines.map((line, i) => (
                <Text key={`c-${idx}-${i}`}>
                  {prefixForLine()}
                  {line.length === 0
                    ? ' '
                    : renderAssistantCodeLine(line, theme, {
                        language: block.language,
                      })}
                </Text>
              ))}
            </Box>
          )
        }

        if (block.kind === 'list') {
          return (
            <Box key={`l-${idx}`} flexDirection="column">
              {block.items.map((item, i) => (
                <Text key={`l-${idx}-${i}`}>
                  {prefixForLine()}
                  {' '.repeat(Math.min(item.indent, 12))}
                  <Text color={theme.markdown.listMarker}>{item.marker}</Text>
                  {' '}
                  {renderAssistantInline(item.text, theme, refs)}
                </Text>
              ))}
            </Box>
          )
        }

        if (block.kind === 'quote') {
          const quoteLines = normalizeQuoteRenderLines(block.lines)
          return (
            <Box key={`q-${idx}`} flexDirection="column">
              {quoteLines.map((line, i) => (
                <Box key={`q-${idx}-${i}`}>
                  <Text>
                    {prefixForLine()}
                    <Text color={theme.markdown.quoteBar}>│ </Text>
                  </Text>
                  {line.tone === 'code' ? (
                    <Text>
                      {line.text.length === 0 ? ' ' : renderAssistantCodeLine(line.text, theme)}
                    </Text>
                  ) : (
                    <Text>{line.text.length === 0 ? ' ' : renderAssistantInline(line.text, theme, refs)}</Text>
                  )}
                </Box>
              ))}
            </Box>
          )
        }

        if (block.kind === 'rule') {
          return (
            <Text key={`r-${idx}`} color={theme.markdown.rule}>
              {prefixForLine()}
              {'─'.repeat(ruleWidth)}
            </Text>
          )
        }

        if (block.kind === 'table') {
          const tableLines = formatAssistantTableLines(block.lines, refs)
          return (
            <Box key={`t-${idx}`} flexDirection="column">
              {tableLines.map((line, i) => (
                <Text key={`t-${idx}-${i}`}>
                  {prefixForLine()}
                  {line}
                </Text>
              ))}
            </Box>
          )
        }

        return (
          <Box key={`p-${idx}`} flexDirection="column">
            {block.lines.map((line, i) => (
              <Text key={`p-${idx}-${i}`}>
                {prefixForLine()}
                {renderAssistantInline(line, theme, refs)}
              </Text>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

export function parseAssistantMarkdown(raw: string): AssistantBlock[] {
  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n')
  const blocks: AssistantBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = String(lines[i] ?? '')

    if (line.trim().length === 0) {
      while (i < lines.length && String(lines[i] ?? '').trim().length === 0) i += 1
      blocks.push({ kind: 'blank' })
      continue
    }

    if (isRawHtmlTagLine(line)) {
      const htmlTextLines: string[] = []
      while (i < lines.length && isRawHtmlTagLine(String(lines[i] ?? ''))) {
        const stripped = stripInlineHtmlTags(String(lines[i] ?? '')).trim()
        if (stripped.length > 0) htmlTextLines.push(stripped)
        i += 1
      }
      if (htmlTextLines.length > 0) {
        blocks.push({ kind: 'paragraph', lines: htmlTextLines })
      } else {
        blocks.push({ kind: 'blank' })
      }
      continue
    }

    if (isFenceStart(line)) {
      const fenceInfo = parseFenceStart(line)
      i += 1
      const codeLines: string[] = []
      while (i < lines.length && !isFenceEnd(String(lines[i] ?? ''), fenceInfo)) {
        codeLines.push(String(lines[i] ?? ''))
        i += 1
      }
      if (i < lines.length && isFenceEnd(String(lines[i] ?? ''), fenceInfo)) i += 1
      blocks.push({ kind: 'code', lines: codeLines, language: fenceInfo?.language ?? null })
      continue
    }

    if (isIndentedCodeLine(line)) {
      const codeLines: string[] = []
      while (i < lines.length) {
        const cur = String(lines[i] ?? '')
        if (cur.trim().length === 0) {
          codeLines.push('')
          i += 1
          continue
        }
        if (!isIndentedCodeLine(cur)) break
        codeLines.push(stripIndentedCodePrefix(cur))
        i += 1
      }
      blocks.push({ kind: 'code', lines: codeLines })
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] || '' })
      i += 1
      continue
    }

    if (RULE_RE.test(line)) {
      blocks.push({ kind: 'rule' })
      i += 1
      continue
    }

    if (isTableStart(lines, i)) {
      const headerLine = String(lines[i] ?? '')
      const dividerLine = String(lines[i + 1] ?? '')
      const headerColumns = countTableColumns(headerLine)
      const tableLines: string[] = [headerLine, dividerLine]
      i += 2
      while (i < lines.length && isTableContinuationLine(String(lines[i] ?? ''), headerColumns)) {
        tableLines.push(String(lines[i] ?? ''))
        i += 1
      }
      blocks.push({ kind: 'table', lines: tableLines })
      continue
    }

    if (isQuoteLine(line)) {
      const quoteLines: string[] = []
      while (i < lines.length && isQuoteLine(String(lines[i] ?? ''))) {
        quoteLines.push(stripQuotePrefix(String(lines[i] ?? '')))
        i += 1
      }
      blocks.push({ kind: 'quote', lines: quoteLines })
      continue
    }

    if (isListLine(line)) {
      const items: AssistantListItem[] = []
      while (i < lines.length) {
        const cur = String(lines[i] ?? '')
        if (isRawHtmlTagLine(cur)) break
        const parsed = parseListLine(cur)
        if (!parsed) break
        items.push(parsed)
        i += 1
      }
      blocks.push({ kind: 'list', items })
      continue
    }

    const footnote = line.match(FOOTNOTE_DEF_RE)
    if (footnote) {
      blocks.push({ kind: 'paragraph', lines: [line] })
      i += 1
      continue
    }

    if (REF_DEF_RE.test(line)) {
      i += 1
      continue
    }

    const paraLines: string[] = []
    while (i < lines.length) {
      const cur = String(lines[i] ?? '')
      if (cur.trim().length === 0) break
      if (isFenceStart(cur)) break
      if (isIndentedCodeLine(cur)) break
      if (HEADING_RE.test(cur)) break
      if (RULE_RE.test(cur)) break
      if (isTableStart(lines, i)) break
      if (isQuoteLine(cur)) break
      if (isListLine(cur)) break
      if (isRawHtmlTagLine(cur)) break
      if (REF_DEF_RE.test(cur)) break
      paraLines.push(cur)
      i += 1
    }

    if (paraLines.length > 0) {
      blocks.push({ kind: 'paragraph', lines: paraLines })
      continue
    }

    i += 1
  }

  while (blocks[0]?.kind === 'blank') blocks.shift()
  while (blocks.at(-1)?.kind === 'blank') blocks.pop()
  return blocks
}

function isFenceStart(line: string): boolean {
  return FENCE_RE.test(String(line))
}

function parseFenceStart(line: string): FenceInfo | null {
  const m = String(line).match(FENCE_START_RE)
  if (!m) return null
  const marker = String(m[1] || '')
  const markerChar = marker.startsWith('~') ? '~' : '`'
  const markerLen = marker.length
  const tail = String(m[2] || '').trim()
  const languageToken = tail.length > 0 ? tail.split(/\s+/)[0] : ''
  const language = languageToken.length > 0 ? languageToken.toLowerCase() : null
  return {
    markerChar,
    markerLen,
    language,
  }
}

function isFenceEnd(line: string, opener: FenceInfo | null): boolean {
  if (!opener) return isFenceStart(line)
  const trimmed = String(line).trim()
  if (trimmed.length < opener.markerLen) return false

  const markerRe = opener.markerChar === '`' ? /^`+$/ : /^~+$/
  if (!markerRe.test(trimmed)) return false
  return trimmed.length >= opener.markerLen
}

function isIndentedCodeLine(line: string): boolean {
  return INDENTED_CODE_RE.test(String(line))
}

function stripIndentedCodePrefix(line: string): string {
  if (line.startsWith('\t')) return line.slice(1)
  if (line.startsWith('    ')) return line.slice(4)
  return line
}

function isListLine(line: string): boolean {
  return LIST_RE.test(String(line))
}

function parseListLine(line: string): AssistantListItem | null {
  const m = String(line).match(LIST_RE)
  if (!m) return null

  const indent = expandIndent(m[1] || '')
  const token = String(m[2] || '-')
  let text = String(m[3] || '')
  let marker = token

  const task = text.match(/^\[(x|X| )\]\s+(.*)$/)
  if (task) {
    marker = `[${String(task[1]).toLowerCase() === 'x' ? 'x' : ' '}]`
    text = task[2] || ''
  }

  return { indent, marker, text }
}

function isQuoteLine(line: string): boolean {
  return QUOTE_RE.test(String(line))
}

function stripQuotePrefix(line: string): string {
  let cur = String(line)
  while (true) {
    const m = cur.match(QUOTE_RE)
    if (!m) break
    cur = String(m[1] || '')
  }
  return cur
}

function isTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false
  const head = String(lines[index] ?? '').trim()
  const divider = String(lines[index + 1] ?? '').trim()
  if (!head.includes('|')) return false
  return TABLE_DIVIDER_RE.test(divider)
}

function isTableLine(line: string): boolean {
  const trimmed = String(line).trim()
  if (trimmed.length === 0) return false
  return trimmed.startsWith('|') || trimmed.endsWith('|')
}

function countTableColumns(line: string): number | null {
  const trimmed = String(line).trim()
  if (!trimmed.includes('|')) return null
  const withoutEdge = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells = withoutEdge.split('|')
  if (cells.length < 2) return null
  return cells.length
}

function isTableContinuationLine(line: string, expectedColumns: number | null): boolean {
  if (!isTableLine(line)) return false
  const columns = countTableColumns(line)
  if (columns === null) return false
  if (expectedColumns === null) return true
  return columns === expectedColumns
}

function isRawHtmlTagLine(line: string): boolean {
  const text = String(line)
  if (AUTOLINK_LINE_RE.test(text)) return false
  if (isLikelyAngleBracketPlaceholder(text)) return false
  return HTML_TAG_LINE_RE.test(text) || HTML_WRAPPED_TEXT_LINE_RE.test(text)
}

function isLikelyAngleBracketPlaceholder(line: string): boolean {
  const m = String(line).match(SIMPLE_ANGLE_TOKEN_RE)
  if (!m) return false
  const tagName = String(m[1] || '').toLowerCase()
  if (tagName.length === 0) return false
  if (tagName.includes('-')) return false
  return !KNOWN_HTML_TAGS.has(tagName)
}

function stripInlineHtmlTags(line: string): string {
  return String(line).replace(INLINE_HTML_TAG_RE, '')
}

function normalizeQuoteRenderLines(lines: string[]): QuoteRenderLine[] {
  const out: QuoteRenderLine[] = []
  let activeFence: FenceInfo | null = null

  for (const raw of lines) {
    const source = String(raw)
    const line = isRawHtmlTagLine(source) ? stripInlineHtmlTags(source) : source
    if (activeFence) {
      if (isFenceEnd(line, activeFence)) {
        activeFence = null
        continue
      }
      out.push({
        text: line,
        tone: 'code',
      })
      continue
    }

    const fenceStart = parseFenceStart(line)
    if (fenceStart) {
      activeFence = fenceStart
      continue
    }
    out.push({
      text: line,
      tone: 'text',
    })
  }

  return out.length > 0 ? out : [{ text: '', tone: 'text' }]
}

function formatAssistantTableLines(lines: string[], refs: Map<string, string>): string[] {
  const rows = lines.map((line) => parseTableCells(line, refs))
  const valid = rows.every((row) => row && row.length > 0)
  if (!valid || rows.length === 0) return lines.map((line) => normalizeAssistantInline(line, refs))

  const typedRows = rows as string[][]
  const colCount = Math.max(...typedRows.map((row) => row.length))
  const widths = Array.from({ length: colCount }, (_, col) =>
    typedRows.reduce((max, row) => Math.max(max, String(row[col] ?? '').length), 0),
  )

  return typedRows.map((row, rowIdx) => {
    if (rowIdx === 1 && isDividerRow(row)) {
      return `| ${widths.map((w) => '-'.repeat(Math.max(w, 3))).join(' | ')} |`
    }
    const padded = Array.from({ length: colCount }, (_, col) => String(row[col] ?? '').padEnd(widths[col], ' '))
    return `| ${padded.join(' | ')} |`
  })
}

function parseTableCells(line: string, refs: Map<string, string>): string[] | null {
  const raw = String(line).trim()
  if (!raw.includes('|')) return null
  const withoutEdge = raw.replace(/^\|/, '').replace(/\|$/, '')
  const cells = withoutEdge.split('|').map((cell) => normalizeAssistantInline(cell.trim(), refs))
  return cells.length > 0 ? cells : null
}

function isDividerRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(String(cell).replace(/\s+/g, '')))
}

function expandIndent(rawIndent: string): number {
  return String(rawIndent).replace(/\t/g, '  ').length
}

function collectReferenceLinks(raw: string): Map<string, string> {
  const refs = new Map<string, string>()
  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n')

  for (const line of lines) {
    const m = line.match(REF_DEF_RE)
    if (!m) continue
    const id = String(m[1] || '').trim().toLowerCase()
    let url = String(m[2] || '').trim()
    if (url.startsWith('<') && url.endsWith('>')) {
      url = url.slice(1, -1).trim()
    }
    if (!id || !url) continue
    refs.set(id, url)
  }

  return refs
}

function decodeHtmlEntities(input: string): string {
  return String(input)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function normalizeAssistantInline(raw: string, refs: Map<string, string>): string {
  let text = String(raw)

  text = text.replace(INLINE_IMAGE_LINK_RE, (_m, alt: string, url: string) => {
    const a = String(alt || '').trim()
    const u = String(url || '').trim()
    return a ? `${a} (${u})` : u
  })
  text = text.replace(INLINE_LINK_RE, '$2')
  text = text.replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (_m, label: string, id: string) => {
    const resolved = refs.get(String(id || '').trim().toLowerCase())
    return resolved || String(label || '')
  })

  text = text.replace(/<mailto:([^>\s]+)>/g, '$1')
  text = text.replace(/<(https?:\/\/[^>\s]+)>/g, '$1')

  text = decodeHtmlEntities(text)

  return text
}

function renderAssistantInline(
  text: string,
  theme: ReturnType<typeof getTheme>,
  refs: Map<string, string>,
): React.ReactNode {
  const normalized = normalizeAssistantInline(text, refs)
  const fragments = parseAssistantInlineFragments(normalized)

  return (
    <>
      {fragments.map((fragment, idx) => {
        if (fragment.kind === 'code') {
          return (
            <Text key={`c-${idx}`} bold color={theme.markdown.inlineCode}>
              {`\`${decodeHtmlEntities(fragment.text)}\``}
            </Text>
          )
        }

        return (
          <Text key={`t-${idx}`}>
            {renderAssistantTextWithLinks(fragment.text, theme, fragment)}
          </Text>
        )
      })}
    </>
  )
}

function renderAssistantCodeLine(
  line: string,
  theme: ReturnType<typeof getTheme>,
  options?: { language?: string | null },
): React.ReactNode {
  const tokens = tokenizeAssistantCodeLine(line, options)
  return (
    <>
      {tokens.map((token, idx) => {
        const color = resolveCodeToneColor(token.tone, theme)
        return (
          <Text key={`code-${idx}`} color={color}>
            {token.text}
          </Text>
        )
      })}
    </>
  )
}

function resolveCodeToneColor(
  tone: CodeTokenTone,
  theme: ReturnType<typeof getTheme>,
): string | undefined {
  if (tone === 'diffAdd') return theme.markdown.codeDiffAdd
  if (tone === 'diffDel') return theme.markdown.codeDiffDel
  if (tone === 'comment') return theme.markdown.codeComment
  if (tone === 'keyword') return theme.markdown.codeKeyword
  if (tone === 'string') return theme.markdown.codeString
  return undefined
}

export function tokenizeAssistantCodeLine(
  rawLine: string,
  options?: { language?: string | null },
): CodeToken[] {
  const line = String(rawLine)
  const language = String(options?.language || '').trim().toLowerCase()
  if (line.length === 0) return [{ tone: 'plain', text: '' }]

  const isDiffLanguage = language === 'diff'
  if (isDiffLanguage) {
    if (/^\s*\+/.test(line) && !/^\s*\+\+\+/.test(line)) {
      return [{ tone: 'diffAdd', text: line }]
    }

    if (/^\s*-/.test(line) && !/^\s*---/.test(line)) {
      return [{ tone: 'diffDel', text: line }]
    }
  }

  const commentStart = findCodeCommentStart(line, language)
  const head = commentStart < 0 ? line : line.slice(0, commentStart)
  const comment = commentStart < 0 ? '' : line.slice(commentStart)
  const tokens = tokenizeCodeWithoutComment(head, language)
  if (comment.length > 0) {
    pushCodeToken(tokens, { tone: 'comment', text: comment })
  }

  return tokens.length > 0 ? tokens : [{ tone: 'plain', text: line }]
}

function tokenizeCodeWithoutComment(line: string, language: string): CodeToken[] {
  if (line.length === 0) return []

  STRING_RE.lastIndex = 0
  const tokens: CodeToken[] = []
  let cursor = 0

  for (const match of line.matchAll(STRING_RE)) {
    const index = match.index ?? -1
    if (index < 0) continue

    if (index > cursor) {
      tokenizeCodePlainSegment(line.slice(cursor, index), tokens, language)
    }

    const text = String(match[0] || '')
    pushCodeToken(tokens, { tone: 'string', text })
    cursor = index + text.length
  }

  if (cursor < line.length) {
    tokenizeCodePlainSegment(line.slice(cursor), tokens, language)
  }

  return tokens
}

function tokenizeCodePlainSegment(
  segment: string,
  into: CodeToken[],
  language: string,
): void {
  if (segment.length === 0) return
  const keywordRe = isBashLanguage(language) ? BASH_KEYWORD_RE : CODE_KEYWORD_RE
  keywordRe.lastIndex = 0

  let cursor = 0
  for (const match of segment.matchAll(keywordRe)) {
    const index = match.index ?? -1
    if (index < 0) continue
    if (index > cursor) {
      pushCodeToken(into, { tone: 'plain', text: segment.slice(cursor, index) })
    }
    const text = String(match[0] || '')
    pushCodeToken(into, { tone: 'keyword', text })
    cursor = index + text.length
  }

  if (cursor < segment.length) {
    pushCodeToken(into, { tone: 'plain', text: segment.slice(cursor) })
  }
}

function pushCodeToken(into: CodeToken[], next: CodeToken): void {
  if (next.text.length === 0) return
  const prev = into.at(-1)
  if (prev && prev.tone === next.tone) {
    prev.text += next.text
    return
  }
  into.push({ ...next })
}

function findCodeCommentStart(line: string, language: string): number {
  if (line.length === 0) return -1

  const slashIdx = findMarkerOutsideQuotedRegions(line, '//')
  const hashIdx = findMarkerOutsideQuotedRegions(line, '#')
  if (isBashLanguage(language)) {
    return hashIdx >= 0 ? hashIdx : -1
  }

  if (language === 'python' || language === 'py') {
    return hashIdx >= 0 ? hashIdx : -1
  }

  if (slashIdx >= 0) return slashIdx
  if (/^#!/.test(line)) return 0
  return -1
}

function findMarkerOutsideQuotedRegions(line: string, marker: string): number {
  const text = String(line)
  const token = String(marker)
  if (token.length === 0) return -1

  let quote: '"' | "'" | '`' | null = null
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (!ch) break

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (ch === quote) quote = null
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }

    if (text.startsWith(token, i)) {
      return i
    }
  }

  return -1
}

function isBashLanguage(language: string): boolean {
  return language === 'bash' || language === 'sh' || language === 'zsh' || language === 'shell'
}

const DEFAULT_INLINE_STYLE: InlineStyleState = {
  bold: false,
  italic: false,
  strikethrough: false,
}

export function parseAssistantInlineFragments(input: string): InlineFragment[] {
  const text = String(input)
  const fragments: InlineFragment[] = []
  const style: InlineStyleState = { ...DEFAULT_INLINE_STYLE }
  let buffer = ''
  let i = 0

  const flushText = () => {
    if (buffer.length === 0) return
    fragments.push({ kind: 'text', text: buffer, ...style })
    buffer = ''
  }

  while (i < text.length) {
    const ch = text[i]
    if (!ch) break

    if (ch === '\\') {
      const next = text[i + 1]
      if (next && /[\\`*_{}\[\]()#+\-.!>~]/.test(next)) {
        buffer += next
        i += 2
        continue
      }
      buffer += ch
      i += 1
      continue
    }

    if (ch === '`') {
      const close = findUnescapedChar(text, '`', i + 1)
      if (close > i) {
        flushText()
        fragments.push({
          kind: 'code',
          text: text.slice(i + 1, close),
          ...style,
        })
        i = close + 1
        continue
      }
      buffer += ch
      i += 1
      continue
    }

    if (
      text.startsWith('***', i) &&
      ((style.bold && style.italic) || hasTokenAhead(text, '***', i + 3))
    ) {
      flushText()
      const enabled = !(style.bold && style.italic)
      style.bold = enabled
      style.italic = enabled
      i += 3
      continue
    }

    if (text.startsWith('**', i) && (style.bold || hasTokenAhead(text, '**', i + 2))) {
      flushText()
      style.bold = !style.bold
      i += 2
      continue
    }

    if (
      text.startsWith('~~', i) &&
      (style.strikethrough || hasTokenAhead(text, '~~', i + 2))
    ) {
      flushText()
      style.strikethrough = !style.strikethrough
      i += 2
      continue
    }

    if (ch === '*' && shouldToggleItalic(text, i, style)) {
      flushText()
      style.italic = !style.italic
      i += 1
      continue
    }

    buffer += ch
    i += 1
  }

  flushText()
  return fragments
}

function shouldToggleItalic(text: string, index: number, style: InlineStyleState): boolean {
  if (text.startsWith('**', index)) return false
  if (style.italic) return canCloseItalicAt(text, index)
  return canOpenItalicAt(text, index) && hasSingleItalicCloserAhead(text, index + 1)
}

function canOpenItalicAt(text: string, index: number): boolean {
  const next = text[index + 1] ?? ''
  if (!next || /\s/.test(next)) return false
  return true
}

function canCloseItalicAt(text: string, index: number): boolean {
  const prev = text[index - 1] ?? ''
  if (!prev || /\s/.test(prev)) return false
  return true
}

function hasSingleItalicCloserAhead(text: string, fromIndex: number): boolean {
  let cursor = fromIndex
  while (cursor < text.length) {
    const idx = text.indexOf('*', cursor)
    if (idx < 0) return false
    if (!isEscapedAt(text, idx) && !text.startsWith('**', idx) && canCloseItalicAt(text, idx)) {
      return true
    }
    cursor = idx + 1
  }
  return false
}

function hasTokenAhead(text: string, token: string, fromIndex: number): boolean {
  let cursor = fromIndex
  while (cursor < text.length) {
    const idx = text.indexOf(token, cursor)
    if (idx < 0) return false
    if (!isEscapedAt(text, idx)) return true
    cursor = idx + token.length
  }
  return false
}

function findUnescapedChar(text: string, char: string, fromIndex: number): number {
  let cursor = fromIndex
  while (cursor < text.length) {
    const idx = text.indexOf(char, cursor)
    if (idx < 0) return -1
    if (!isEscapedAt(text, idx)) return idx
    cursor = idx + 1
  }
  return -1
}

function isEscapedAt(text: string, index: number): boolean {
  let slashCount = 0
  let i = index - 1
  while (i >= 0 && text[i] === '\\') {
    slashCount += 1
    i -= 1
  }
  return slashCount % 2 === 1
}

function renderAssistantTextWithLinks(
  input: string,
  theme: ReturnType<typeof getTheme>,
  style: InlineStyleState,
): React.ReactNode {
  const text = String(input)
  URLISH_RE.lastIndex = 0
  const parts: React.ReactNode[] = []
  let cursor = 0
  let matchIdx = 0

  for (const match of text.matchAll(URLISH_RE)) {
    const index = match.index ?? -1
    if (index < 0) continue

    if (index > cursor) {
      parts.push(
        <Text
          key={`txt-${matchIdx}`}
          bold={style.bold}
          italic={style.italic}
          strikethrough={style.strikethrough}
        >
          {text.slice(cursor, index)}
        </Text>,
      )
    }

    const raw = String(match[0] || '')
    const { link, trailing } = splitTrailingPunctuation(raw)
    if (link.length > 0) {
      parts.push(
        <Text
          key={`url-${matchIdx}`}
          color={theme.markdown.link}
          underline
          bold={style.bold}
          italic={style.italic}
          strikethrough={style.strikethrough}
        >
          {link}
        </Text>,
      )
    }
    if (trailing.length > 0) {
      parts.push(
        <Text
          key={`trail-${matchIdx}`}
          bold={style.bold}
          italic={style.italic}
          strikethrough={style.strikethrough}
        >
          {trailing}
        </Text>,
      )
    }

    cursor = index + raw.length
    matchIdx += 1
  }

  if (cursor < text.length) {
    parts.push(
      <Text
        key={`tail-${matchIdx}`}
        bold={style.bold}
        italic={style.italic}
        strikethrough={style.strikethrough}
      >
        {text.slice(cursor)}
      </Text>,
    )
  }

  if (parts.length === 0) {
    return (
      <Text bold={style.bold} italic={style.italic} strikethrough={style.strikethrough}>
        {text}
      </Text>
    )
  }
  return <>{parts}</>
}

function splitTrailingPunctuation(raw: string): { link: string; trailing: string } {
  let link = String(raw)
  let trailing = ''

  while (link.length > 0) {
    const ch = link.at(-1)
    if (!ch) break
    if (!/[.,!?;:)]/.test(ch)) break

    if (ch === ')') {
      const openCount = (link.match(/\(/g) || []).length
      const closeCount = (link.match(/\)/g) || []).length
      if (closeCount <= openCount) break
    }

    trailing = ch + trailing
    link = link.slice(0, -1)
  }

  return { link, trailing }
}
