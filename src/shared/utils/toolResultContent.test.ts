import { describe, expect, it } from 'vitest'
import { toToolReferenceBlock, toolResultContentToText } from './toolResultContent'

describe('toolResultContentToText', () => {
  it('returns plain strings as-is', () => {
    expect(toolResultContentToText('ok')).toBe('ok')
  })

  it('stringifies primitive non-array values', () => {
    expect(toolResultContentToText(42 as any)).toBe('42')
    expect(toolResultContentToText(false as any)).toBe('false')
    expect(toolResultContentToText(null as any)).toBe('')
  })

  it('flattens text and tool_reference blocks', () => {
    const text = toolResultContentToText([
      { type: 'text', text: 'Loaded 1 tool(s)' },
      {
        type: 'tool_reference',
        tool_name: 'Bash',
        description: 'Execute shell command',
        input_schema: { type: 'object' },
        defer_loading: true,
      },
      { foo: 'bar' },
    ] as any)

    expect(text).toContain('Loaded 1 tool(s)')
    expect(text).toContain('Bash: Execute shell command')
    expect(text).toContain('"foo":"bar"')
  })
})

describe('toToolReferenceBlock', () => {
  it('maps tool definitions with defer_loading metadata', () => {
    expect(
      toToolReferenceBlock({
        name: 'Read',
        description: 'Read file',
        input_schema: { type: 'object' },
        defer_loading: true,
      }),
    ).toEqual({
      type: 'tool_reference',
      tool_name: 'Read',
      name: 'Read',
      description: 'Read file',
      input_schema: { type: 'object' },
      defer_loading: true,
    })
  })
})
