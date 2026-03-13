import { describe, expect, it } from 'vitest'
import {
  formatToolInputAsParamsText,
  orderToolParamsByToolName,
  parseJsonArrayLength,
  parseToolParamsText,
  stringifyToolParams,
} from './paramsText'

describe('paramsText presentation helpers', () => {
  it('parses key-value pairs with json payloads', () => {
    const parsed = parseToolParamsText('pattern="foo", path="src", todos=[{"content":"a"}]')
    expect(parsed).toEqual([
      { label: 'pattern', value: 'foo', valueType: 'string' },
      { label: 'path', value: 'src', valueType: 'string' },
      { label: 'todos', value: '[{"content":"a"}]', valueType: 'json' },
    ])
  })

  it('handles non-json raw values and malformed json-like values', () => {
    const parsed = parseToolParamsText('name=plain, payload={oops')
    expect(parsed).toEqual([
      { label: 'name', value: 'plain', valueType: 'string' },
      { label: 'payload', value: '{oops', valueType: 'json' },
    ])
  })

  it('parses escaped characters inside quoted values', () => {
    const parsed = parseToolParamsText('command="echo \\"a\\\\b\\"", path="src"')
    expect(parsed).toEqual([
      { label: 'command', value: 'echo "a\\b"', valueType: 'string' },
      { label: 'path', value: 'src', valueType: 'string' },
    ])
  })

  it('redacts secret-like keys', () => {
    const parsed = parseToolParamsText('api_key="abcd", token="efgh"')
    expect(parsed).toEqual([
      { label: 'api_key', value: '[REDACTED]', valueType: 'string' },
      { label: 'token', value: '[REDACTED]', valueType: 'string' },
    ])
  })

  it('parses json object params text for replay backward compatibility', () => {
    const parsed = parseToolParamsText('{"command":"ls -la","cwd":"/repo"}')
    expect(parsed).toEqual([
      { label: 'command', value: 'ls -la', valueType: 'string' },
      { label: 'cwd', value: '/repo', valueType: 'string' },
    ])
  })

  it('redacts secret-like keys in json object params text', () => {
    const parsed = parseToolParamsText('{"api_key":"abcd","query":"hello"}')
    expect(parsed).toEqual([
      { label: 'api_key', value: '[REDACTED]', valueType: 'string' },
      { label: 'query', value: 'hello', valueType: 'string' },
    ])
  })

  it('falls back when json object params text is malformed', () => {
    const parsed = parseToolParamsText('{oops}')
    expect(parsed).toEqual([])
  })

  it('orders params by tool semantics with fallback keys', () => {
    const parsed = parseToolParamsText('path="README.md", replacement="x", old_string="y"')
    const ordered = orderToolParamsByToolName('Edit', parsed)
    expect(ordered[0]).toEqual({ label: 'file', value: 'README.md', valueType: 'string' })
    expect(ordered[1]).toEqual({ label: 'replacement', value: 'x', valueType: 'string' })
  })

  it('preserves params when tool-specific preferred keys are missing', () => {
    const parsed = parseToolParamsText('cwd="/repo", replacement="x"')
    const ordered = orderToolParamsByToolName('Bash', parsed)
    expect(ordered).toEqual(parsed)
  })

  it('stringifies with json for structured params', () => {
    const text = stringifyToolParams([
      { label: 'query', value: 'hello world', valueType: 'string' },
      { label: 'todos', value: '[{"content":"a"}]', valueType: 'json' },
    ])
    expect(text).toBe('query="hello world", todos=[{"content":"a"}]')
  })

  it('extracts json array lengths', () => {
    expect(parseJsonArrayLength('[1,2,3]')).toBe(3)
    expect(parseJsonArrayLength('{"a":1}')).toBeNull()
    expect(parseJsonArrayLength('not-json')).toBeNull()
  })

  it('formats tool input objects into parseable params text', () => {
    const text = formatToolInputAsParamsText({
      command: 'echo hello',
      cwd: '/repo',
      token: 'secret',
    })

    expect(text).toBe('command="echo hello", cwd="/repo", token="[REDACTED]"')

    const reparsed = parseToolParamsText(text)
    expect(reparsed).toEqual([
      { label: 'command', value: 'echo hello', valueType: 'string' },
      { label: 'cwd', value: '/repo', valueType: 'string' },
      { label: 'token', value: '[REDACTED]', valueType: 'string' },
    ])
  })

  it('orders params for all tool-specific branches and preserves unknowns', () => {
    const parsed = parseToolParamsText(
      'command="ls", cwd="/repo", pattern="foo", glob="**/*.ts", path="src", output_mode="content", file_path="README.md", query="q", url="https://x", subagent_type="Explore", prompt="do it", questions="[]", todos="[]"',
    )

    expect(orderToolParamsByToolName('Bash', parsed)[0]?.label).toBe('command')
    expect(orderToolParamsByToolName('Glob', parsed)[0]?.label).toBe('pattern')
    expect(orderToolParamsByToolName('Grep', parsed)[2]?.label).toBe('output_mode')
    expect(orderToolParamsByToolName('Search', parsed)[0]?.label).toBe('pattern')
    expect(orderToolParamsByToolName('Read', parsed)[0]?.label).toBe('file')
    expect(orderToolParamsByToolName('Write', parsed)[0]?.label).toBe('file')
    expect(orderToolParamsByToolName('WebSearch', parsed)[0]?.label).toBe('query')
    expect(orderToolParamsByToolName('WebFetch', parsed)[0]?.label).toBe('url')
    expect(orderToolParamsByToolName('Task', parsed)[1]?.label).toBe('description')
    expect(orderToolParamsByToolName('AskUserQuestion', parsed)[0]?.label).toBe('questions')
    expect(orderToolParamsByToolName('TodoWrite', parsed)[0]?.label).toBe('todos')
    expect(orderToolParamsByToolName('UnknownTool', parsed).length).toBe(parsed.length)
  })

  it('handles stringify/format edge cases and truncation options', () => {
    expect(stringifyToolParams([])).toBeUndefined()

    const truncated = stringifyToolParams([{ label: 'x', value: 'abcdefg', valueType: 'string' }], 10)
    expect(truncated).toBe('x="abcd...')

    expect(formatToolInputAsParamsText(null)).toBeUndefined()
    expect(formatToolInputAsParamsText([])).toBeUndefined()
    expect(formatToolInputAsParamsText({})).toBeUndefined()

    const shortJson = formatToolInputAsParamsText({ payload: { a: 1 } })
    expect(shortJson).toBe('payload={"a":1}')

    const jsonTruncated = formatToolInputAsParamsText(
      { payload: { a: 'x'.repeat(5000) } },
      { maxJsonLength: 50, maxParams: 1 },
    )
    expect(jsonTruncated).toContain('{"truncated":true}')

    const stringTruncated = formatToolInputAsParamsText(
      { long: 'x'.repeat(100), secret_key: 'abc' },
      { maxStringLength: 10, maxParams: 2 },
    )
    expect(stringTruncated).toContain('long="xxxxxxx..."')
    expect(stringTruncated).toContain('secret_key="[REDACTED]"')
  })

  it('covers boundary inputs for parse/order/stringify helpers', () => {
    expect(parseToolParamsText(undefined)).toEqual([])
    expect(parseToolParamsText('[1,2,3]')).toEqual([])
    expect(parseToolParamsText('=value, ok=1')).toEqual([{ label: 'ok', value: '1', valueType: 'json' }])
    expect(orderToolParamsByToolName('Bash', [])).toEqual([])
    expect(
      stringifyToolParams([
        { label: ' ', value: '', valueType: 'string' },
        { label: '', value: '', valueType: 'string' },
      ]),
    ).toBe('="", =""')
  })

  it('covers empty tokens and empty raw values in pair parsing', () => {
    expect(parseToolParamsText('a=1,, b=2,')).toEqual([
      { label: 'a', value: '1', valueType: 'json' },
      { label: 'b', value: '2', valueType: 'json' },
    ])
    expect(parseToolParamsText('value=   ')).toEqual([{ label: 'value', value: '', valueType: 'string' }])
    expect(parseToolParamsText('   =x, ok=1')).toEqual([{ label: 'ok', value: '1', valueType: 'json' }])
  })

  it('formats undefined object values as empty strings', () => {
    expect(formatToolInputAsParamsText({ value: undefined }, { maxParams: 1 })).toBe('value=""')
  })
})
