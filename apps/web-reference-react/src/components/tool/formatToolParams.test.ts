import { describe, expect, it } from 'vitest'
import { formatToolParams, stringifyToolParams } from './formatToolParams'

describe('formatToolParams', () => {
  it('formats bash command and cwd with stable order', () => {
    const params = formatToolParams({
      toolName: 'Bash',
      paramsText: 'command="ls -la", cwd="/repo"',
    })

    expect(params).toEqual([
      { label: 'command', value: 'ls -la', valueType: 'string' },
      { label: 'cwd', value: '/repo', valueType: 'string' },
    ])
  })

  it('parses values containing commas', () => {
    const params = formatToolParams({
      toolName: 'Bash',
      paramsText: 'command="echo \\"a, b\\"",cwd="/repo"',
    })

    expect(params[0]).toEqual({ label: 'command', value: 'echo "a, b"', valueType: 'string' })
  })

  it('maps glob aliases and keeps extra fields', () => {
    const params = formatToolParams({
      toolName: 'Glob',
      paramsText: 'glob="**/*.md", path="src", output_mode="files"',
    })

    expect(params).toEqual([
      { label: 'pattern', value: '**/*.md', valueType: 'string' },
      { label: 'path', value: 'src', valueType: 'string' },
      { label: 'output_mode', value: 'files', valueType: 'string' },
    ])
  })

  it('redacts sensitive values', () => {
    const params = formatToolParams({
      toolName: 'WebFetch',
      paramsText: 'url="https://example.com", api_key="123", token="456"',
    })

    expect(params).toEqual([
      { label: 'url', value: 'https://example.com', valueType: 'string' },
      { label: 'api_key', value: '[REDACTED]', valueType: 'string' },
      { label: 'token', value: '[REDACTED]', valueType: 'string' },
    ])
  })

  it('falls back to generic parsing for unknown tools', () => {
    const params = formatToolParams({
      toolName: 'UnknownTool',
      paramsText: 'alpha="1",beta="2"',
    })

    expect(params).toEqual([
      { label: 'alpha', value: '1', valueType: 'string' },
      { label: 'beta', value: '2', valueType: 'string' },
    ])
  })

  it('preserves empty-string params when mixed with non-empty values', () => {
    const params = formatToolParams({
      toolName: 'UnknownTool',
      paramsText: 'query="",limit=10',
    })

    expect(params).toEqual([
      { label: 'query', value: '', valueType: 'string' },
      { label: 'limit', value: '10', valueType: 'json' },
    ])
  })

  it('preserves empty-string params for known tool mappings', () => {
    const params = formatToolParams({
      toolName: 'WebSearch',
      paramsText: 'query=""',
    })

    expect(params).toEqual([{ label: 'query', value: '', valueType: 'string' }])
  })

  it('maps task prompt to description when description is absent', () => {
    const params = formatToolParams({
      toolName: 'Task',
      paramsText: 'subagent_type="planner", prompt="break down work"',
    })

    expect(params).toEqual([
      { label: 'subagent_type', value: 'planner', valueType: 'string' },
      { label: 'description', value: 'break down work', valueType: 'string' },
    ])
  })

  it('maps ask question and todo list payload keys', () => {
    const ask = formatToolParams({
      toolName: 'AskUserQuestion',
      paramsText: 'questions=[{"id":"q1"},{"id":"q2"}]',
    })
    const todo = formatToolParams({
      toolName: 'TodoWrite',
      paramsText: 'todos=[{"content":"a"},{"content":"b"},{"content":"c"}]',
    })

    expect(ask).toEqual([
      { label: 'questions', value: '[{"id":"q1"},{"id":"q2"}]', valueType: 'json' },
    ])
    expect(todo).toEqual([
      { label: 'todos', value: '[{"content":"a"},{"content":"b"},{"content":"c"}]', valueType: 'json' },
    ])
  })
})

describe('stringifyToolParams', () => {
  it('returns undefined for empty params', () => {
    expect(stringifyToolParams([])).toBeUndefined()
  })

  it('truncates long rendered text', () => {
    const veryLong = 'x'.repeat(300)
    const text = stringifyToolParams([{ label: 'command', value: veryLong, valueType: 'string' }])
    expect(text).toBeDefined()
    expect(text!.length).toBeLessThanOrEqual(180)
    expect(text!.endsWith('...')).toBe(true)
  })

  it('keeps object and array values as readable json fragments', () => {
    const text = stringifyToolParams([
      { label: 'paths', value: '[\"a\",\"b\"]', valueType: 'json' },
      { label: 'payload', value: '{\"dryRun\":true}', valueType: 'json' },
    ])

    expect(text).toContain('paths=["a","b"]')
    expect(text).toContain('payload={"dryRun":true}')
  })

  it('keeps numeric-looking strings quoted', () => {
    const text = stringifyToolParams([{ label: 'id', value: '123', valueType: 'string' }])
    expect(text).toBe('id=\"123\"')
  })

  it('keeps unparseable json-like fragments unescaped', () => {
    const params = formatToolParams({
      toolName: 'UnknownTool',
      paramsText: 'payload={\"alpha\":1...',
    })

    expect(params).toEqual([{ label: 'payload', value: '{\"alpha\":1...', valueType: 'json' }])
    expect(stringifyToolParams(params)).toBe('payload={\"alpha\":1...')
  })
})
