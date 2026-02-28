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

  it('handles non-object payloads and non-array questions safely', () => {
    expect(normalizeAskQuestions(null)).toEqual([])
    expect(normalizeAskQuestions({ questions: 'nope' })).toEqual([])
  })

  it('normalizes edge fields and option descriptions', () => {
    const questions = normalizeAskQuestions({
      questions: [
        {
          question: 1,
          header: '   ',
          fieldId: '   ',
          options: [{ label: 'A', description: 1 }, { description: 'missing label' }],
          multiSelect: 'yes',
        },
      ],
    })

    expect(questions).toEqual([
      {
        question: '',
        header: '',
        fieldId: undefined,
        options: [{ label: 'A', description: '' }],
        multiSelect: true,
      },
    ])
  })

  it('handles non-array options and non-record option rows', () => {
    const withNonArrayOptions = normalizeAskQuestions({
      questions: [{ question: 'Q', header: 'H', options: 'bad' }],
    })
    const withNonRecordOption = normalizeAskQuestions({
      questions: [{ question: 'Q', header: 'H', options: [1, { label: 'L', description: 'D' }] }],
    })

    expect(withNonArrayOptions[0]?.options).toEqual([])
    expect(withNonRecordOption[0]?.options).toEqual([{ label: 'L', description: 'D' }])
  })

  it('trims fallback keys and defaults missing draft values to empty strings', () => {
    const questions: PresentationAskQuestion[] = [
      { question: '  Q  ', header: '  H  ', fieldId: '   ', options: [], multiSelect: false },
    ]
    expect(fieldIdForAskQuestion(questions[0], 0)).toBe('H')
    expect(buildAskAnswersFromDraft(questions, {})).toEqual({ H: '' })
  })

  it('falls back to generated question key when header/question are non-strings', () => {
    const key = fieldIdForAskQuestion(
      { fieldId: undefined, header: 1 as any, question: 2 as any, options: [], multiSelect: false },
      2,
    )
    expect(key).toBe('question_3')
  })
})
