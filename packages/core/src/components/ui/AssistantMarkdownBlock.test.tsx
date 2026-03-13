import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { Box } from 'ink'
import {
  AssistantMarkdownBlock,
  parseAssistantInlineFragments,
  parseAssistantMarkdown,
  tokenizeAssistantCodeLine,
} from './AssistantMarkdownBlock'

function renderFrame(node: React.ReactElement): string {
  const view = render(node)
  const frame = view.lastFrame() ?? ''
  view.unmount()
  return frame
}

describe('components/ui/AssistantMarkdownBlock', () => {
  it('renders headings without markdown heading markers', () => {
    const frame = renderFrame(<AssistantMarkdownBlock markdown={'# Title\n## Subtitle'} />)
    expect(frame).toContain('Title')
    expect(frame).toContain('Subtitle')
    expect(frame).not.toContain('# Title')
    expect(frame).not.toContain('## Subtitle')
  })

  it('renders inline styles and links in assistant-friendly plain form', () => {
    const markdown = [
      '- **Bold** with `code`',
      '- Link: [OpenAI](https://openai.com)',
      '- Ref: [Repository docs][docs-ref]',
      '[docs-ref]: https://github.com',
    ].join('\n')

    const frame = renderFrame(<AssistantMarkdownBlock markdown={markdown} />)

    expect(frame).toContain('Bold with `code`')
    expect(frame).toContain('https://openai.com')
    expect(frame).toContain('https://github.com')
    expect(frame).not.toContain('[OpenAI](')
    expect(frame).not.toContain('**Bold**')
    expect(frame).toContain('`code`')
    expect(frame).not.toContain('[docs-ref]:')
  })

  it('resolves reference links when definitions include optional titles', () => {
    const markdown = ['[Docs][docs-ref]', '[docs-ref]: https://example.com/docs "Documentation"'].join('\n')
    const frame = renderFrame(<AssistantMarkdownBlock markdown={markdown} />)
    expect(frame).toContain('https://example.com/docs')
    expect(frame).not.toContain('[docs-ref]:')
  })

  it('keeps parenthesized urls intact in markdown inline links', () => {
    const frame = renderFrame(
      <AssistantMarkdownBlock markdown={'[wiki](https://en.wikipedia.org/wiki/Function_(mathematics))'} />,
    )
    expect(frame).toContain('https://en.wikipedia.org/wiki/Function_(mathematics)')
  })

  it('keeps trailing punctuation outside urls while preserving visible text', () => {
    const frame = renderFrame(
      <AssistantMarkdownBlock markdown={'Wrap test: https://example.com/path(a)). Next: test@example.org.'} />,
    )

    expect(frame).toContain('Wrap test: https://example.com/path(a)). Next: test@example.org.')
  })

  it('renders standalone autolink lines instead of dropping them as html', () => {
    const frame = renderFrame(<AssistantMarkdownBlock markdown={'<https://example.com>\n<mailto:test@example.org>'} />)
    expect(frame).toContain('https://example.com')
    expect(frame).toContain('test@example.org')
  })

  it('preserves escaped markdown marker characters as literals', () => {
    const frame = renderFrame(
      <AssistantMarkdownBlock
        markdown={'Escaped markdown characters: \\*literal asterisk\\*, \\_literal underscore\\_, \\`literal backtick\\`.'}
      />,
    )

    expect(frame).toContain('Escaped markdown characters: *literal asterisk*, _literal underscore_, `literal backtick`.')
  })

  it('preserves trailing backslashes in inline text', () => {
    const frame = renderFrame(
      <AssistantMarkdownBlock markdown={'This line uses a trailing backslash for a hard break.\\\nNext line'} />,
    )

    expect(frame).toContain('This line uses a trailing backslash for a hard break.\\')
    expect(frame).toContain('Next line')
  })

  it('renders ordered list, task list, and blockquotes', () => {
    const markdown = [
      '1. First item',
      '2. Second item',
      '- [x] Done item',
      '- [ ] Pending item',
      '> Quoted line',
    ].join('\n')

    const frame = renderFrame(<AssistantMarkdownBlock markdown={markdown} />)

    expect(frame).toContain('1. First item')
    expect(frame).toContain('2. Second item')
    expect(frame).toContain('[x] Done item')
    expect(frame).toContain('[ ] Pending item')
    expect(frame).toContain('│ Quoted line')
  })

  it('renders fenced code without fence markers', () => {
    const markdown = ['```ts', 'const x = 1', '```'].join('\n')
    const frame = renderFrame(<AssistantMarkdownBlock markdown={markdown} />)

    expect(frame).toContain('const x = 1')
    expect(frame).not.toContain('```')
  })

  it('uses the assistant line prefix only once on the first rendered line', () => {
    const frame = renderFrame(<AssistantMarkdownBlock markdown={'first line\nsecond line'} linePrefix={'⏺ '} />)
    expect(frame).toContain('⏺ first line')
    expect(frame).toContain('second line')
    expect(frame).not.toContain('⏺ second line')
  })

  it('renders nested quoted code fences without quote fence markers', () => {
    const markdown = ['> ```ts', '> const inside = 1', '> ```'].join('\n')
    const frame = renderFrame(<AssistantMarkdownBlock markdown={markdown} />)
    expect(frame).toContain('│ const inside = 1')
    expect(frame).not.toContain('```')
  })

  it('preserves quoted autolinks and angle-bracket placeholders', () => {
    const markdown = ['> <https://example.com>', '> <T>'].join('\n')
    const frame = renderFrame(<AssistantMarkdownBlock markdown={markdown} />)
    expect(frame).toContain('│ https://example.com')
    expect(frame).toContain('│ <T>')
  })

  it('renders image markdown and decodes html entities', () => {
    const markdown = [
      '![Sample image](https://picsum.photos/320/120)',
      '- `&lt;div&gt;` and `&amp;`',
      '- `&lt;div&gt;` should display as `<div>` if entity decoding is applied.',
    ].join('\n')
    const frame = renderFrame(<AssistantMarkdownBlock markdown={markdown} />)

    expect(frame).toContain('Sample image (https://picsum.photos/320/120)')
    expect(frame).toContain('`<div>`')
    expect(frame).toContain('`&`')
    expect(frame).toContain('should display as `<div>`')
  })

  it('strips raw html tags into safe text fallbacks', () => {
    const markdown = ['<details>', '<summary>Click to expand</summary>', '<p>Inner text</p>', '</details>'].join('\n')
    const frame = renderFrame(<AssistantMarkdownBlock markdown={markdown} />)
    expect(frame).toContain('Click to expand')
    expect(frame).toContain('Inner text')
    expect(frame).not.toContain('<details>')
    expect(frame).not.toContain('<summary>')
    expect(frame).not.toContain('<p>')
  })

  it('preserves standalone angle-bracket placeholders as plain text', () => {
    const markdown = ['<T>', '<placeholder>', '</placeholder>'].join('\n')
    const frame = renderFrame(<AssistantMarkdownBlock markdown={markdown} />)
    expect(frame).toContain('<T>')
    expect(frame).toContain('<placeholder>')
    expect(frame).toContain('</placeholder>')
  })

  it('parseAssistantMarkdown detects mixed block kinds', () => {
    const blocks = parseAssistantMarkdown(
      [
        '# Title',
        '',
        '1. First',
        '> quote',
        '',
        '---',
        '',
        '| A | B |',
        '| --- | --- |',
      ].join('\n'),
    )

    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'blank', 'list', 'quote', 'blank', 'rule', 'blank', 'table'])
  })

  it('parses outer fenced blocks that contain inner triple-backtick literals', () => {
    const blocks = parseAssistantMarkdown(['````', '```ts', 'const x = 1', '```', '````'].join('\n'))

    expect(blocks).toEqual([
      {
        kind: 'code',
        language: null,
        lines: ['```ts', 'const x = 1', '```'],
      },
    ])
  })

  it('parses four-space-indented triple-backtick lines as indented code', () => {
    const blocks = parseAssistantMarkdown(['    ```', '    const example = true', '    ```'].join('\n'))
    expect(blocks).toEqual([
      {
        kind: 'code',
        lines: ['```', 'const example = true', '```'],
      },
    ])
  })

  it('formats markdown tables into padded plain-text rows', () => {
    const frame = renderFrame(
      <AssistantMarkdownBlock markdown={['| A | B |', '| --- | ---: |', '| left | 123 |'].join('\n')} />,
    )

    expect(frame).toContain('| A')
    expect(frame).toContain('| left')
    expect(frame).not.toContain('| --- | ---: |')
  })

  it('does not absorb prose lines with pipes into a preceding table block', () => {
    const blocks = parseAssistantMarkdown(['| A | B |', '| --- | --- |', 'Use a | b operator'].join('\n'))
    expect(blocks).toEqual([
      { kind: 'table', lines: ['| A | B |', '| --- | --- |'] },
      { kind: 'paragraph', lines: ['Use a | b operator'] },
    ])
  })

  it('keeps block nodes vertically stacked when nested in a row container', () => {
    const frame = renderFrame(
      <Box>
        <AssistantMarkdownBlock markdown={['# A', '', 'B', '', '- C'].join('\n')} />
      </Box>,
    )

    const lines = frame.split('\n')
    const headingLine = lines.findIndex((line) => line.includes('A'))
    const paragraphLine = lines.findIndex((line) => line.includes('B'))
    const listLine = lines.findIndex((line) => line.includes('- C'))

    expect(headingLine).toBeGreaterThanOrEqual(0)
    expect(paragraphLine).toBeGreaterThan(headingLine)
    expect(listLine).toBeGreaterThan(paragraphLine)
  })

  it('tokenizes diff lines in code blocks', () => {
    const add = tokenizeAssistantCodeLine('+ new line', { language: 'diff' })
    const del = tokenizeAssistantCodeLine('- old line', { language: 'diff' })
    expect(add).toEqual([{ tone: 'diffAdd', text: '+ new line' }])
    expect(del).toEqual([{ tone: 'diffDel', text: '- old line' }])
  })

  it('does not diff-highlight plus/minus lines outside diff fences', () => {
    const minus = tokenizeAssistantCodeLine('-n')
    const plus = tokenizeAssistantCodeLine('+x')
    expect(minus).toEqual([{ tone: 'plain', text: '-n' }])
    expect(plus).toEqual([{ tone: 'plain', text: '+x' }])
  })

  it('tokenizes keywords strings and comments in ts code lines', () => {
    const tokens = tokenizeAssistantCodeLine(`const name = "demo" // trailing`, { language: 'ts' })
    expect(tokens).toEqual([
      { tone: 'keyword', text: 'const' },
      { tone: 'plain', text: ' name = ' },
      { tone: 'string', text: '"demo"' },
      { tone: 'plain', text: ' ' },
      { tone: 'comment', text: '// trailing' },
    ])
  })

  it('tokenizes bash commands and comments in shell code lines', () => {
    const tokens = tokenizeAssistantCodeLine('echo "hello" # comment', { language: 'bash' })
    expect(tokens).toEqual([
      { tone: 'keyword', text: 'echo' },
      { tone: 'plain', text: ' ' },
      { tone: 'string', text: '"hello"' },
      { tone: 'plain', text: ' ' },
      { tone: 'comment', text: '# comment' },
    ])
  })

  it('does not treat // inside strings as comment starts', () => {
    const tokens = tokenizeAssistantCodeLine(`const api = "https://example.com"`, { language: 'ts' })
    expect(tokens).toEqual([
      { tone: 'keyword', text: 'const' },
      { tone: 'plain', text: ' api = ' },
      { tone: 'string', text: '"https://example.com"' },
    ])
  })

  it('does not treat # inside quoted bash strings as comment starts', () => {
    const tokens = tokenizeAssistantCodeLine(`echo "a#b" # comment`, { language: 'bash' })
    expect(tokens).toEqual([
      { tone: 'keyword', text: 'echo' },
      { tone: 'plain', text: ' ' },
      { tone: 'string', text: '"a#b"' },
      { tone: 'plain', text: ' ' },
      { tone: 'comment', text: '# comment' },
    ])
  })

  it('parses emphasis fragments around inline code spans', () => {
    const fragments = parseAssistantInlineFragments('Mixed: **bold with `inline code` inside**')
    expect(fragments).toEqual([
      { kind: 'text', text: 'Mixed: ', bold: false, italic: false, strikethrough: false },
      { kind: 'text', text: 'bold with ', bold: true, italic: false, strikethrough: false },
      { kind: 'code', text: 'inline code', bold: true, italic: false, strikethrough: false },
      { kind: 'text', text: ' inside', bold: true, italic: false, strikethrough: false },
    ])
  })

  it('keeps literal asterisks when they are not markdown emphasis delimiters', () => {
    const fragments = parseAssistantInlineFragments('math: a * b * c')
    expect(fragments).toEqual([{ kind: 'text', text: 'math: a * b * c', bold: false, italic: false, strikethrough: false }])
  })
})
