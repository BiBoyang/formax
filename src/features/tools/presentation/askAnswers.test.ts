import { describe, expect, it } from 'vitest'
import { parseAskAnswerLines, parseAskAnswers } from './askAnswers'

describe('ask answers helpers', () => {
  it('parses answers from ask-user-question tool result payload', () => {
    expect(parseAskAnswers('{"answers":{"Q1":"Yes","Q2":"No"}}')).toEqual({
      Q1: 'Yes',
      Q2: 'No',
    })
    expect(parseAskAnswers('{"answers":{"Q3":null,"Q4":123}}')).toEqual({
      Q3: '',
      Q4: '123',
    })
  })

  it('returns null for invalid payloads', () => {
    expect(parseAskAnswers('')).toBeNull()
    expect(parseAskAnswers('not-json')).toBeNull()
    expect(parseAskAnswers('{"answers":[]}')).toBeNull()
  })

  it('parses answer summary lines from detail lines', () => {
    expect(parseAskAnswerLines(['{"answers":{"Q1":"A"}}'])).toEqual({
      answerCount: 1,
      lines: ['Q1: A'],
    })
  })

  it('returns null for non-JSON-like or empty answer lines', () => {
    expect(parseAskAnswerLines([])).toBeNull()
    expect(parseAskAnswerLines('oops' as any)).toBeNull()
    expect(parseAskAnswerLines(['hello'])).toBeNull()
    expect(parseAskAnswerLines(['{"notAnswers":{}}'])).toBeNull()
  })
})
