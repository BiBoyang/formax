import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRuntimeViewState } from './useRuntimeViewState'

describe('useRuntimeViewState', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('auto-dismisses notice message after timeout window', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useRuntimeViewState())

    act(() => {
      result.current.setNoticeMessageStable('Archived thread')
    })
    expect(result.current.noticeMessage).toBe('Archived thread')

    act(() => {
      vi.advanceTimersByTime(2599)
    })
    expect(result.current.noticeMessage).toBe('Archived thread')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.noticeMessage).toBe(null)
  })
})
