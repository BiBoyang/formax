import { describe, expect, it } from 'vitest'
import { buildInitPrompt } from '../../prompts/init.js'
import { resolveSlashSemantics } from './slashSemantics.js'

describe('resolveSlashSemantics', () => {
  it('maps /init to model-mapped semantics', () => {
    const out = resolveSlashSemantics('/init')
    expect(out.commandName).toBe('/init')
    expect(out.resolved).toBe('model_mapped')
    expect(out.modelUserText).toBe(buildInitPrompt())
  })

  it('passes through non-command text', () => {
    const out = resolveSlashSemantics('hello')
    expect(out.commandName).toBeNull()
    expect(out.resolved).toBe('pass_through')
    expect(out.modelUserText).toBe('hello')
  })

  it('passes through unknown slash commands', () => {
    const out = resolveSlashSemantics('/permissions')
    expect(out.commandName).toBe('/permissions')
    expect(out.resolved).toBe('pass_through')
    expect(out.modelUserText).toBe('/permissions')
  })
})
