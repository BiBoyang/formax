import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDevLoadAllHistory } from './useDevLoadAllHistory'

type HookProps = {
  enabled: boolean
  activeThreadId: string | null
  activeHistoryLoading: boolean
  historyMore: boolean
}

describe('useDevLoadAllHistory', () => {
  it('starts only when enabled and active thread exists', async () => {
    const loadEarlierHistory = vi.fn(async () => undefined)
    const { result, rerender } = renderHook(
      (props: HookProps) =>
        useDevLoadAllHistory({
          ...props,
          loadEarlierHistory,
        }),
      {
        initialProps: {
          enabled: false,
          activeThreadId: 'thread-1',
          activeHistoryLoading: false,
          historyMore: false,
        },
      },
    )

    act(() => {
      result.current.requestStart()
    })
    await waitFor(() => {
      expect(loadEarlierHistory).toHaveBeenCalledTimes(0)
    })

    rerender({
      enabled: true,
      activeThreadId: 'thread-1',
      activeHistoryLoading: false,
      historyMore: false,
    })

    act(() => {
      result.current.requestStart()
    })

    await waitFor(() => {
      expect(loadEarlierHistory).toHaveBeenCalledTimes(1)
    })
  })

  it('loads earlier history immediately when history cursor is available', async () => {
    const loadEarlierHistory = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      useDevLoadAllHistory({
        enabled: true,
        activeThreadId: 'thread-1',
        activeHistoryLoading: false,
        historyMore: true,
        loadEarlierHistory,
      }),
    )

    act(() => {
      result.current.requestStart()
    })

    await waitFor(() => {
      expect(loadEarlierHistory).toHaveBeenCalledTimes(1)
    })
  })

  it('runs bootstrap load when historyMore is false', async () => {
    const loadEarlierHistory = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      useDevLoadAllHistory({
        enabled: true,
        activeThreadId: 'thread-1',
        activeHistoryLoading: false,
        historyMore: false,
        loadEarlierHistory,
      }),
    )

    act(() => {
      result.current.requestStart()
    })

    await waitFor(() => {
      expect(loadEarlierHistory).toHaveBeenCalledTimes(1)
    })
  })

  it('runs two bootstrap attempts after history loading was observed', async () => {
    const loadEarlierHistory = vi.fn(async () => undefined)
    const { result, rerender } = renderHook(
      (props: HookProps) =>
        useDevLoadAllHistory({
          ...props,
          loadEarlierHistory,
        }),
      {
        initialProps: {
          enabled: true,
          activeThreadId: 'thread-1',
          activeHistoryLoading: true,
          historyMore: false,
        },
      },
    )

    act(() => {
      result.current.requestStart()
    })

    rerender({
      enabled: true,
      activeThreadId: 'thread-1',
      activeHistoryLoading: false,
      historyMore: false,
    })

    await waitFor(() => {
      expect(loadEarlierHistory).toHaveBeenCalledTimes(2)
    })
  })

  it('resets running state when active thread becomes null', async () => {
    const loadEarlierHistory = vi.fn(async () => undefined)
    const { result, rerender } = renderHook(
      (props: HookProps) =>
        useDevLoadAllHistory({
          ...props,
          loadEarlierHistory,
        }),
      {
        initialProps: {
          enabled: true,
          activeThreadId: 'thread-1',
          activeHistoryLoading: false,
          historyMore: true,
        } as HookProps,
      },
    )

    act(() => {
      result.current.requestStart()
    })

    await waitFor(() => {
      expect(result.current.running).toBe(true)
    })

    rerender({
      enabled: true,
      activeThreadId: null,
      activeHistoryLoading: false,
      historyMore: false,
    } as HookProps)

    await waitFor(() => {
      expect(result.current.running).toBe(false)
    })
  })
})
