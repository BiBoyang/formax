import { describe, expect, it } from 'vitest'
import { findSnippetStartLineNumber } from '../../components/tool/snippetStartLine'

describe('findSnippetStartLineNumber', () => {
  it('returns null for empty snippet after trimming trailing blank lines', () => {
    expect(findSnippetStartLineNumber({ fileText: 'a\n', snippet: '\n\n' })).toBeNull()
  })

  it('finds exact multi-line snippet and returns 1-based start line', () => {
    const fileText = ['one', 'two', 'three', 'four'].join('\n')
    const snippet = ['two', 'three'].join('\n')
    expect(findSnippetStartLineNumber({ fileText, snippet })).toBe(2)
  })

  it('normalizes CRLF/CR newlines on both inputs', () => {
    const fileText = 'a\r\nb\r\nc\n'
    const snippet = 'b\nc\n'
    expect(findSnippetStartLineNumber({ fileText, snippet })).toBe(2)
  })

  it('tolerates leading/trailing whitespace differences', () => {
    const fileText = ['\t alpha   ', '  beta', 'gamma'].join('\n')
    const snippet = ['alpha', 'beta'].join('\n')
    expect(findSnippetStartLineNumber({ fileText, snippet })).toBe(1)
  })

  it('returns null when snippet does not exist', () => {
    const fileText = ['a', 'b', 'c'].join('\n')
    const snippet = ['x', 'y'].join('\n')
    expect(findSnippetStartLineNumber({ fileText, snippet })).toBeNull()
  })
})
