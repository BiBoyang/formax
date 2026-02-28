import { describe, expect, it, vi } from 'vitest'

vi.mock('./planModeQuestions', () => ({
  ENTER_PLAN_MODE_PROMPT: {
    question: 'Enter plan mode?',
    options: [{ label: '' }, { label: '' }],
  },
  EXIT_PLAN_MODE_PROMPT: {
    question: 'Ready to code?',
    options: [{ label: '' }, { label: '' }, { label: '' }],
  },
}))

vi.mock('./toolSemantics', () => ({
  getToolPresentationSemantic: vi.fn((toolName: string | null | undefined) => {
    if (toolName === 'enter') return 'enter_plan_mode'
    if (toolName === 'exit') return 'exit_plan_mode'
    return null
  }),
}))

describe('interactive prompts fallback labels', () => {
  it('uses fallback labels when plan-mode prompt labels are missing', async () => {
    const { resolveInteractivePromptModel } = await import('./interactivePrompts')

    const enter = resolveInteractivePromptModel({ toolName: 'enter', input: {} })
    const exit = resolveInteractivePromptModel({ toolName: 'exit', input: {} })

    expect(enter).toMatchObject({
      kind: 'enter_plan_mode',
      options: [
        { label: 'Yes, enter plan mode' },
        { label: 'No, start implementing now' },
      ],
    })
    expect(exit).toMatchObject({
      kind: 'exit_plan_mode',
      options: [
        { label: 'Yes, and auto-accept edits' },
        { label: 'Yes, and manually approve edits' },
        { label: 'Type here to tell Claude what to change' },
      ],
    })
  })
})
