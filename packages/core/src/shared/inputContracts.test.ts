import { describe, expect, it } from 'vitest'
import {
  isInputKind,
  isInputPendingStatus,
  isInputResolvedStatus,
  isInputStatus,
  sourceFromInputKind,
} from './inputContracts'

describe('inputContracts', () => {
  it('recognizes valid input kinds', () => {
    expect(isInputKind('approval')).toBe(true)
    expect(isInputKind('ask_user_question')).toBe(true)
    expect(isInputKind('ask')).toBe(false)
    expect(isInputKind(undefined)).toBe(false)
  })

  it('recognizes pending and resolved statuses', () => {
    expect(isInputPendingStatus('pending')).toBe(true)
    expect(isInputPendingStatus('submitted')).toBe(false)

    expect(isInputResolvedStatus('submitted')).toBe(true)
    expect(isInputResolvedStatus('canceled')).toBe(true)
    expect(isInputResolvedStatus('expired')).toBe(true)
    expect(isInputResolvedStatus('failed')).toBe(true)
    expect(isInputResolvedStatus('pending')).toBe(false)
  })

  it('recognizes all known input statuses', () => {
    expect(isInputStatus('pending')).toBe(true)
    expect(isInputStatus('submitted')).toBe(true)
    expect(isInputStatus('canceled')).toBe(true)
    expect(isInputStatus('expired')).toBe(true)
    expect(isInputStatus('failed')).toBe(true)
    expect(isInputStatus('unknown')).toBe(false)
    expect(isInputStatus(null)).toBe(false)
  })

  it('maps input kinds to interactive sources', () => {
    expect(sourceFromInputKind('approval')).toBe('policy')
    expect(sourceFromInputKind('ask_user_question')).toBe('tool')
  })
})
