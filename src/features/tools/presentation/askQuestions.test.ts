import { describe, expect, it } from 'vitest'
import {
  buildAskAnswersFromDraft,
  fieldIdForAskQuestion,
  normalizeAskQuestions,
  type PresentationAskQuestion,
} from './askQuestions'

describe('ask questions helpers', () => {
  it('normalizes ask-question payload and filters invalid entries', () => {
    const questions = normalizeAskQuestions({
      questions: [
        null,
        {
          question: 'Pick one',
          header: 'Platform',
          fieldId: 'platform',
          options: [
            { label: 'Mac', description: '' },
            { label: '', description: 'invalid' },
          ],
          multiSelect: false,
        },
      ],
    })

    expect(questions).toEqual([
      {
        question: 'Pick one',
        header: 'Platform',
        fieldId: 'platform',
        options: [{ label: 'Mac', description: '' }],
        multiSelect: false,
      },
    ])
  })

  it('resolves field ids with fallback order', () => {
    const q1: PresentationAskQuestion = {
      question: 'Q1?',
      header: 'Header',
      fieldId: 'field',
      options: [],
      multiSelect: false,
    }
    const q2: PresentationAskQuestion = { ...q1, fieldId: undefined }
    const q3: PresentationAskQuestion = { ...q2, header: '' }
    const q4: PresentationAskQuestion = { ...q3, question: '' }

    expect(fieldIdForAskQuestion(q1, 0)).toBe('field')
    expect(fieldIdForAskQuestion(q2, 0)).toBe('Header')
    expect(fieldIdForAskQuestion(q3, 0)).toBe('Q1?')
    expect(fieldIdForAskQuestion(q4, 1)).toBe('question_2')
  })

  it('builds answer payload from draft values using normalized field ids', () => {
    const questions: PresentationAskQuestion[] = [
      {
        question: 'Pick platform',
        header: 'Platform',
        fieldId: 'platform',
        options: [],
        multiSelect: false,
      },
      {
        question: 'Theme',
        header: '',
        options: [],
        multiSelect: false,
      },
    ]
    expect(buildAskAnswersFromDraft(questions, { platform: 'Mac', Theme: 'dark' })).toEqual({
      platform: 'Mac',
      Theme: 'dark',
    })
  })
})
