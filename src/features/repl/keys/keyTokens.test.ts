import { describe, expect, it } from 'vitest'
import {
  getVerticalArrowKeyDelta,
  getInputToken,
  isCtrlChord,
  isDeleteOrBackspaceToken,
  isPrintableToken,
  isReturnKeyToken,
  isShiftTabToken,
} from './keyTokens'

describe('keyTokens', () => {
  it('treats \\r as return even when key.return is false', () => {
    expect(isReturnKeyToken({ token: '\r', key: {} })).toBe(true)
  })

  it('treats \\n as return even when key.return is false', () => {
    expect(isReturnKeyToken({ token: '\n', key: {} })).toBe(true)
  })

  it('does not treat printable characters as return', () => {
    expect(isReturnKeyToken({ token: 'a', key: {} })).toBe(false)
  })

  it('does not treat return tokens as printable', () => {
    expect(isPrintableToken({ token: '\r', key: {} })).toBe(false)
    expect(isPrintableToken({ token: '\n', key: {} })).toBe(false)
  })

  it('prefers key.sequence when resolving input token', () => {
    expect(getInputToken({ input: 'x', key: { sequence: '\u001B[A' } })).toBe('\u001B[A')
    expect(getInputToken({ input: 'x', key: {} })).toBe('x')
  })

  it('detects ctrl chord case-insensitively', () => {
    expect(isCtrlChord({ input: 'o', key: { ctrl: true }, chord: 'o' })).toBe(true)
    expect(isCtrlChord({ input: 'O', key: { ctrl: true }, chord: 'o' })).toBe(true)
    expect(isCtrlChord({ input: 'o', key: { ctrl: false }, chord: 'o' })).toBe(false)
  })

  it('detects shift+tab from both key flags and raw sequences', () => {
    expect(isShiftTabToken({ token: '', key: { shift: true, tab: true } })).toBe(true)
    expect(isShiftTabToken({ token: '\u001B[Z', key: {} })).toBe(true)
    expect(isShiftTabToken({ token: '\u001BOZ', key: {} })).toBe(true)
  })

  it('detects delete/backspace across terminal variants', () => {
    expect(isDeleteOrBackspaceToken({ token: '\b', key: {} })).toBe(true)
    expect(isDeleteOrBackspaceToken({ token: '\x7f', key: {} })).toBe(true)
    expect(isDeleteOrBackspaceToken({ token: '\u001B[3~', key: {} })).toBe(true)
    expect(isDeleteOrBackspaceToken({ token: '', key: { name: 'backspace' } })).toBe(true)
    expect(isDeleteOrBackspaceToken({ token: '', key: { name: 'delete' } })).toBe(true)
    expect(isDeleteOrBackspaceToken({ token: '', key: { delete: true } })).toBe(true)
    expect(isDeleteOrBackspaceToken({ token: 'x', key: {} })).toBe(false)
  })

  it('returns vertical arrow key delta from key flags/name', () => {
    expect(getVerticalArrowKeyDelta({ name: 'up' })).toBe(-1)
    expect(getVerticalArrowKeyDelta({ upArrow: true })).toBe(-1)
    expect(getVerticalArrowKeyDelta({ name: 'down' })).toBe(1)
    expect(getVerticalArrowKeyDelta({ downArrow: true })).toBe(1)
    expect(getVerticalArrowKeyDelta({})).toBe(0)
  })
})
