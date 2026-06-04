import { describe, expect, it } from 'vitest'
import { createMcpToolCatalog, createMcpToolDefinition } from './toolCatalog.js'

describe('MCP tool catalog', () => {
  it('maps MCP metadata into first-class ToolDefinition objects', () => {
    expect(createMcpToolDefinition('github', {
      name: 'create_issue',
      description: 'Create an issue',
      inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
    })).toEqual({
      name: 'mcp__github__create_issue',
      description: 'Create an issue',
      input_schema: { type: 'object', properties: { title: { type: 'string' } } },
    })
  })

  it('drops tools with non-object-root input schemas before exposing them', () => {
    const catalog = createMcpToolCatalog([
      { serverId: 'server', tools: [
        { name: 'any', inputSchema: false },
        { name: 'stringy', inputSchema: { type: 'string' } },
        { name: 'ambiguous', inputSchema: { oneOf: [{ type: 'object' }, { type: 'string' }] } },
      ] },
    ])

    expect(catalog.bindings).toEqual([])
    expect(catalog.diagnostics).toEqual([
      {
        type: 'invalid-input-schema',
        modelName: 'mcp__server__ambiguous',
        dropped: { serverId: 'server', toolName: 'ambiguous' },
      },
      {
        type: 'invalid-input-schema',
        modelName: 'mcp__server__any',
        dropped: { serverId: 'server', toolName: 'any' },
      },
      {
        type: 'invalid-input-schema',
        modelName: 'mcp__server__stringy',
        dropped: { serverId: 'server', toolName: 'stringy' },
      },
    ])
  })

  it('keeps the deterministic first duplicate winner and drops later bindings', () => {
    const catalog = createMcpToolCatalog([
      { serverId: 'b server', tools: [{ name: 'do thing', inputSchema: { type: 'object', properties: { z: { type: 'number' } } } }] },
      { serverId: 'a/server', tools: [{ name: 'do/thing', inputSchema: { type: 'object', properties: { a: { type: 'number' } } } }] },
      { serverId: 'a server', tools: [{ name: 'do thing', inputSchema: { type: 'object', properties: { a: { type: 'string' } } } }] },
    ])

    expect(catalog.bindings.map((binding) => ({
      modelName: binding.modelName,
      serverId: binding.serverId,
      originalServerId: binding.originalServerId,
      toolName: binding.toolName,
      originalToolName: binding.originalToolName,
    }))).toEqual([
      { modelName: 'mcp__a_server__do_thing', serverId: 'a_server', originalServerId: 'a server', toolName: 'do_thing', originalToolName: 'do thing' },
      { modelName: 'mcp__b_server__do_thing', serverId: 'b_server', originalServerId: 'b server', toolName: 'do_thing', originalToolName: 'do thing' },
    ])
    expect(catalog.diagnostics).toEqual([
      {
        type: 'duplicate-tool-name',
        modelName: 'mcp__a_server__do_thing',
        kept: { serverId: 'a server', toolName: 'do thing' },
        dropped: { serverId: 'a/server', toolName: 'do/thing' },
      },
    ])
  })

  it('breaks normalized tool-name ties by the original tool name', () => {
    const catalog = createMcpToolCatalog([
      { serverId: 'same', tools: [{ name: 'z/tool' }, { name: 'z tool' }] },
    ])

    expect(catalog.bindings).toHaveLength(1)
    expect(catalog.bindings[0]?.toolName).toBe('z_tool')
    expect(catalog.bindings[0]?.originalToolName).toBe('z tool')
    expect(catalog.diagnostics).toEqual([
      {
        type: 'duplicate-tool-name',
        modelName: 'mcp__same__z_tool',
        kept: { serverId: 'same', toolName: 'z tool' },
        dropped: { serverId: 'same', toolName: 'z/tool' },
      },
    ])
  })

  it('drops names reserved by built-in tools', () => {
    const catalog = createMcpToolCatalog([
      { serverId: 'github', tools: [{ name: 'create_issue' }] },
    ], { reservedToolNames: ['mcp__github__create_issue'] })

    expect(catalog.bindings).toEqual([])
    expect(catalog.diagnostics).toEqual([
      {
        type: 'reserved-tool-name',
        modelName: 'mcp__github__create_issue',
        dropped: { serverId: 'github', toolName: 'create_issue' },
      },
    ])
  })

  it('computes stable schema fingerprints independent of object key order', () => {
    const [a, b] = createMcpToolCatalog([
      { serverId: 'one', tools: [{ name: 'x', inputSchema: { type: 'object', b: 2, a: 1 } }] },
      { serverId: 'two', tools: [{ name: 'x', inputSchema: { a: 1, b: 2, type: 'object' } }] },
    ]).bindings

    expect(a?.schemaFingerprint).toBe(b?.schemaFingerprint)
  })
})
