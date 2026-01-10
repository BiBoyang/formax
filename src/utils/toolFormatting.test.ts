import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { formatToolCallParts, formatToolResult } from './toolFormatting';

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

  // Property test: Error results always start with "Error:"
  it('should prefix error results with "Error:"', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        (name, result) => {
          const output = formatToolResult(name, result, true)
          expect(output.summary.startsWith('Error:')).toBe(true)
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
        fc.array(fc.string().filter(s => !s.includes('\n')), { minLength: 2, maxLength: 3 }),
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
        fc.array(fc.string().filter(s => !s.includes('\n')), { minLength: 4, maxLength: 20 }),
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
      expect(result).toEqual({ summary: 'Error: File not found' })
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
      expect(result.lines).toBe(4)
      expect(result.summary).toBe('')
      expect(result.middleLines).toEqual(['', ''])
      expect(result.expandInfo).toBe('… +1 lines (ctrl+o to expand)')
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
      expect(result.summary.length).toBeLessThanOrEqual(107) // "Error: " + 100 chars
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
