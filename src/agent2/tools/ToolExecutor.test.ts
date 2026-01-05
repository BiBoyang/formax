/**
 * Property-based tests for Tool Executor
 * 
 * Feature: streaming-chat-refactor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { runLocalTool, executeToolsSequentially, truncateResult, ToolCall } from './ToolExecutor';

describe('ToolExecutor', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `tool-test-${Date.now()}`)
    await fsp.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await fsp.rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  /**
   * Property 5: Tool Execution Produces Valid Results
   * 
   * For any tool_use block with a valid tool name and input, executing the tool SHALL produce
   * a tool_result with the correct tool_use_id and either a success content string or an error message.
   * 
   * **Validates: Requirements 3.1, 3.4, 3.7**
   */
  describe('Property 5: Tool Execution Produces Valid Results', () => {
    it('should produce valid result for Read tool with existing file', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 1000 }),
          fc.uuid(),
          async (fileContent, toolId) => {
            // Create test file
            const filePath = path.join(testDir, `test-${toolId}.txt`)
            await fsp.writeFile(filePath, fileContent, 'utf8')

            const call: ToolCall = {
              id: toolId,
              name: 'Read',
              input: { file_path: filePath }
            }

            const result = await runLocalTool(call)
            expect(result).toBe(fileContent)
          }
        ),
        { numRuns: 50 }
      )
    })

    it('should produce error for Read tool with non-existent file', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (toolId) => {
            const call: ToolCall = {
              id: toolId,
              name: 'Read',
              input: { file_path: `/nonexistent-${toolId}.txt` }
            }

            await expect(runLocalTool(call)).rejects.toThrow()
          }
        ),
        { numRuns: 20 }
      )
    })

    it('should produce valid result for Write tool', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 1000 }),
          fc.uuid(),
          async (content, toolId) => {
            const filePath = path.join(testDir, `write-${toolId}.txt`)

            const call: ToolCall = {
              id: toolId,
              name: 'Write',
              input: { file_path: filePath, content }
            }

            const result = await runLocalTool(call)
            
            // Result should indicate success
            expect(result).toContain('Wrote')
            expect(result).toContain(filePath)

            // File should contain the content
            const written = await fsp.readFile(filePath, 'utf8')
            expect(written).toBe(content)
          }
        ),
        { numRuns: 50 }
      )
    })

    it('should produce valid result for Bash tool with simple commands', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (toolId) => {
            const call: ToolCall = {
              id: toolId,
              name: 'Bash',
              input: { command: 'echo "hello"', timeout: 5000 }
            }

            const result = await runLocalTool(call)
            expect(result.trim()).toBe('hello')
          }
        ),
        { numRuns: 20 }
      )
    })

    it('should produce error for missing required inputs', async () => {
      const testCases = [
        { name: 'Read', input: {} },
        { name: 'Write', input: {} },
        { name: 'Bash', input: {} },
        { name: 'Glob', input: {} },
      ]

      for (const tc of testCases) {
        const call: ToolCall = {
          id: 'test-id',
          name: tc.name,
          input: tc.input
        }

        await expect(runLocalTool(call)).rejects.toThrow()
      }
    })
  })

  /**
   * Property 6: Tool Execution Order Preservation
   * 
   * For any response containing multiple tool_use blocks, the tools SHALL be executed sequentially
   * in the order they appear, and the message history SHALL contain the complete assistant content
   * followed by tool_results in the same order.
   * 
   * **Validates: Requirements 3.2, 3.5**
   */
  describe('Property 6: Tool Execution Order Preservation', () => {
    it('should execute tools in order and preserve result order', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 1, maxLength: 5 }),
          async (contents) => {
            const executionOrder: string[] = []
            const toolCalls: ToolCall[] = contents.map((content, i) => {
              const filePath = path.join(testDir, `order-test-${i}.txt`)
              return {
                id: `tool-${i}`,
                name: 'Read',
                input: { file_path: filePath }
              }
            })

            // Create files synchronously first
            for (let i = 0; i < contents.length; i++) {
              const filePath = path.join(testDir, `order-test-${i}.txt`)
              await fsp.writeFile(filePath, contents[i], 'utf8')
            }

            const results = await executeToolsSequentially(
              toolCalls,
              (name, id) => executionOrder.push(id)
            )

            // Verify execution order matches input order
            expect(executionOrder).toEqual(toolCalls.map(c => c.id))

            // Verify results are in same order as calls
            expect(results.length).toBe(toolCalls.length)
            results.forEach((result, i) => {
              expect(result.tool_use_id).toBe(toolCalls[i].id)
              expect(result.content).toBe(contents[i])
            })
          }
        ),
        { numRuns: 30 }
      )
    })

    it('should continue execution after tool errors', async () => {
      const toolCalls: ToolCall[] = [
        { id: 'tool-1', name: 'Read', input: { file_path: path.join(testDir, 'exists.txt') } },
        { id: 'tool-2', name: 'Read', input: { file_path: '/nonexistent-file.txt' } },
        { id: 'tool-3', name: 'Read', input: { file_path: path.join(testDir, 'exists2.txt') } },
      ]

      // Create the files that should exist
      await fsp.writeFile(path.join(testDir, 'exists.txt'), 'content1', 'utf8')
      await fsp.writeFile(path.join(testDir, 'exists2.txt'), 'content2', 'utf8')

      const results = await executeToolsSequentially(toolCalls)

      // All three should have results
      expect(results.length).toBe(3)
      
      // First should succeed
      expect(results[0].tool_use_id).toBe('tool-1')
      expect(results[0].content).toBe('content1')
      expect(results[0].is_error).toBeFalsy()

      // Second should fail
      expect(results[1].tool_use_id).toBe('tool-2')
      expect(results[1].is_error).toBe(true)

      // Third should succeed (execution continued after error)
      expect(results[2].tool_use_id).toBe('tool-3')
      expect(results[2].content).toBe('content2')
      expect(results[2].is_error).toBeFalsy()
    })

    it('should call onStart and onEnd callbacks in order', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (numTools) => {
            const startCalls: string[] = []
            const endCalls: string[] = []

            const toolCalls: ToolCall[] = Array.from({ length: numTools }, (_, i) => ({
              id: `tool-${i}`,
              name: 'Bash',
              input: { command: `echo ${i}` }
            }))

            await executeToolsSequentially(
              toolCalls,
              (name, id) => startCalls.push(id),
              (id) => endCalls.push(id)
            )

            // Start and end should be called for each tool
            expect(startCalls.length).toBe(numTools)
            expect(endCalls.length).toBe(numTools)

            // Order should match
            expect(startCalls).toEqual(toolCalls.map(c => c.id))
            expect(endCalls).toEqual(toolCalls.map(c => c.id))

            // Each start should come before its corresponding end
            for (let i = 0; i < numTools; i++) {
              const startIdx = startCalls.indexOf(`tool-${i}`)
              const endIdx = endCalls.indexOf(`tool-${i}`)
              expect(startIdx).toBeLessThanOrEqual(endIdx)
            }
          }
        ),
        { numRuns: 30 }
      )
    })
  })

  describe('truncateResult', () => {
    it('should truncate long results', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 600, maxLength: 2000 }),
          fc.integer({ min: 100, max: 500 }),
          (content, maxLength) => {
            const result = truncateResult(content, maxLength)
            expect(result.length).toBeLessThanOrEqual(maxLength + 3) // +3 for "..."
            expect(result.endsWith('...')).toBe(true)
          }
        ),
        { numRuns: 50 }
      )
    })

    it('should not truncate short results', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          (content) => {
            const result = truncateResult(content, 500)
            expect(result).toBe(content)
          }
        ),
        { numRuns: 50 }
      )
    })
  })
})
