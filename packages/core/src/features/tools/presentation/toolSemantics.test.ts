import { describe, expect, it } from 'vitest'
import { getToolPresentationSemantic, isAlwaysInteractiveToolName } from './toolSemantics'

describe('toolSemantics', () => {
  it('maps known tool names to canonical semantics', () => {
    expect(getToolPresentationSemantic('AskUserQuestion')).toBe('ask_user_question')
    expect(getToolPresentationSemantic('TodoWrite')).toBe('todo_write')
    expect(getToolPresentationSemantic('EnterPlanMode')).toBe('enter_plan_mode')
    expect(getToolPresentationSemantic('ExitPlanMode')).toBe('exit_plan_mode')
  })

  it('falls back to default semantic for unknown or empty tool names', () => {
    expect(getToolPresentationSemantic('Bash')).toBe('default')
    expect(getToolPresentationSemantic('')).toBe('default')
    expect(getToolPresentationSemantic(undefined)).toBe('default')
  })

  it('normalizes surrounding whitespace before semantic lookup', () => {
    expect(getToolPresentationSemantic('  AskUserQuestion  ')).toBe('ask_user_question')
  })

  it('exposes interactive-tool predicate for ask/plan tools only', () => {
    expect(isAlwaysInteractiveToolName('AskUserQuestion')).toBe(true)
    expect(isAlwaysInteractiveToolName('EnterPlanMode')).toBe(true)
    expect(isAlwaysInteractiveToolName('ExitPlanMode')).toBe(true)
    expect(isAlwaysInteractiveToolName('TodoWrite')).toBe(false)
    expect(isAlwaysInteractiveToolName('Bash')).toBe(false)
  })
})
