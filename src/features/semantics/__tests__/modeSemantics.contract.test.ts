import { describe, expect, it } from 'vitest'
import { buildModeSemantics } from '../modeSemantics.js'

describe('ModeSemantics contract', () => {
  it('keeps mode prompt injection stable', () => {
    const cases = [
      { mode: 'normal' as const, planPath: null, includeExitPlanReminder: false },
      { mode: 'acceptEdits' as const, planPath: '/tmp/plan.md', includeExitPlanReminder: false },
      { mode: 'plan' as const, planPath: '/tmp/plan.md', includeExitPlanReminder: false },
      { mode: 'acceptEdits' as const, planPath: '/tmp/plan.md', includeExitPlanReminder: true },
    ]

    const actual = cases.map((c) => {
      const out = buildModeSemantics(c)
      return {
        mode: c.mode,
        includeExitPlanReminder: c.includeExitPlanReminder,
        blockCount: out.blocks.length,
        injectionKinds: out.injections.map((i) => i.kind),
      }
    })

    expect(actual).toEqual([
      { mode: 'normal', includeExitPlanReminder: false, blockCount: 0, injectionKinds: [] },
      { mode: 'acceptEdits', includeExitPlanReminder: false, blockCount: 0, injectionKinds: [] },
      { mode: 'plan', includeExitPlanReminder: false, blockCount: 1, injectionKinds: ['mode'] },
      { mode: 'acceptEdits', includeExitPlanReminder: true, blockCount: 1, injectionKinds: ['exit_plan_mode'] },
    ])
  })
})
