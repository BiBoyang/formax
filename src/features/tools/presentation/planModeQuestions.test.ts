import { describe, expect, it } from 'vitest'
import { ENTER_PLAN_MODE_QUESTIONS, EXIT_PLAN_MODE_QUESTIONS } from './planModeQuestions'

describe('planModeQuestions', () => {
  it('defines stable enter-plan options for ask payload + presenter copy', () => {
    const first = ENTER_PLAN_MODE_QUESTIONS[0]
    expect(first?.question).toBe('Enter plan mode?')
    expect(first?.options.map((option) => option.label)).toEqual([
      'Yes, enter plan mode',
      'No, start implementing now',
    ])
  })

  it('defines stable exit-plan options for ask payload + presenter copy', () => {
    const first = EXIT_PLAN_MODE_QUESTIONS[0]
    expect(first?.question).toBe('Ready to code?')
    expect(first?.options.map((option) => option.label)).toEqual([
      'Yes, and auto-accept edits',
      'Yes, and manually approve edits',
      'Type here to tell Claude what to change',
    ])
  })
})

