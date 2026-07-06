import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ImperativePanelGroupHandle } from 'react-resizable-panels'
import { useTerminalVisibility } from './useTerminalVisibility'

describe('useTerminalVisibility', () => {
  function createTerminalBridge(): NonNullable<Parameters<typeof useTerminalVisibility>[0]['terminalBridge']> {
    return {
      ensureSession: vi.fn(async () => ({ created: false, exists: true })),
      getSnapshot: vi.fn(async () => ({
        exists: true,
        output: '',
      })),
      write: vi.fn(async () => true),
      resize: vi.fn(async () => true),
      destroySession: vi.fn(async () => true),
      subscribe: vi.fn(() => () => undefined),
    }
  }

  it('clears the resident terminal when leaving the thread surface', async () => {
    const setLayout = vi.fn()
    type HookArgs = Parameters<typeof useTerminalVisibility>[0]
    type HookProps = Pick<HookArgs, 'activeThreadCwd' | 'activeThreadId' | 'isSettingsOpen' | 'selectedCwd'>
    const terminalPanelGroupRef = {
      current: {
        getLayout: () => [68, 32],
        setLayout,
        getId: () => 'terminal-test-group',
      } as unknown as ImperativePanelGroupHandle,
    }
    const terminalBridge = createTerminalBridge()
    const sortedThreads: HookArgs['sortedThreads'] = [
      {
        id: 'thread-1',
        cwd: '/repo',
        createdAt: '2026-05-23T00:00:00.000Z',
        updatedAt: '2026-05-23T00:00:00.000Z',
        messageCount: 1,
        label: null,
        lastUserPrompt: null,
        title: 'thread-1',
      },
    ]

    const { result, rerender } = renderHook(
      (props: HookProps) => useTerminalVisibility({
        ...props,
        sortedThreads,
        terminalBridge,
        terminalPanelGroupRef,
      }),
      {
        initialProps: {
          activeThreadCwd: '/repo',
          activeThreadId: 'thread-1',
          isSettingsOpen: false,
          selectedCwd: null,
        } as HookProps,
      },
    )

    await act(async () => {
      await result.current.onToggleTerminal()
    })

    await waitFor(() => {
      expect(result.current.showTerminalPane).toBe(true)
      expect(result.current.terminalPaneThreadId).toBe('thread-1')
    })

    rerender({
      activeThreadCwd: null,
      activeThreadId: null,
      isSettingsOpen: false,
      selectedCwd: null,
    } as HookProps)

    await waitFor(() => {
      expect(result.current.showTerminalPane).toBe(false)
      expect(result.current.terminalPaneThreadId).toBeNull()
    })
  })

  it('tracks terminal visibility by active thread', async () => {
    const setLayout = vi.fn()
    type HookArgs = Parameters<typeof useTerminalVisibility>[0]
    type HookProps = Pick<HookArgs, 'activeThreadCwd' | 'activeThreadId' | 'isSettingsOpen' | 'selectedCwd'>
    const terminalPanelGroupRef = {
      current: {
        getLayout: () => [68, 32],
        setLayout,
        getId: () => 'terminal-test-group',
      } as unknown as ImperativePanelGroupHandle,
    }
    const terminalBridge = createTerminalBridge()
    const sortedThreads: HookArgs['sortedThreads'] = [
      {
        id: 'thread-1',
        cwd: '/repo-one',
        createdAt: '2026-05-23T00:00:00.000Z',
        updatedAt: '2026-05-23T00:00:00.000Z',
        messageCount: 1,
        label: null,
        lastUserPrompt: null,
        title: 'thread-1',
      },
      {
        id: 'thread-2',
        cwd: '/repo-two',
        createdAt: '2026-05-23T00:00:00.000Z',
        updatedAt: '2026-05-23T00:00:00.000Z',
        messageCount: 1,
        label: null,
        lastUserPrompt: null,
        title: 'thread-2',
      },
    ]

    const { result, rerender } = renderHook(
      (props: HookProps) => useTerminalVisibility({
        ...props,
        sortedThreads,
        terminalBridge,
        terminalPanelGroupRef,
      }),
      {
        initialProps: {
          activeThreadCwd: '/repo-one',
          activeThreadId: 'thread-1',
          isSettingsOpen: false,
          selectedCwd: null,
        } as HookProps,
      },
    )

    await act(async () => {
      await result.current.onToggleTerminal()
    })

    await waitFor(() => {
      expect(result.current.showTerminalPane).toBe(true)
      expect(result.current.terminalPaneThreadId).toBe('thread-1')
    })

    rerender({
      activeThreadCwd: '/repo-two',
      activeThreadId: 'thread-2',
      isSettingsOpen: false,
      selectedCwd: null,
    } as HookProps)

    await waitFor(() => {
      expect(result.current.showTerminalPane).toBe(false)
      expect(result.current.terminalPaneThreadId).toBe('thread-1')
    })

    rerender({
      activeThreadCwd: '/repo-one',
      activeThreadId: 'thread-1',
      isSettingsOpen: false,
      selectedCwd: null,
    } as HookProps)

    await waitFor(() => {
      expect(result.current.showTerminalPane).toBe(true)
      expect(result.current.terminalPaneThreadId).toBe('thread-1')
    })
  })
})
