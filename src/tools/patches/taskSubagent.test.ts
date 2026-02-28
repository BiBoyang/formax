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

  it('keeps Task schema unchanged when input schema shape is unsupported', () => {
    const task: ToolDefinition = {
      name: 'Task',
      description: 'task',
      input_schema: 'not-an-object' as any,
    }
    const patched = patchTaskToolForSubagents([task], [{ name: 'agent-1', description: 'd' }])
    expect(patched.find((t) => t.name === 'Task')?.input_schema).toBe(task.input_schema)
  })

  it('keeps Task schema unchanged when object schema misses properties/subagent field', () => {
    const noProperties: ToolDefinition = {
      name: 'Task',
      description: 'task',
      input_schema: { type: 'object' },
    }
    const noSubagent: ToolDefinition = {
      name: 'Task',
      description: 'task',
      input_schema: { type: 'object', properties: { other: { type: 'string' } } },
    }
    const patchedNoProperties = patchTaskToolForSubagents([noProperties], [{ name: 'agent-1', description: 'd' }])
    const patchedNoSubagent = patchTaskToolForSubagents([noSubagent], [{ name: 'agent-1', description: 'd' }])
    expect(patchedNoProperties[0]?.input_schema).toEqual(noProperties.input_schema)
    expect(patchedNoSubagent[0]?.input_schema).toEqual(noSubagent.input_schema)
  })

  it('ignores invalid/empty subagent names and leaves schema unchanged when enum would be empty', () => {
    const task: ToolDefinition = {
      name: 'Task',
      description: 'task',
      input_schema: { type: 'object', properties: { subagent_type: { type: 'string' } } },
    }
    const patched = patchTaskToolForSubagents([task], [
      { name: '', description: 'x' },
      { name: '   ', description: 'y' },
      { name: null as any, description: 'z' },
    ])
    expect((patched[0]?.input_schema as any).properties?.subagent_type?.enum).toBeUndefined()
  })
})
