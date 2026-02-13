import { describe, expect, it } from 'vitest'
import { resolveInteractivePromptModel } from './interactivePrompts'

describe('resolveInteractivePromptModel', () => {
  it('normalizes AskUserQuestion questions and fills missing headers', () => {
    const model = resolveInteractivePromptModel({
      toolName: 'AskUserQuestion',
      input: {
        questions: [
          {
            question: 'Choose one',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      },
    })

    expect(model?.kind).toBe('ask_user_question')
    if (!model || model.kind !== 'ask_user_question') throw new Error('expected ask model')
    expect(model.questions).toHaveLength(1)
    expect(model.questions[0]?.header).toBe('Q1')
  })

  it('returns enter plan mode prompt options with stable choices', () => {
    const model = resolveInteractivePromptModel({
      toolName: 'EnterPlanMode',
      input: {},
    })

    expect(model?.kind).toBe('enter_plan_mode')
    if (!model || model.kind !== 'enter_plan_mode') throw new Error('expected enter model')
    expect(model.options.map((option) => option.choice)).toEqual(['enter', 'skip'])
  })

  it('returns exit plan mode prompt options with feedback choice', () => {
    const model = resolveInteractivePromptModel({
      toolName: 'ExitPlanMode',
      input: {},
    })

    expect(model?.kind).toBe('exit_plan_mode')
    if (!model || model.kind !== 'exit_plan_mode') throw new Error('expected exit model')
    expect(model.options.map((option) => option.choice)).toEqual(['auto', 'manual', 'feedback'])
  })

  it('returns null for non-interactive tools', () => {
    const model = resolveInteractivePromptModel({
      toolName: 'Bash',
      input: {},
    })
    expect(model).toBeNull()
  })
})
