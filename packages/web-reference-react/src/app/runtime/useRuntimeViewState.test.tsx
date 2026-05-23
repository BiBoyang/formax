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

  it('tracks draft state with explicit enter, cwd update, and leave helpers', () => {
    const { result } = renderHook(() => useRuntimeViewState())

    expect(result.current.newThreadDraft).toEqual({ status: 'inactive' })

    act(() => {
      result.current.enterNewThreadDraft({ source: 'newThread' })
    })
    expect(result.current.newThreadDraft).toEqual({
      status: 'active',
      source: 'newThread',
      cwd: null,
    })

    act(() => {
      result.current.setNewThreadDraftCwdStable('  /repo-a  ')
    })
    expect(result.current.newThreadDraft).toEqual({
      status: 'active',
      source: 'newThread',
      cwd: '/repo-a',
    })

    act(() => {
      result.current.leaveNewThreadDraft()
    })
    expect(result.current.newThreadDraft).toEqual({ status: 'inactive' })
  })

  it('resets to a fresh draft when re-entering from the left rail new-thread action', () => {
    const { result } = renderHook(() => useRuntimeViewState())

    act(() => {
      result.current.enterNewThreadDraft({ source: 'folderQuickAction', cwd: '/repo-beta' })
    })
    expect(result.current.newThreadDraft).toEqual({
      status: 'active',
      source: 'folderQuickAction',
      cwd: '/repo-beta',
    })

    act(() => {
      result.current.enterNewThreadDraft({ source: 'newThread' })
    })
    expect(result.current.newThreadDraft).toEqual({
      status: 'active',
      source: 'newThread',
      cwd: null,
    })
  })
})
