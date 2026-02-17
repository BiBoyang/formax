import { describe, expect, it } from 'vitest'
import { buildInitPrompt } from '../../../prompts/init.js'
import { buildTurnInput } from './turnInputBuilder.js'

describe('buildTurnInput', () => {
  it('maps /init into init prompt while preserving display text', () => {
    const out = buildTurnInput({
      rawText: '/init',
      mode: 'normal',
      planPath: null,
    })

    expect(out.displayText).toBe('/init')
    expect(out.modelUserText).toBe(buildInitPrompt())
    expect(out.slash).toEqual({
      raw: '/init',
      resolved: 'model_mapped',
      commandName: '/init',
    })
    expect(out.userBlocks).toEqual([{ type: 'text', text: buildInitPrompt() }])
  })

  it('uses slash llm blocks as user blocks when provided', () => {
    const slashBlocks = [{ type: 'text' as const, text: '<command-message>cmd</command-message>' }]
    const out = buildTurnInput({
      rawText: '/permissions',
      mode: 'normal',
      planPath: null,
      slashLlmBlocks: slashBlocks,
    })

    expect(out.userBlocks).toEqual(slashBlocks)
    expect(out.displayText).toBe('/permissions')
    expect(out.slash).toEqual({
      raw: '/permissions',
      resolved: 'pass_through',
      commandName: '/permissions',
    })
  })

  it('injects mode semantics blocks into semanticBlocks', () => {
    const out = buildTurnInput({
      rawText: 'plan this',
      mode: 'plan',
      planPath: '/tmp/plan.md',
      includeExitPlanReminder: true,
    })

    expect(out.semanticBlocks.length).toBe(2)
    expect(out.injections.some((injection) => injection.kind === 'mode')).toBe(true)
    expect(out.injections.some((injection) => injection.kind === 'exit_plan_mode')).toBe(true)
    expect(out.slash).toEqual({
      raw: 'plan this',
      resolved: 'pass_through',
      commandName: null,
    })
  })
})
