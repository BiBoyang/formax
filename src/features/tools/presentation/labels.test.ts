import { describe, expect, it } from 'vitest'
import {
  formatItemCountLabel,
  formatQuestionCountLabel,
  summarizeAskUserQuestionStatus,
  summarizePlanModeStatus,
  summarizeTodoWriteStatus,
} from './labels'

describe('presentation labels', () => {
  it('formats question/item counts with singular/plural labels', () => {
    expect(formatQuestionCountLabel(1)).toBe('1 question')
    expect(formatQuestionCountLabel(2)).toBe('2 questions')
    expect(formatItemCountLabel(1)).toBe('1 item')
    expect(formatItemCountLabel(3)).toBe('3 items')
    expect(formatQuestionCountLabel(Number.NaN)).toBe('0 questions')
    expect(formatItemCountLabel(-3)).toBe('0 items')
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

    expect(
      summarizeAskUserQuestionStatus({
        status: 'completed',
        fallbackSummary: 'custom completed summary',
        answerCount: null,
      }),
    ).toBe('custom completed summary')

    expect(
      summarizeAskUserQuestionStatus({
        status: 'completed',
        fallbackSummary: '   ',
        answerCount: null,
      }),
    ).toBe('Answered')
  })

  it('summarizes todowrite status consistently', () => {
    expect(summarizeTodoWriteStatus({ status: 'running', fallbackSummary: 'custom' })).toBe('Updating todo list')
    expect(summarizeTodoWriteStatus({ status: 'completed', fallbackSummary: 'custom' })).toBe('Updated todo list')
    expect(summarizeTodoWriteStatus({ status: 'error', fallbackSummary: 'Failed' })).toBe('Failed')
  })

  it('summarizes plan-mode tool status consistently', () => {
    expect(
      summarizePlanModeStatus({
        kind: 'enter',
        status: 'running',
        fallbackSummary: '',
      }),
    ).toBe('Waiting for confirmation')
    expect(
      summarizePlanModeStatus({
        kind: 'exit',
        status: 'running',
        fallbackSummary: '',
      }),
    ).toBe('Waiting for implementation decision')

    expect(
      summarizePlanModeStatus({
        kind: 'enter',
        status: 'completed',
        fallbackSummary: 'Entered plan mode.',
      }),
    ).toBe('Entered plan mode')

    expect(
      summarizePlanModeStatus({
        kind: 'enter',
        status: 'completed',
        fallbackSummary: 'User declined plan mode.',
      }),
    ).toBe('Plan mode skipped')

    expect(
      summarizePlanModeStatus({
        kind: 'exit',
        status: 'completed',
        fallbackSummary: 'User has approved your plan. You can now start coding.',
      }),
    ).toBe('Plan approved. You can start coding.')

    expect(
      summarizePlanModeStatus({
        kind: 'exit',
        status: 'completed',
        fallbackSummary: 'Exited plan mode.',
      }),
    ).toBe('Exited plan mode.')
    expect(
      summarizePlanModeStatus({
        kind: 'exit',
        status: 'error',
        fallbackSummary: '   ',
      }),
    ).toBe('Failed')
    expect(
      summarizePlanModeStatus({
        kind: 'exit',
        status: 'completed',
        fallbackSummary: '   ',
      }),
    ).toBe('Completed')
  })
})
