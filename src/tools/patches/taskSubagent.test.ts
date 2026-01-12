import { describe, it, expect } from 'vitest'
import type { ToolDefinition } from '../types'
import { patchTaskToolForSubagents } from './taskSubagent'

function tool(name: string): ToolDefinition {
  return { name, description: `${name} desc`, input_schema: { type: 'object' } }
}

describe('patchTaskToolForSubagents', () => {
  it('overrides Task tool description and schema', () => {
    const tools: ToolDefinition[] = [
      tool('Read'),
      {
        name: 'Task',
        description: 'old',
        input_schema: { type: 'object', properties: { subagent_type: { type: 'string' } } },
      },
    ]

    const patched = patchTaskToolForSubagents(tools, [
      { name: 'code-reviewer', description: 'Reviews code' },
    ])

    const task = patched.find((t) => t.name === 'Task')
    expect(task).toBeDefined()
    expect(task!.description).toEqual('old')

    const schema = task!.input_schema as any
    expect(schema.properties?.subagent_type?.enum).toEqual(['code-reviewer'])
  })

  it('adds Task tool when missing', () => {
    const patched = patchTaskToolForSubagents([tool('Read')], [
      { name: 'code-reviewer', description: 'Reviews code' },
    ])
    expect(patched.some((t) => t.name === 'Task')).toBe(true)
  })

  it('leaves other tools untouched', () => {
    const read = tool('Read')
    const patched = patchTaskToolForSubagents([read], [])
    expect(patched.find((t) => t.name === 'Read')).toEqual(read)
  })
})
