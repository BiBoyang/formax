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

  it('orders params by tool semantics with fallback keys', () => {
    const parsed = parseToolParamsText('path="README.md", replacement="x", old_string="y"')
    const ordered = orderToolParamsByToolName('Edit', parsed)
    expect(ordered[0]).toEqual({ label: 'file', value: 'README.md', valueType: 'string' })
    expect(ordered[1]).toEqual({ label: 'replacement', value: 'x', valueType: 'string' })
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
})
