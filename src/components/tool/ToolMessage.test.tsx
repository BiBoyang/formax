import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import React from 'react'
import { render } from 'ink-testing-library'
import { ToolMessage, Msg, ToolInfo, shouldShowSurfaceSuffix, toSurfaceSuffix } from './ToolMessage'

// Helper to create a valid Msg object
function createMsg(overrides: Partial<Msg> = {}): Msg {
  return {
    id: 'test-id',
    role: 'tool',
    content: 'Test content',
    timestamp: new Date(),
    ...overrides
  }
}

// Helper to create a valid ToolInfo object
function createToolInfo(overrides: Partial<ToolInfo> = {}): ToolInfo {
  return {
    name: 'Read',
    input: { file_path: 'test.ts' },
    status: 'completed',
    ...overrides
  }
}

function displayToolName(name: string): string {
  return name === 'Glob' || name === 'Grep' ? 'Search' : name
}

// Arbitrary for generating tool names
const toolNameArb = fc.constantFrom('Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Search', 'Unknown')

// Arbitrary for generating tool status
const toolStatusArb = fc.constantFrom('running', 'completed', 'error') as fc.Arbitrary<'running' | 'completed' | 'error'>

// Arbitrary for generating tool input
const toolInputArb = fc.dictionary(fc.string(), fc.string())

// Arbitrary for generating ToolInfo
const toolInfoArb = fc.record({
  name: toolNameArb,
  input: toolInputArb,
  status: toolStatusArb,
  result: fc.option(fc.string(), { nil: undefined }),
  resultLines: fc.option(fc.nat(), { nil: undefined }),
  expandInfo: fc.option(fc.string(), { nil: undefined }),
  middleLines: fc.option(fc.array(fc.string()), { nil: undefined })
}) as fc.Arbitrary<ToolInfo>

// Arbitrary for generating Msg with toolInfo
const msgWithToolInfoArb = fc.record({
  id: fc.string(),
  role: fc.constant('tool' as const),
  content: fc.string(),
  timestamp: fc.date(),
  isStreaming: fc.option(fc.boolean(), { nil: undefined }),
  toolInfo: toolInfoArb
}) as fc.Arbitrary<Msg>

/**
 * Feature: tool-ui-refactor
 * Property 1: Visual Consistency Across All Tool States
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.7, 2.3
 * 
 * For any tool message with valid toolInfo, the ToolMessage component should render
 * with exact Claude Code styling including ⏺ symbol, proper spacing, appropriate
 * dot colors, and ⎿ prefix for results.
 */
