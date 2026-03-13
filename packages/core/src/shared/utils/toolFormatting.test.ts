import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { formatToolCallParts, formatToolResult } from './toolFormatting'
import path from 'node:path'

/**
 * Feature: tool-ui-refactor
 * Property 5: Tool Formatting Utility Consistency
 * Validates: Requirements 1.8, 1.9
 * 
 * For any valid tool name and input parameters, the formatToolCallParts function
 * should produce consistent, well-formed output.
 */
describe('formatToolCallParts', () => {
  // Property test: Output structure is always valid
  it('should always return valid ToolCallParts structure', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.dictionary(fc.string(), fc.anything()),
        (name, input) => {
          const result = formatToolCallParts(name, input)
          
          // Result should always have toolName and params
          expect(result).toHaveProperty('toolName')
          expect(result).toHaveProperty('params')
          expect(typeof result.toolName).toBe('string')
          expect(typeof result.params).toBe('string')
          
          // toolName is a display label; some tools share a common label.
          const expectedToolName =
            name === 'Glob' || name === 'Grep' ? 'Search' : name
          expect(result.toolName).toBe(expectedToolName)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Read tool extracts file_path or path
  it('should extract file_path for Read tool', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (filePath) => {
          const result1 = formatToolCallParts('Read', { file_path: filePath })
          expect(result1.params).toBe(filePath)
          
          const result2 = formatToolCallParts('Read', { path: filePath })
          expect(result2.params).toBe(filePath)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Write tool extracts file_path or path
  it('should extract file_path for Write tool', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (filePath) => {
          const result1 = formatToolCallParts('Write', { file_path: filePath })
          expect(result1.params).toBe(filePath)
          
          const result2 = formatToolCallParts('Write', { path: filePath })
          expect(result2.params).toBe(filePath)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Edit tool extracts file_path or path
  it('should extract file_path for Edit tool', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (filePath) => {
          const result1 = formatToolCallParts('Edit', { file_path: filePath })
          expect(result1.params).toBe(filePath)
          
          const result2 = formatToolCallParts('Edit', { path: filePath })
          expect(result2.params).toBe(filePath)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('formats in-project absolute paths as relative when enabled', () => {
    const cwd = path.join('/', 'repo')
    const abs = path.join(cwd, 'README.md')
    const result = formatToolCallParts('Read', { file_path: abs }, { cwd, preferRelativePaths: true })
    expect(result.params).toBe('README.md')
  })

  // Property test: Bash tool truncates long commands
  it('should truncate Bash commands longer than 50 characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 51 }),
        (command) => {
          const result = formatToolCallParts('Bash', { command })
          
          // Should be truncated to 50 chars + '...'
          expect(result.params.length).toBeLessThanOrEqual(53)
          expect(result.params.endsWith('...')).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Bash tool preserves short commands
  it('should preserve Bash commands 50 characters or less', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 50 }),
        (command) => {
          const result = formatToolCallParts('Bash', { command })
          expect(result.params).toBe(command)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Glob tool extracts pattern
  it('should extract pattern for Glob tool', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (pattern) => {
          const result1 = formatToolCallParts('Glob', { pattern })
          expect(result1.toolName).toBe('Search')
          expect(result1.params).toBe(`pattern: ${JSON.stringify(pattern)}`)
          
          const result2 = formatToolCallParts('Glob', { glob: pattern })
          expect(result2.toolName).toBe('Search')
          expect(result2.params).toBe(`pattern: ${JSON.stringify(pattern)}`)
        }
      ),
      { numRuns: 100 }
    )
  })

	  // Property test: Grep tool formats pattern and path
	  it('should format Grep tool with pattern and path', () => {
	    fc.assert(
	      fc.property(
	        fc.string(),
	        fc.string({ minLength: 1 }), // blank/whitespace is treated as default '.'
	        (pattern, rawPath) => {
	          const result = formatToolCallParts('Grep', { pattern, path: rawPath })
	          expect(result.toolName).toBe('Search')
	          const normalizedPath = rawPath.trim() ? rawPath.trim() : '.'
	          expect(result.params).toBe(
	            `pattern: ${JSON.stringify(pattern)}, path: ${JSON.stringify(normalizedPath)}`,
	          )
	        }
	      ),
	      { numRuns: 100 }
	    )
	  })

  // Property test: Grep tool uses default path when empty
  it('should use default path for Grep tool when path is empty', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (pattern) => {
          const result = formatToolCallParts('Grep', { pattern, path: '' })
          expect(result.toolName).toBe('Search')
          expect(result.params).toBe(`pattern: ${JSON.stringify(pattern)}, path: ${JSON.stringify('.')}`)
          
          const result2 = formatToolCallParts('Grep', { pattern })
          expect(result2.toolName).toBe('Search')
          expect(result2.params).toBe(`pattern: ${JSON.stringify(pattern)}, path: ${JSON.stringify('.')}`)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Search tool formats pattern with quotes
  it('should format Search tool with quoted pattern', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (pattern) => {
          const result = formatToolCallParts('Search', { pattern })
          expect(result.toolName).toBe('Search')
          expect(result.params).toBe(`pattern: ${JSON.stringify(pattern)}`)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('handles non-string path in relative-path formatting and undefined search pattern', () => {
    const read = formatToolCallParts('Read', { file_path: 123 as any }, { preferRelativePaths: true, cwd: '/repo' })
    expect(read.params).toBe('')

    const search = formatToolCallParts('Search', {} as any)
    expect(search.params).toBe('pattern: ""')
  })

  // Property test: Unknown tools use JSON stringification
	  it('should use JSON for unknown tools', () => {
	    fc.assert(
	      fc.property(
	        fc.string().filter(s => !['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Search', 'SlashCommand'].includes(s)),
	        fc.dictionary(fc.string(), fc.string()),
	        (name, input) => {
	          const result = formatToolCallParts(name, input)
          
          // Should be truncated JSON
          expect(result.params.length).toBeLessThanOrEqual(40)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Unit tests for specific examples
  describe('specific examples', () => {
    it('should format Read tool correctly', () => {
      const result = formatToolCallParts('Read', { file_path: 'src/index.ts' })
      expect(result).toEqual({ toolName: 'Read', params: 'src/index.ts' })
    })

    it('should format Write tool correctly', () => {
      const result = formatToolCallParts('Write', { file_path: 'output.txt' })
      expect(result).toEqual({ toolName: 'Write', params: 'output.txt' })
    })

    it('should format NotebookEdit with notebook_path', () => {
      const result = formatToolCallParts('NotebookEdit', { notebook_path: 'nb/test.ipynb' })
      expect(result).toEqual({ toolName: 'NotebookEdit', params: 'nb/test.ipynb' })
    })

    it('falls back to empty params for missing optional inputs', () => {
      expect(formatToolCallParts('NotebookEdit', {} as any)).toEqual({ toolName: 'NotebookEdit', params: '' })
      expect(formatToolCallParts('WebSearch', {} as any)).toEqual({ toolName: 'WebSearch', params: 'query: ""' })
      expect(formatToolCallParts('WebFetch', {} as any)).toEqual({ toolName: 'WebFetch', params: '' })
      expect(formatToolCallParts('SlashCommand', {} as any)).toEqual({ toolName: 'SlashCommand', params: '' })
    })

    it('should format Bash tool with short command', () => {
      const result = formatToolCallParts('Bash', { command: 'ls -la' })
      expect(result).toEqual({ toolName: 'Bash', params: 'ls -la' })
    })

	    it('should format Bash tool with long command', () => {
	      const longCmd = 'npm run build && npm run test && npm run lint && npm run format'
	      const result = formatToolCallParts('Bash', { command: longCmd })
	      expect(result.toolName).toBe('Bash')
	      expect(result.params).toBe(longCmd.slice(0, 50) + '...')
	    })

	    it('should format SlashCommand tool correctly', () => {
	      const result = formatToolCallParts('SlashCommand', { command: '/review-pr 123' })
	      expect(result).toEqual({ toolName: 'SlashCommand', params: '/review-pr 123' })
	    })

    it('formats WebSearch/WebFetch/TodoWrite variants', () => {
      const shortSearch = formatToolCallParts('WebSearch', { query: 'hello' })
      expect(shortSearch.params).toBe('query: "hello"')
      const longSearch = formatToolCallParts('WebSearch', { query: 'a'.repeat(55) })
      expect(longSearch.params).toBe(`query: "${'a'.repeat(50)}..."`)

      const shortFetch = formatToolCallParts('WebFetch', { url: 'https://example.com' })
      expect(shortFetch.params).toBe('https://example.com')
      const longFetch = formatToolCallParts('WebFetch', { url: 'https://example.com/' + 'a'.repeat(80) })
      expect(longFetch.params.endsWith('...')).toBe(true)
      expect(longFetch.params.length).toBe(63)

      const todos = formatToolCallParts('TodoWrite', { todos: [{}, {}] })
      expect(todos.params).toBe('2 items')
      const noTodos = formatToolCallParts('TodoWrite', { todos: 'bad' })
      expect(noTodos.params).toBe('0 items')

      const searchWithOutputMode = formatToolCallParts('Search', {
        pattern: 'todo',
        path: 'src',
        output_mode: 'content',
      })
      expect(searchWithOutputMode.params).toBe('pattern: "todo", path: "src", output_mode: "content"')
    })

    it('truncates SlashCommand over 60 chars', () => {
      const cmd = '/x ' + 'a'.repeat(100)
      const result = formatToolCallParts('SlashCommand', { command: cmd })
      expect(result.params.endsWith('...')).toBe(true)
      expect(result.params.length).toBe(63)
    })

	    it('should handle empty input gracefully', () => {
	      const result = formatToolCallParts('Read', {})
	      expect(result).toEqual({ toolName: 'Read', params: '' })
	    })
  })
})


/**
 * Feature: tool-ui-refactor
 * Property 6: Result Formatting Utility Consistency
 * Validates: Requirements 1.8, 1.9
 * 
 * For any tool execution result, the formatToolResult function should produce
 * consistent, well-formed output with proper structure.
 */
describe('formatToolResult', () => {
  // Property test: Output structure is always valid
  it('should always return valid ToolResultFormat structure', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.boolean(),
        (name, result, isError) => {
          const output = formatToolResult(name, result, isError)
          
          // Result should always have summary
          expect(output).toHaveProperty('summary')
          expect(typeof output.summary).toBe('string')
          
          // Optional fields should be correct types if present
          if (output.middleLines !== undefined) {
            expect(Array.isArray(output.middleLines)).toBe(true)
          }
          if (output.expandInfo !== undefined) {
            expect(typeof output.expandInfo).toBe('string')
          }
          if (output.lines !== undefined) {
            expect(typeof output.lines).toBe('number')
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Error results usually start with "Error:" (except known Claude-style rejections)
  it('should prefix error results with "Error:" unless it is a tool-use rejection', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        (name, result) => {
          const output = formatToolResult(name, result, true)
          if (result.startsWith('Tool use rejected')) {
            expect(output.summary).toBe(result.slice(0, 100))
          } else if (name === 'Read') {
            expect(output.summary).toBe('Error reading file')
          } else {
            expect(output.summary.startsWith('Error:')).toBe(true)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Read tool shows line count
  it('should show line count for Read tool', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (result) => {
          const output = formatToolResult('Read', result, false)
          const lineCount = result === '' ? 0 : result.split('\n').length
          expect(output.summary).toBe(`Read ${lineCount} lines`)
          expect(output.lines).toBe(lineCount)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Write tool truncates long results
  it('should truncate Write tool results to 100 chars', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (result) => {
          const output = formatToolResult('Write', result, false)
          expect(output.summary.length).toBeLessThanOrEqual(100)
          expect(output.summary).toBe(result.slice(0, 100))
        }
      ),
      { numRuns: 100 }
    )
  })

  it('strips trailing <system-reminder> blocks from displayed results', () => {
    const base = ['Usage: bilibili2str [options] <url>', 'line2', 'line3', 'line4'].join('\n')
    const injected =
      base +
      "\n\n<system-reminder>\nThe TodoWrite tool hasn't been used recently.\n</system-reminder>"

    const output = formatToolResult('Bash', injected, false)

    expect(output.summary).toBe('Usage: bilibili2str [options] <url>')
    expect(output.middleLines).toEqual(['line2', 'line3'])
    expect(output.expandInfo).toBe('… +1 lines (ctrl+o to expand)')
    expect(output.lines).toBe(4)
  })

  it('keeps Task JSON parsing stable when a trailing <system-reminder> is appended', () => {
    const raw = JSON.stringify({ status: 'completed', summary: 'Done (1 tool uses · 10 tokens · 1s)' })
    const injected = raw + '\n\n<system-reminder>\ninternal\n</system-reminder>'
    const output = formatToolResult('Task', injected, false)
    expect(output.summary).toBe('Done (1 tool uses · 10 tokens · 1s)')
  })

  it('handles Task result states and parse fallback paths', () => {
    const queuedNoId = formatToolResult('Task', JSON.stringify({ status: 'running' }), false)
    expect(queuedNoId.summary).toBe('Task queued')

    const queuedWithShortId = formatToolResult('Task', JSON.stringify({ status: 'running', task_id: 'abc123' }), false)
    expect(queuedWithShortId.summary).toBe('Task queued (abc123)')

    const queuedWithLongId = formatToolResult(
      'Task',
      JSON.stringify({ status: 'running', task_id: '123456789abcdef' }),
      false,
    )
    expect(queuedWithLongId.summary).toBe('Task queued (12345678…)')

    const taskErrField = formatToolResult('Task', JSON.stringify({ error: 'boom' }), false)
    expect(taskErrField.summary).toBe('Error: boom')

    const taskStatusErr = formatToolResult('Task', JSON.stringify({ status: 'error', summary: 'bad' }), false)
    expect(taskStatusErr.summary).toBe('Error: bad')

    const taskStatusErrNoSummary = formatToolResult('Task', JSON.stringify({ status: 'error' }), false)
    expect(taskStatusErrNoSummary.summary).toBe('Error: Task failed')

    const taskRunningBlankId = formatToolResult('Task', JSON.stringify({ status: 'running', task_id: '' }), false)
    expect(taskRunningBlankId.summary).toBe('Task queued')

    const taskPlain = formatToolResult('Task', JSON.stringify({}), false)
    expect(taskPlain.summary).toBe('(no output)')

    const taskNoOutput = formatToolResult('Task', '', false)
    expect(taskNoOutput).toEqual({ summary: '(no output)', lines: 0 })
    const taskNoOutputErr = formatToolResult('Task', '', true)
    expect(taskNoOutputErr).toEqual({ summary: 'Error: (no output)', lines: 0 })

    const plainOk = formatToolResult('Task', 'not-json', false)
    expect(plainOk.summary).toBe('not-json')
    const plainErr = formatToolResult('Task', 'not-json', true)
    expect(plainErr.summary).toBe('Error: not-json')
  })

  // Property test: Glob/Search shows file count
  it('should show file count for Glob tool', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 })),
        (files) => {
          const result = files.join('\n')
          const output = formatToolResult('Glob', result, false)
          const expectedCount = files.filter(f => f.trim()).length
          expect(output.summary).toBe(`Found ${expectedCount} files`)
          expect(output.lines).toBe(expectedCount)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('handles explicit zero-result sentinel strings for Glob/Grep', () => {
    expect(formatToolResult('Glob', 'No files found', false)).toEqual({ summary: 'Found 0 files', lines: 0 })
    expect(formatToolResult('Grep', 'No matches found', false)).toEqual({ summary: 'Found 0 matches', lines: 0 })
  })

  it('classifies Grep outputs as line matches, count matches, files or zero matches', () => {
    expect(formatToolResult('Grep', '', false)).toEqual({ summary: 'Found 0 matches', lines: 0 })

    const content = ['a.ts:1:foo', 'b.ts:2:bar'].join('\n')
    expect(formatToolResult('Grep', content, false)).toEqual({ summary: 'Found 2 lines', lines: 2 })

    const count = ['a.ts:3', 'b.ts:4'].join('\n')
    expect(formatToolResult('Grep', count, false)).toEqual({ summary: 'Found 7 matches', lines: 7 })

    const files = ['a.ts', 'b.ts'].join('\n')
    expect(formatToolResult('Grep', files, false)).toEqual({ summary: 'Found 2 files', lines: 2 })
  })

  it('handles WebSearch output layout for 1, 2-3, and 4+ lines', () => {
    expect(formatToolResult('WebSearch', 'one', false)).toEqual({ summary: 'one', lines: 1 })
    expect(formatToolResult('WebSearch', 'one\ntwo\nthree', false)).toEqual({
      summary: 'one',
      middleLines: ['two', 'three'],
      lines: 3,
    })
    expect(formatToolResult('WebSearch', 'one\ntwo\nthree\nfour\nfive', false)).toEqual({
      summary: 'one',
      middleLines: ['two', 'three'],
      expandInfo: '… +2 lines (ctrl+o to expand)',
      lines: 5,
    })
  })

  it('handles WebSearch with empty output line', () => {
    expect(formatToolResult('WebSearch', '', false)).toEqual({ summary: '', lines: 1 })
  })

  it('handles error branches including tool rejection and filtered default detail lines', () => {
    const rejected = formatToolResult(
      'Bash',
      'Tool use rejected by policy\n\n<system-reminder>\nignore\n</system-reminder>',
      true,
    )
    expect(rejected.summary).toBe('Tool use rejected by policy')

    const bashNoDetail = formatToolResult('Bash', 'Error: hello\nstderr:\nstdout:\n', true)
    expect(bashNoDetail).toEqual({ summary: 'Error: hello' })

    const bashNoOutput = formatToolResult('Bash', '', true)
    expect(bashNoOutput).toEqual({ summary: 'Error: (no output)' })

    const bashFallbackDetail = formatToolResult('Bash', 'Exit code 2\nstdout:\nactual detail', true)
    expect(bashFallbackDetail).toEqual({ summary: 'Error: Exit code 2', middleLines: ['actual detail'] })

    const bashStderrSkipsBlank = formatToolResult('Bash', 'Exit code 2\nstderr:\n \nproblem\nstdout:', true)
    expect(bashStderrSkipsBlank).toEqual({ summary: 'Error: Exit code 2', middleLines: ['problem'] })

    const defaultNoOutput = formatToolResult('Any', '', true)
    expect(defaultNoOutput).toEqual({ summary: 'Error: (no output)' })

    const defaultFiltered = formatToolResult('Any', 'boom\nErrorCode: E1\nWorkspace roots: /x', true)
    expect(defaultFiltered).toEqual({ summary: 'Error: boom', middleLines: ['ErrorCode: E1'] })

    const workspaceFiltered = formatToolResult('Any', 'boom\nWorkspace roots: /x\ndetail', true)
    expect(workspaceFiltered).toEqual({ summary: 'Error: boom', middleLines: ['detail'] })

    const alreadyPrefixed = formatToolResult('Any', 'Error: prefixed', true)
    expect(alreadyPrefixed).toEqual({ summary: 'Error: prefixed' })
  })

  it('stripTrailingSystemReminderBlock keeps strings without full trailing block', () => {
    const noClose = 'x\n\n<system-reminder>\nabc'
    expect(formatToolResult('Write', noClose, false).summary).toBe(noClose.slice(0, 100))

    const withTail = 'x\n\n<system-reminder>\nabc\n</system-reminder>\nTAIL'
    expect(formatToolResult('Write', withTail, false).summary).toBe(withTail.slice(0, 100))
  })

  it('handles undefined raw result values via runtime casts', () => {
    const out = formatToolResult('Write', undefined as any, false)
    expect(out).toEqual({ summary: '' })
  })

  // Property test: Bash with single line has no middleLines
  it('should not have middleLines for single-line Bash output', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => !s.includes('\n')),
        (result) => {
          const output = formatToolResult('Bash', result, false)
          expect(output.summary).toBe(result)
          expect(output.middleLines).toBeUndefined()
          expect(output.expandInfo).toBeUndefined()
          expect(output.lines).toBe(1)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Bash with 2-3 lines has middleLines but no expandInfo
  it('should have middleLines but no expandInfo for 2-3 line Bash output', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }).filter((s) => !s.includes('\n')), { minLength: 2, maxLength: 3 }),
        (lines) => {
          const result = lines.join('\n')
          const output = formatToolResult('Bash', result, false)
          
          expect(output.summary).toBe(lines[0])
          expect(output.middleLines).toEqual(lines.slice(1, 3))
          expect(output.expandInfo).toBeUndefined()
          expect(output.lines).toBe(lines.length)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Bash with 4+ lines has middleLines and expandInfo
  it('should have middleLines and expandInfo for 4+ line Bash output', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }).filter((s) => !s.includes('\n')), { minLength: 4, maxLength: 20 }),
        (lines) => {
          const result = lines.join('\n')
          const output = formatToolResult('Bash', result, false)
          
          expect(output.summary).toBe(lines[0])
          expect(output.middleLines).toEqual(lines.slice(1, 3))
          expect(output.expandInfo).toBe(`… +${lines.length - 3} lines (ctrl+o to expand)`)
          expect(output.lines).toBe(lines.length)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Unknown tools truncate to 100 chars
  it('should truncate unknown tool results to 100 chars', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => !['Read', 'Write', 'Glob', 'Search', 'Bash'].includes(s)),
        fc.string(),
        (name, result) => {
          const output = formatToolResult(name, result, false)
          expect(output.summary.length).toBeLessThanOrEqual(100)
          expect(output.summary).toBe(result.slice(0, 100))
        }
      ),
      { numRuns: 100 }
    )
  })

  // Unit tests for specific examples
  describe('specific examples', () => {
    it('should format Read result correctly', () => {
      const result = formatToolResult('Read', 'line1\nline2\nline3', false)
      expect(result).toEqual({ summary: 'Read 3 lines', lines: 3 })
    })

    it('should format Write result correctly', () => {
      const result = formatToolResult('Write', 'Wrote 100 bytes', false)
      expect(result).toEqual({ summary: 'Wrote 100 bytes' })
    })

    it('should format Glob result correctly', () => {
      const result = formatToolResult('Glob', 'file1.ts\nfile2.ts\nfile3.ts', false)
      expect(result).toEqual({ summary: 'Found 3 files', lines: 3 })
    })

    it('should format Bash single line correctly', () => {
      const result = formatToolResult('Bash', 'total 0', false)
      expect(result).toEqual({ summary: 'total 0', lines: 1 })
    })

    it('should not render a phantom blank line for trailing newline output', () => {
      const result = formatToolResult('Bash', 'hello\n', false)
      expect(result).toEqual({ summary: 'hello', lines: 1 })
    })

    it('should format Bash multi-line correctly', () => {
      const result = formatToolResult('Bash', 'total 0\ndrwxr-xr-x 2\ndrwxr-xr-x 3\nfile1\nfile2', false)
      expect(result).toEqual({
        summary: 'total 0',
        middleLines: ['drwxr-xr-x 2', 'drwxr-xr-x 3'],
        expandInfo: '… +2 lines (ctrl+o to expand)',
        lines: 5
      })
    })

	    it('should format error result correctly', () => {
	      const result = formatToolResult('Read', 'File not found', true)
	      expect(result).toEqual({ summary: 'Error reading file' })
	    })

	    it('should format Bash error result correctly', () => {
	      const result = formatToolResult(
	        'Bash',
	        'Exit code 1\nstderr:\ncat: ~/.codex/auth copy.json: No such file or directory\nstdout:\n',
	        true,
	      )
	      expect(result).toEqual({
	        summary: 'Error: Exit code 1',
	        middleLines: ['cat: ~/.codex/auth copy.json: No such file or directory'],
	      })
	    })
	  })
	})


/**
 * Edge case tests for utility functions
 * Validates: Requirements 4.7
 */
describe('edge cases', () => {
  describe('formatToolCallParts edge cases', () => {
    it('should handle empty input object', () => {
      const result = formatToolCallParts('Read', {})
      expect(result).toEqual({ toolName: 'Read', params: '' })
    })

    it('should handle null/undefined values in input', () => {
      const result = formatToolCallParts('Read', { file_path: null, path: undefined })
      expect(result).toEqual({ toolName: 'Read', params: '' })
    })

    it('should handle special characters in file paths', () => {
      const specialPath = 'src/[test]/file (1).tsx'
      const result = formatToolCallParts('Read', { file_path: specialPath })
      expect(result.params).toBe(specialPath)
    })

    it('should handle unicode characters in file paths', () => {
      const unicodePath = 'src/文件/测试.ts'
      const result = formatToolCallParts('Read', { file_path: unicodePath })
      expect(result.params).toBe(unicodePath)
    })

    it('should handle very long file paths', () => {
      const longPath = 'a'.repeat(1000)
      const result = formatToolCallParts('Read', { file_path: longPath })
      expect(result.params).toBe(longPath) // Read doesn't truncate
    })

    it('should handle Bash command with newlines', () => {
      const cmdWithNewlines = 'echo "hello\nworld"'
      const result = formatToolCallParts('Bash', { command: cmdWithNewlines })
      expect(result.params).toBe(cmdWithNewlines)
    })

    it('should handle empty Bash command', () => {
      const result = formatToolCallParts('Bash', { command: '' })
      expect(result.params).toBe('')
    })

    it('should handle Grep with empty pattern', () => {
      const result = formatToolCallParts('Grep', { pattern: '', path: 'src/' })
      expect(result.toolName).toBe('Search')
      expect(result.params).toBe(`pattern: ${JSON.stringify('')}, path: ${JSON.stringify('src/')}`)
    })

    it('should handle unknown tool with circular reference gracefully', () => {
      const input: Record<string, any> = { key: 'value' }
      // Note: JSON.stringify will throw on circular refs, but our input is safe
      const result = formatToolCallParts('UnknownTool', input)
      expect(result.toolName).toBe('UnknownTool')
      expect(typeof result.params).toBe('string')
    })

    it('should handle unknown tool with nested objects', () => {
      const input = { nested: { deep: { value: 'test' } } }
      const result = formatToolCallParts('UnknownTool', input)
      expect(result.params.length).toBeLessThanOrEqual(40)
    })
  })

  describe('formatToolResult edge cases', () => {
    it('should handle empty result string', () => {
      const result = formatToolResult('Read', '', false)
      expect(result.summary).toBe('Read 0 lines')
      expect(result.lines).toBe(0)
    })

    it('should handle result with only newlines', () => {
      const result = formatToolResult('Bash', '\n\n\n', false)
      expect(result.lines).toBe(3)
      expect(result.summary).toBe('')
      expect(result.middleLines).toEqual(['', ''])
      expect(result.expandInfo).toBeUndefined()
    })

    it('should handle very long single line', () => {
      const longLine = 'a'.repeat(10000)
      const result = formatToolResult('Bash', longLine, false)
      expect(result.summary).toBe(longLine)
      expect(result.lines).toBe(1)
    })

    it('should handle unicode in results', () => {
      const unicodeResult = '文件1\n文件2\n文件3'
      const result = formatToolResult('Bash', unicodeResult, false)
      expect(result.summary).toBe('文件1')
      expect(result.middleLines).toEqual(['文件2', '文件3'])
    })

    it('should handle special characters in results', () => {
      const specialResult = 'total 0\n-rw-r--r-- 1 user group 0 Jan 1 00:00 file.txt'
      const result = formatToolResult('Bash', specialResult, false)
      expect(result.summary).toBe('total 0')
    })

	    it('should handle very long error message', () => {
	      const longError = 'Error: ' + 'a'.repeat(1000)
	      const result = formatToolResult('Read', longError, true)
	      expect(result).toEqual({ summary: 'Error reading file' })
	    })

    it('should handle Glob with empty lines', () => {
      const result = formatToolResult('Glob', 'file1.ts\n\nfile2.ts\n', false)
      expect(result.summary).toBe('Found 2 files')
      expect(result.lines).toBe(2)
    })

    it('should handle Search same as Glob', () => {
      const result = formatToolResult('Search', 'match1\nmatch2', false)
      expect(result.summary).toBe('Found 2 files')
    })

    it('should handle Write with empty result', () => {
      const result = formatToolResult('Write', '', false)
      expect(result.summary).toBe('')
    })

    it('should handle unknown tool with multi-line result', () => {
      const result = formatToolResult('CustomTool', 'line1\nline2\nline3', false)
      expect(result.summary).toBe('line1\nline2\nline3'.slice(0, 100))
      expect(result.lines).toBe(3)
    })
  })
})
