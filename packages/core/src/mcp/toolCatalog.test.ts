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

  it('does not project MCP annotations into model-facing ToolDefinition objects', () => {
    expect(createMcpToolDefinition('github', {
      name: 'delete_repo',
      description: 'Delete repo',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
    })).toEqual({
      name: 'mcp__github__delete_repo',
      description: 'Delete repo',
      input_schema: { type: 'object' },
    })
  })

  it('normalizes true schemas to object-root model-facing schemas', () => {
    expect(createMcpToolDefinition('loose', {
      name: 'ping',
      inputSchema: true,
    }).input_schema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: true,
    })
  })

  it('normalizes permissive object schemas to the handler contract before model exposure', () => {
    expect(createMcpToolDefinition('loose', {
      name: 'metadata_only',
      inputSchema: { title: 'Loose args', description: 'Any object args' },
    }).input_schema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: true,
    })
  })

  it('normalizes object unions to the object-only handler contract before model exposure', () => {
    expect(createMcpToolDefinition('loose', {
      name: 'nullable',
      inputSchema: { type: ['object', 'null'], properties: { id: { type: 'string' } } },
    }).input_schema).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    })
  })

  it('drops tools with non-object-root input schemas before exposing them', () => {
    const catalog = createMcpToolCatalog([
      { serverId: 'server', tools: [
        { name: 'boolean_schema', inputSchema: false },
        { name: 'arrayish', inputSchema: { type: ['array', 'string'] } },
        { name: 'stringy', inputSchema: { type: 'string' } },
      ] },
    ])

    expect(catalog.bindings).toEqual([])
    expect(catalog.diagnostics).toEqual([
      {
        type: 'invalid-input-schema',
        modelName: 'mcp__server__arrayish',
        dropped: { serverId: 'server', toolName: 'arrayish' },
      },
      {
        type: 'invalid-input-schema',
        modelName: 'mcp__server__boolean_schema',
        dropped: { serverId: 'server', toolName: 'boolean_schema' },
      },
      {
        type: 'invalid-input-schema',
        modelName: 'mcp__server__stringy',
        dropped: { serverId: 'server', toolName: 'stringy' },
      },
    ])
  })

  it('keeps common object-root schemas that omit literal top-level type object', () => {
    const catalog = createMcpToolCatalog([
      { serverId: 'server', tools: [
        { name: 'empty', inputSchema: {} },
        { name: 'metadata_only', inputSchema: { title: 'Loose args', description: 'Any object args' } },
        { name: 'properties_only', inputSchema: { properties: { title: { type: 'string' } }, required: ['title'] } },
        { name: 'ref_root', inputSchema: { $ref: '#/$defs/Input', $defs: { Input: { type: 'object' } } } },
        { name: 'all_of', inputSchema: { allOf: [{ type: 'object', properties: { id: { type: 'string' } } }] } },
        { name: 'any_of_objects', inputSchema: { anyOf: [{ type: 'object' }, { properties: { id: { type: 'string' } } }] } },
        { name: 'const_object', inputSchema: { const: { id: 1 } } },
        { name: 'enum_objects', inputSchema: { enum: [{ id: 1 }, { id: 2 }] } },
        { name: 'one_of_objects', inputSchema: { oneOf: [{ type: 'object' }, { required: ['id'] }] } },
        { name: 'type_array', inputSchema: { type: ['object', 'null'], properties: { id: { type: 'string' } } } },
      ] },
    ])

    expect(catalog.diagnostics).toEqual([])
    expect(catalog.bindings.map((binding) => binding.modelName)).toEqual([
      'mcp__server__all_of',
      'mcp__server__any_of_objects',
      'mcp__server__const_object',
      'mcp__server__empty',
      'mcp__server__enum_objects',
      'mcp__server__metadata_only',
      'mcp__server__one_of_objects',
      'mcp__server__properties_only',
      'mcp__server__ref_root',
      'mcp__server__type_array',
    ])
  })

  it('drops ambiguous or non-object schemas that omit literal top-level type object', () => {
    const catalog = createMcpToolCatalog([
      { serverId: 'server', tools: [
        { name: 'const_root', inputSchema: { const: 'value' } },
        { name: 'enum_mixed', inputSchema: { enum: [{ id: 1 }, 'value'] } },
        { name: 'one_of_mixed', inputSchema: { oneOf: [{ type: 'object' }, { type: 'string' }] } },
        { name: 'ref_missing', inputSchema: { $ref: '#/$defs/Missing', $defs: {} } },
        { name: 'ref_string', inputSchema: { $ref: '#/$defs/Input', $defs: { Input: { type: 'string' } } } },
      ] },
    ])

    expect(catalog.bindings).toEqual([])
    expect(catalog.diagnostics).toEqual([
      {
        type: 'invalid-input-schema',
        modelName: 'mcp__server__const_root',
        dropped: { serverId: 'server', toolName: 'const_root' },
      },
      {
        type: 'invalid-input-schema',
        modelName: 'mcp__server__enum_mixed',
        dropped: { serverId: 'server', toolName: 'enum_mixed' },
      },
      {
        type: 'invalid-input-schema',
        modelName: 'mcp__server__one_of_mixed',
        dropped: { serverId: 'server', toolName: 'one_of_mixed' },
      },
      {
        type: 'invalid-input-schema',
        modelName: 'mcp__server__ref_missing',
        dropped: { serverId: 'server', toolName: 'ref_missing' },
      },
      {
        type: 'invalid-input-schema',
        modelName: 'mcp__server__ref_string',
        dropped: { serverId: 'server', toolName: 'ref_string' },
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