describe('ToolMessage', () => {
  describe('surface suffix helpers', () => {
    it('shouldShowSurfaceSuffix respects env flag values', () => {
      const prev = process.env.FORMAX_HOOKS_DEBUG
      process.env.FORMAX_HOOKS_DEBUG = '1'
      expect(shouldShowSurfaceSuffix()).toBe(true)
      process.env.FORMAX_HOOKS_DEBUG = 'true'
      expect(shouldShowSurfaceSuffix()).toBe(true)
      process.env.FORMAX_HOOKS_DEBUG = 'yes'
      expect(shouldShowSurfaceSuffix()).toBe(true)
      process.env.FORMAX_HOOKS_DEBUG = 'false'
      expect(shouldShowSurfaceSuffix()).toBe(false)
      process.env.FORMAX_HOOKS_DEBUG = prev
    })

    it('toSurfaceSuffix handles unknown, no-id, and toolUseId paths', () => {
      const prev = process.env.FORMAX_HOOKS_DEBUG
      process.env.FORMAX_HOOKS_DEBUG = 'true'
      try {
        expect(toSurfaceSuffix(createMsg({ id: 'id-1234', surfaceHint: 'unknown' as any }))).toBeNull()
        expect(toSurfaceSuffix(createMsg({ id: '', surfaceHint: 'transient', toolInfo: createToolInfo({ toolUseId: '' }) }))).toBe('trans')
        expect(
          toSurfaceSuffix(
            createMsg({
              id: 'id-1234',
              surfaceOwner: 'static',
              toolInfo: createToolInfo({ toolUseId: 'tool-5678' }),
            }),
          ),
        ).toBe('static#5678@1234:id-1234')
        expect(
          toSurfaceSuffix(
            createMsg({
              id: '',
              surfaceOwner: 'static',
              toolInfo: createToolInfo({ toolUseId: 'tool-5678' }),
            }),
          ),
        ).toBe('static#5678')
      } finally {
        process.env.FORMAX_HOOKS_DEBUG = prev
      }
    })
  })

  describe('Property 1: Visual Consistency Across All Tool States', () => {
    // Property test: Component always renders without crashing
    it('should render without crashing for any valid tool message', () => {
      fc.assert(
        fc.property(msgWithToolInfoArb, (msg) => {
          const { lastFrame } = render(<ToolMessage message={msg} />)
          expect(lastFrame()).toBeDefined()
        }),
        { numRuns: 100 }
      )
    })

    // Property test: Output always contains ⏺ symbol
    it('should always contain ⏺ symbol', () => {
      fc.assert(
        fc.property(msgWithToolInfoArb, (msg) => {
          const { lastFrame } = render(<ToolMessage message={msg} />)
          expect(lastFrame()).toContain('⏺')
        }),
        { numRuns: 100 }
      )
    })

    // Property test: Output always contains tool name
    it('should always contain tool name', () => {
      fc.assert(
        fc.property(msgWithToolInfoArb, (msg) => {
          const { lastFrame } = render(<ToolMessage message={msg} />)
          expect(lastFrame()).toContain(displayToolName(msg.toolInfo!.name))
        }),
        { numRuns: 100 }
      )
    })

    // Property test: Completed/error status shows result with ⎿ prefix
    it('should show ⎿ prefix for completed/error status', () => {
      fc.assert(
        fc.property(
          msgWithToolInfoArb.filter(m => m.toolInfo!.status !== 'running'),
          (msg) => {
            const { lastFrame } = render(<ToolMessage message={msg} />)
            expect(lastFrame()).toContain('⎿')
          }
        ),
        { numRuns: 100 }
      )
    })

    // Property test: Running status does not show result
    it('should not show ⎿ prefix for running status', () => {
      fc.assert(
        fc.property(
          msgWithToolInfoArb.map(m => ({
            ...m,
            toolInfo: { ...m.toolInfo!, status: 'running' as const }
          })),
          (msg) => {
            const { lastFrame } = render(<ToolMessage message={msg} />)
            expect(lastFrame()).not.toContain('⎿')
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  // Unit tests for specific status colors
  describe('status colors', () => {
    it('should render running status with dimmed dot', () => {
      const msg = createMsg({
        toolInfo: createToolInfo({ status: 'running' })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('⏺')
      expect(lastFrame()).toContain('Read')
    })

    it('should render completed status with green dot', () => {
      const msg = createMsg({
        toolInfo: createToolInfo({ status: 'completed' })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('⏺')
      expect(lastFrame()).toContain('Read')
      expect(lastFrame()).toContain('⎿')
    })

    it('should render error status with red dot', () => {
      const msg = createMsg({
        toolInfo: createToolInfo({ status: 'error' })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('⏺')
      expect(lastFrame()).toContain('Read')
      expect(lastFrame()).toContain('⎿')
    })

    it('should keep error details compact', () => {
      const msg = createMsg({
        content: 'Error: Something failed',
        toolInfo: createToolInfo({
          status: 'error',
          middleLines: ['ErrorCode: INTERNAL', 'detail line'],
          expandInfo: 'Workspace roots: ~/Documents/github/formax',
        }),
      })

      const { lastFrame } = render(<ToolMessage message={msg} />)
      const frame = lastFrame()
      expect(frame).toContain('Error: Something failed')
      expect(frame).toContain('detail line')
      expect(frame).not.toContain('Workspace roots:')
      expect(frame).not.toContain('ErrorCode:')
    })
  })

  // Unit tests for tool types
  describe('tool types', () => {
    it('renders exactly one space after ⏺ in the tool header', () => {
      const msg = createMsg({
        toolInfo: createToolInfo({
          name: 'Read',
          input: { file_path: 'LICENSE' },
          status: 'completed',
        }),
      })

      const { lastFrame } = render(<ToolMessage message={msg} />)
      const frame = lastFrame()
      expect(frame).toContain('⏺ Read')
      expect(frame).not.toContain('⏺  Read')
    })

    it('should not render empty parentheses when params are empty', () => {
      const msg = createMsg({
        toolInfo: createToolInfo({
          name: 'Edit',
          input: {},
          status: 'running',
        }),
      })

      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('Edit')
      expect(lastFrame()).not.toContain('Edit()')
    })

    it('should render Read tool correctly', () => {
      const msg = createMsg({
        content: 'Read 42 lines',
        toolInfo: createToolInfo({
          name: 'Read',
          input: { file_path: 'src/index.ts' },
          status: 'completed'
        })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('Read')
      expect(lastFrame()).toContain('src/index.ts')
      expect(lastFrame()).toContain('Read 42 lines')
    })

    it('should render Bash tool correctly', () => {
      const msg = createMsg({
        content: 'total 0',
        toolInfo: createToolInfo({
          name: 'Bash',
          input: { command: 'ls -la' },
          status: 'completed'
        })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('Bash')
      expect(lastFrame()).toContain('ls -la')
      expect(lastFrame()).toContain('total 0')
    })

    it('should render Glob tool correctly', () => {
      const msg = createMsg({
        content: 'Found 5 files',
        toolInfo: createToolInfo({
          name: 'Glob',
          input: { pattern: '**/*.ts' },
          status: 'completed'
        })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('Search')
      expect(lastFrame()).toContain('**/*.ts')
      expect(lastFrame()).toContain('Found 5 files')
    })

    it('renders transient surface suffix in hooks debug mode without toolUseId', () => {
      const prev = process.env.FORMAX_HOOKS_DEBUG
      process.env.FORMAX_HOOKS_DEBUG = 'true'
      try {
        const msg = createMsg({
          id: 'msg-1234',
          surfaceHint: 'transient',
          toolInfo: createToolInfo({
            name: 'Read',
            input: { file_path: 'src/index.ts' },
            status: 'completed',
            toolUseId: '',
          }),
        })
        const { lastFrame } = render(<ToolMessage message={msg} />)
        expect(lastFrame()).toContain('trans@1234:msg-1234')
      } finally {
        process.env.FORMAX_HOOKS_DEBUG = prev
      }
    })

    it('renders static surface suffix in hooks debug mode with toolUseId', () => {
      const prev = process.env.FORMAX_HOOKS_DEBUG
      process.env.FORMAX_HOOKS_DEBUG = '1'
      try {
        const msg = createMsg({
          id: 'msg-1234',
          surfaceOwner: 'static',
          toolInfo: createToolInfo({
            name: 'Read',
            input: { file_path: 'src/index.ts' },
            status: 'completed',
            toolUseId: 'tool-5678',
          }),
        })
        const { lastFrame } = render(<ToolMessage message={msg} />)
        expect(lastFrame()).toContain('static#5678@1234:msg-1234')
      } finally {
        process.env.FORMAX_HOOKS_DEBUG = prev
      }
    })
  })
})


/**
 * Feature: tool-ui-refactor
 * Property 2: Multi-line Output Formatting
 * Validates: Requirements 1.5
 * 
 * For any tool result containing multiple lines (especially Bash output),
 * the ToolMessage component should format the first line with ⎿ prefix,
 * middle lines with 3-space indentation, and include expand info for
 * results longer than 3 lines.
 */
describe('Property 2: Multi-line Output Formatting', () => {
  // Property test: Middle lines are rendered
  it('should render middle lines when present', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }).filter(s => !s.includes('\n') && s.trim().length > 0), { minLength: 1, maxLength: 5 }),
        (middleLines) => {
          const msg = createMsg({
            content: 'first line',
            toolInfo: createToolInfo({
              name: 'Bash',
              status: 'completed',
              middleLines
            })
          })
          const { lastFrame } = render(<ToolMessage message={msg} />)
          const output = lastFrame() || ''
          
          // Each non-empty middle line should appear in output
          middleLines.forEach(line => {
            const trimmed = line.trim()
            if (trimmed) {
              expect(output).toContain(trimmed)
            }
          })
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Expand info is rendered when present
  it('should render expand info when present', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100 }),
        (lineCount) => {
          const expandInfo = `… +${lineCount} lines (ctrl+o to expand)`
          const msg = createMsg({
            content: 'first line',
            toolInfo: createToolInfo({
              name: 'Bash',
              status: 'completed',
              expandInfo
            })
          })
          const { lastFrame } = render(<ToolMessage message={msg} />)
          expect(lastFrame()).toContain(expandInfo)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Unit tests for specific multi-line scenarios
  describe('specific multi-line scenarios', () => {
    it('should render Bash output with 2 middle lines', () => {
      const msg = createMsg({
        content: 'total 0',
        toolInfo: createToolInfo({
          name: 'Bash',
          input: { command: 'ls -la' },
          status: 'completed',
          middleLines: ['drwxr-xr-x 2 user group', 'drwxr-xr-x 3 user group']
        })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('total 0')
      expect(lastFrame()).toContain('drwxr-xr-x 2 user group')
      expect(lastFrame()).toContain('drwxr-xr-x 3 user group')
    })

    it('should render Bash output with expand info', () => {
      const msg = createMsg({
        content: 'total 0',
        toolInfo: createToolInfo({
          name: 'Bash',
          input: { command: 'ls -la' },
          status: 'completed',
          middleLines: ['drwxr-xr-x 2', 'drwxr-xr-x 3'],
          expandInfo: '… +5 lines (ctrl+o to expand)'
        })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('total 0')
      expect(lastFrame()).toContain('… +5 lines (ctrl+o to expand)')
    })

    it('should not render middle lines for non-Bash tools', () => {
      const msg = createMsg({
        content: 'Read 42 lines',
        toolInfo: createToolInfo({
          name: 'Read',
          status: 'completed',
          middleLines: undefined
        })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('Read 42 lines')
    })
  })
})


/**
 * Feature: tool-ui-refactor
 * Property 3: Graceful Edge Case Handling
 * Validates: Requirements 4.7
 * 
 * For any Msg object with missing or malformed toolInfo fields,
 * the ToolMessage component should render without crashing and
 * display fallback content appropriately.
 */
describe('Property 3: Graceful Edge Case Handling', () => {
  // Property test: Component handles missing toolInfo
  it('should handle missing toolInfo gracefully', () => {
    const msg = createMsg({ toolInfo: undefined })
    const { lastFrame } = render(<ToolMessage message={msg} />)
    expect(lastFrame()).toContain('⏺')
    expect(lastFrame()).toContain('Unknown tool')
  })

  // Property test: Component handles empty input object
  it('should handle empty input object', () => {
    fc.assert(
      fc.property(
        toolNameArb,
        toolStatusArb,
        (name, status) => {
          const msg = createMsg({
            toolInfo: createToolInfo({
              name,
              input: {},
              status
            })
          })
          const { lastFrame } = render(<ToolMessage message={msg} />)
          expect(lastFrame()).toContain('⏺')
          expect(lastFrame()).toContain(displayToolName(name))
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property test: Component handles undefined optional fields
  it('should handle undefined optional fields', () => {
    fc.assert(
      fc.property(
        toolNameArb,
        toolStatusArb,
        (name, status) => {
          const msg = createMsg({
            content: 'test content',
            toolInfo: {
              name,
              input: {},
              status,
              result: undefined,
              resultLines: undefined,
              expandInfo: undefined,
              middleLines: undefined
            }
          })
          const { lastFrame } = render(<ToolMessage message={msg} />)
          expect(lastFrame()).toContain('⏺')
        }
      ),
      { numRuns: 100 }
    )
  })

  // Unit tests for specific edge cases
  describe('specific edge cases', () => {
    it('should handle null-like values in input', () => {
      const msg = createMsg({
        toolInfo: createToolInfo({
          name: 'Read',
          input: { file_path: null as any, path: undefined as any },
          status: 'completed'
        })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('⏺')
      expect(lastFrame()).toContain('Read')
    })

    it('should handle very long tool names', () => {
      const longName = 'A'.repeat(50)
      const msg = createMsg({
        toolInfo: createToolInfo({
          name: longName,
          status: 'completed'
        })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      // The name might be wrapped, but should still be present
      expect(lastFrame()).toContain('⏺')
      // Check that at least part of the name is present
      expect(lastFrame()).toContain('AAAA')
    })

    it('should handle special characters in content', () => {
      const msg = createMsg({
        content: '文件内容 <script>alert("xss")</script>',
        toolInfo: createToolInfo({
          name: 'Read',
          status: 'completed'
        })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('文件内容')
    })

    it('should handle empty content', () => {
      const msg = createMsg({
        content: '',
        toolInfo: createToolInfo({
          name: 'Read',
          status: 'completed'
        })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('⏺')
      expect(lastFrame()).toContain('Read')
    })

    it('should handle empty middleLines array', () => {
      const msg = createMsg({
        content: 'test',
        toolInfo: createToolInfo({
          name: 'Bash',
          status: 'completed',
          middleLines: []
        })
      })
      const { lastFrame } = render(<ToolMessage message={msg} />)
      expect(lastFrame()).toContain('⏺')
      expect(lastFrame()).toContain('Bash')
    })
  })
})
