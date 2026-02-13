import { describe, expect, it } from 'vitest'
import {
  ENTER_PLAN_MODE_PROMPT,
  ENTER_PLAN_MODE_QUESTIONS,
  EXIT_PLAN_MODE_PROMPT,
  EXIT_PLAN_MODE_QUESTIONS,
} from './planModeQuestions'

describe('planModeQuestions', () => {
  it('defines stable enter-plan options for ask payload + presenter copy', () => {
    expect(ENTER_PLAN_MODE_PROMPT.question).toBe('Enter plan mode?')
    expect(ENTER_PLAN_MODE_PROMPT.options.map((option) => option.label)).toEqual([
      'Yes, enter plan mode',
      'No, start implementing now',
    ])
    expect(ENTER_PLAN_MODE_QUESTIONS).toEqual([ENTER_PLAN_MODE_PROMPT])
  })

  it('defines stable exit-plan options for ask payload + presenter copy', () => {
    expect(EXIT_PLAN_MODE_PROMPT.question).toBe('Ready to code?')
    expect(EXIT_PLAN_MODE_PROMPT.options.map((option) => option.label)).toEqual([
      'Yes, and auto-accept edits',
      'Yes, and manually approve edits',
      'Type here to tell Claude what to change',
    ])
    expect(EXIT_PLAN_MODE_QUESTIONS).toEqual([EXIT_PLAN_MODE_PROMPT])
  })
})
