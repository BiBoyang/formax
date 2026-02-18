import { describe, it, expect, vi } from 'vitest'
import { handleCtrlCKeypress } from './hotkeys.js'

describe('handleCtrlCKeypress', () => {
  it('uses 1500ms default arm window', () => {
    const setInput = vi.fn()
    const setSlashIndex = vi.fn()
    const setSlashSelectionTouched = vi.fn()
    const setCtrlCArmedUntilMs = vi.fn()

    const res = handleCtrlCKeypress({
      ctrlCArmedUntilMs: null,
      setCtrlCArmedUntilMs,
      setInput,
      setSlashIndex,
      setSlashSelectionTouched,
      nowMs: 1000,
    })

    expect(res).toBe('armed')
    expect(setCtrlCArmedUntilMs).toHaveBeenCalledWith(2500)
  })

  it('arms exit on first Ctrl+C and clears the prompt', () => {
    const setInput = vi.fn()
    const setSlashIndex = vi.fn()
    const setSlashSelectionTouched = vi.fn()
    const setCtrlCArmedUntilMs = vi.fn()
    const onExit = vi.fn()

    const res = handleCtrlCKeypress({
      onExit,
      ctrlCArmedUntilMs: null,
      setCtrlCArmedUntilMs,
      setInput,
      setSlashIndex,
      setSlashSelectionTouched,
      nowMs: 1000,
      windowMs: 2000,
    })

    expect(res).toBe('armed')
    expect(onExit).not.toHaveBeenCalled()
    expect(setInput).toHaveBeenCalledWith('')
    expect(setSlashIndex).toHaveBeenCalledWith(0)
    expect(setSlashSelectionTouched).toHaveBeenCalledWith(false)
    expect(setCtrlCArmedUntilMs).toHaveBeenCalledWith(3000)
  })

  it('exits on second Ctrl+C within the arm window', () => {
    const setInput = vi.fn()
    const setSlashIndex = vi.fn()
    const setSlashSelectionTouched = vi.fn()
    const setCtrlCArmedUntilMs = vi.fn()
    const onExit = vi.fn()

    const res = handleCtrlCKeypress({
      onExit,
      ctrlCArmedUntilMs: 3000,
      setCtrlCArmedUntilMs,
      setInput,
      setSlashIndex,
      setSlashSelectionTouched,
      nowMs: 2500,
      windowMs: 2000,
    })

    expect(res).toBe('exit')
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(setInput).not.toHaveBeenCalled()
    expect(setSlashIndex).not.toHaveBeenCalled()
    expect(setSlashSelectionTouched).not.toHaveBeenCalled()
    expect(setCtrlCArmedUntilMs).not.toHaveBeenCalled()
  })

  it('re-arms if Ctrl+C is pressed after the window expires', () => {
    const setInput = vi.fn()
    const setSlashIndex = vi.fn()
    const setSlashSelectionTouched = vi.fn()
    const setCtrlCArmedUntilMs = vi.fn()
    const onExit = vi.fn()

    const res = handleCtrlCKeypress({
      onExit,
      ctrlCArmedUntilMs: 3000,
      setCtrlCArmedUntilMs,
      setInput,
      setSlashIndex,
      setSlashSelectionTouched,
      nowMs: 4000,
      windowMs: 2000,
    })

    expect(res).toBe('armed')
    expect(onExit).not.toHaveBeenCalled()
    expect(setInput).toHaveBeenCalledWith('')
    expect(setSlashIndex).toHaveBeenCalledWith(0)
    expect(setSlashSelectionTouched).toHaveBeenCalledWith(false)
    expect(setCtrlCArmedUntilMs).toHaveBeenCalledWith(6000)
  })
})
