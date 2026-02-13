import { describe, expect, it } from 'vitest'
import {
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
})

