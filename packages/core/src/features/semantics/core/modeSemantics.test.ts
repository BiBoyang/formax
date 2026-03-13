import { describe, expect, it } from 'vitest'
import { buildModeSemantics } from './modeSemantics.js'

describe('buildModeSemantics', () => {
  it('returns plan reminder block in plan mode', () => {
    const out = buildModeSemantics({
      mode: 'plan',
      planPath: '/tmp/plan.md',
    })

    expect(out.blocks).toHaveLength(1)
    expect(out.blocks[0]?.type).toBe('text')
    expect((out.blocks[0] as { text?: string }).text).toContain('Plan mode is active')
    expect(out.injections).toHaveLength(1)
    expect(out.injections[0]?.kind).toBe('mode')
  })

  it('returns no mode block in normal mode', () => {
    const out = buildModeSemantics({
      mode: 'normal',
      planPath: null,
    })
    expect(out.blocks).toHaveLength(0)
    expect(out.injections).toHaveLength(0)
  })

  it('appends exit-plan reminder when requested', () => {
    const out = buildModeSemantics({
      mode: 'acceptEdits',
      planPath: '/tmp/plan.md',
      includeExitPlanReminder: true,
    })

    expect(out.blocks).toHaveLength(1)
    expect((out.blocks[0] as { text?: string }).text).toContain('Exited Plan Mode')
    expect(out.injections).toHaveLength(1)
    expect(out.injections[0]?.kind).toBe('exit_plan_mode')
  })
})
