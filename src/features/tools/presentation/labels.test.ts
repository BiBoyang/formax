import { describe, expect, it } from 'vitest'
import {
  formatItemCountLabel,
  formatQuestionCountLabel,
  summarizeAskUserQuestionStatus,
  summarizeTodoWriteStatus,
} from './labels'

describe('presentation labels', () => {
  it('formats question/item counts with singular/plural labels', () => {
    expect(formatQuestionCountLabel(1)).toBe('1 question')
    expect(formatQuestionCountLabel(2)).toBe('2 questions')
    expect(formatItemCountLabel(1)).toBe('1 item')
    expect(formatItemCountLabel(3)).toBe('3 items')
  })

  it('summarizes ask-user-question status consistently', () => {
    expect(
      summarizeAskUserQuestionStatus({
        status: 'running',
        fallbackSummary: 'custom',
        answerCount: null,
      }),
    ).toBe('Waiting for answers')

    expect(
      summarizeAskUserQuestionStatus({
        status: 'completed',
        fallbackSummary: '',
        answerCount: 2,
      }),
    ).toBe('Answered 2 questions')

    expect(
      summarizeAskUserQuestionStatus({
        status: 'completed',
        fallbackSummary: '',
        answerCount: 0,
      }),
    ).toBe('Answered')

    expect(
      summarizeAskUserQuestionStatus({
        status: 'error',
        fallbackSummary: 'Error',
        answerCount: null,
      }),
    ).toBe('Error')
  })

  it('summarizes todowrite status consistently', () => {
    expect(summarizeTodoWriteStatus({ status: 'running', fallbackSummary: 'custom' })).toBe('Updating todo list')
    expect(summarizeTodoWriteStatus({ status: 'completed', fallbackSummary: 'custom' })).toBe('Updated todo list')
    expect(summarizeTodoWriteStatus({ status: 'error', fallbackSummary: 'Failed' })).toBe('Failed')
  })
})
