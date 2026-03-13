import { describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from './registry'

describe('ToolRegistry', () => {
  it('registers handlers, presenters, specs, aliases, and meta', () => {
    const registry = new ToolRegistry()
    const handler = {
      canHandle: vi.fn(() => true),
      execute: vi.fn(async () => ({ tool_use_id: 'toolu_read', content: 'ok' })),
    }
    const presenter = vi.fn() as any

    registry.register({
      name: 'read',
      aliases: ['cat', 'open'],
      handler,
      presenter,
      spec: { name: 'read', description: 'read file', input_schema: {} },
      meta: { interactive: true },
    })

    expect(registry.getHandlers()).toEqual([handler])
    expect(registry.getPresenter('read')).toBe(presenter)
    expect(registry.getPresenter('cat')).toBe(presenter)
    expect(registry.resolveName('open')).toBe('read')
    expect(registry.getMeta('cat')).toEqual({ interactive: true })
  })

  it('returns defensive copy for handlers', () => {
    const registry = new ToolRegistry()
    const handler = {
      canHandle: vi.fn(() => true),
      execute: vi.fn(async () => ({ tool_use_id: 'toolu_a', content: 'ok' })),
    }
    registry.register({ name: 'a', handler })

    const handlers = registry.getHandlers()
    handlers.push({
      canHandle: vi.fn(() => true),
      execute: vi.fn(async () => ({ tool_use_id: 'toolu_b', content: 'ok' })),
    })

    expect(registry.getHandlers()).toEqual([handler])
  })

  it('listSpecs supports function specs (base may be undefined)', async () => {
    const registry = new ToolRegistry()

    registry.register({
      name: 'toolA',
      spec: (base) => ({
        name: 'toolA',
        description: `${base?.description ?? ''}+next`,
        input_schema: { ...(base?.input_schema as any), b: 2, baseWasMissing: !base },
      }),
    })

    const specs = await registry.listSpecs()
    expect(specs).toEqual([
      { name: 'toolA', description: '+next', input_schema: { b: 2, baseWasMissing: true } },
    ])
  })

  it('applies patches in sequence', async () => {
    const registry = new ToolRegistry()
    registry.register({ name: 'a', spec: { name: 'a', description: 'A', input_schema: {} } })
    registry.register({ name: 'b', spec: { name: 'b', description: 'B', input_schema: {} } })

    registry.addPatch((tools) => tools.filter((t) => t.name !== 'a'))
    registry.addPatch((tools) => [...tools, { name: 'c', description: 'C', input_schema: {} }])

    await expect(registry.listSpecs()).resolves.toEqual([
      { name: 'b', description: 'B', input_schema: {} },
      { name: 'c', description: 'C', input_schema: {} },
    ])
  })

  it('handles modules without optional fields', async () => {
    const registry = new ToolRegistry()
    registry.register({ name: 'x' })

    expect(registry.resolveName('x')).toBe('x')
    expect(registry.getPresenter('x')).toBeUndefined()
    expect(registry.getMeta('x')).toBeUndefined()
    await expect(registry.listSpecs()).resolves.toEqual([])
  })
})
