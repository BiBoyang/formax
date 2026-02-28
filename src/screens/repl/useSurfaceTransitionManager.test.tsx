import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { useSurfaceTransitionManager } from './useSurfaceTransitionManager'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

type HarnessProps = {
  actions: { resetTranscriptSurface: () => Promise<void> }
  isPromptMode: boolean
  expandedTranscriptOpen: boolean
  setExpandedTranscriptOpen: (next: any) => void
  expandedTranscriptHideHistory: boolean
  setExpandedTranscriptHideHistory: (next: any) => void
  expandedViewActive: boolean
  lastCompactBoundaryIndex: number
  onToggleReady: (fn: () => void) => void
}

function Harness(props: HarnessProps): React.ReactNode {
  const { onToggleReady, ...hookArgs } = props
  const { handleToggleExpandedTranscript } = useSurfaceTransitionManager(hookArgs)
  onToggleReady(handleToggleExpandedTranscript)
  return <Text>ok</Text>
}

describe('useSurfaceTransitionManager', () => {
  it('toggles expanded transcript only when prompt mode is inactive', async () => {
    const setExpandedTranscriptOpen = vi.fn()
    const setExpandedTranscriptHideHistory = vi.fn()
    const resetTranscriptSurface = vi.fn(async () => {})
    let toggle: () => void = () => {}

    const ui = render(
      <Harness
        actions={{ resetTranscriptSurface }}
        isPromptMode
        expandedTranscriptOpen={false}
        setExpandedTranscriptOpen={setExpandedTranscriptOpen}
        expandedTranscriptHideHistory={false}
        setExpandedTranscriptHideHistory={setExpandedTranscriptHideHistory}
        expandedViewActive={false}
        lastCompactBoundaryIndex={-1}
        onToggleReady={(fn) => {
          toggle = fn
        }}
      />,
    )

    toggle()
    expect(setExpandedTranscriptOpen).not.toHaveBeenCalled()

    ui.rerender(
      <Harness
        actions={{ resetTranscriptSurface }}
        isPromptMode={false}
        expandedTranscriptOpen={false}
        setExpandedTranscriptOpen={setExpandedTranscriptOpen}
        expandedTranscriptHideHistory={false}
        setExpandedTranscriptHideHistory={setExpandedTranscriptHideHistory}
        expandedViewActive={false}
        lastCompactBoundaryIndex={-1}
        onToggleReady={(fn) => {
          toggle = fn
        }}
      />,
    )

    toggle()
    expect(setExpandedTranscriptOpen).toHaveBeenCalledTimes(1)
    const updater = setExpandedTranscriptOpen.mock.calls[0]?.[0]
    expect(typeof updater).toBe('function')
    expect(updater(false)).toBe(true)
  })

  it('resets hide-history flag when expanded transcript closes', async () => {
    const setExpandedTranscriptOpen = vi.fn()
    const setExpandedTranscriptHideHistory = vi.fn()
    const resetTranscriptSurface = vi.fn(async () => {})

    const ui = render(
      <Harness
        actions={{ resetTranscriptSurface }}
        isPromptMode={false}
        expandedTranscriptOpen
        setExpandedTranscriptOpen={setExpandedTranscriptOpen}
        expandedTranscriptHideHistory={false}
        setExpandedTranscriptHideHistory={setExpandedTranscriptHideHistory}
        expandedViewActive={false}
        lastCompactBoundaryIndex={-1}
        onToggleReady={() => {}}
      />,
    )

    await tick()
    expect(setExpandedTranscriptHideHistory).not.toHaveBeenCalled()

    ui.rerender(
      <Harness
        actions={{ resetTranscriptSurface }}
        isPromptMode={false}
        expandedTranscriptOpen={false}
        setExpandedTranscriptOpen={setExpandedTranscriptOpen}
        expandedTranscriptHideHistory={false}
        setExpandedTranscriptHideHistory={setExpandedTranscriptHideHistory}
        expandedViewActive={false}
        lastCompactBoundaryIndex={-1}
        onToggleReady={() => {}}
      />,
    )
    await tick()
    expect(setExpandedTranscriptHideHistory).toHaveBeenCalledWith(false)
  })

  it('requests surface reset when expanded view activity toggles', async () => {
    const resetTranscriptSurface = vi.fn(async () => {})
    const props = {
      actions: { resetTranscriptSurface },
      isPromptMode: false,
      expandedTranscriptOpen: false,
      setExpandedTranscriptOpen: vi.fn(),
      expandedTranscriptHideHistory: false,
      setExpandedTranscriptHideHistory: vi.fn(),
      lastCompactBoundaryIndex: 0,
      onToggleReady: () => {},
    }

    const ui = render(<Harness {...props} expandedViewActive={false} />)
    await tick()
    expect(resetTranscriptSurface).toHaveBeenCalledTimes(0)

    ui.rerender(<Harness {...props} expandedViewActive />)
    await tick()
    expect(resetTranscriptSurface).toHaveBeenCalledTimes(1)
  })

  it('requests reset for compact-boundary inserts only on primary view', async () => {
    const resetTranscriptSurface = vi.fn(async () => {})
    const props = {
      actions: { resetTranscriptSurface },
      isPromptMode: false,
      expandedTranscriptOpen: false,
      setExpandedTranscriptOpen: vi.fn(),
      expandedTranscriptHideHistory: false,
      setExpandedTranscriptHideHistory: vi.fn(),
      expandedViewActive: false,
      onToggleReady: () => {},
    }

    const ui = render(<Harness {...props} lastCompactBoundaryIndex={1} />)
    await tick()
    expect(resetTranscriptSurface).toHaveBeenCalledTimes(0)

    ui.rerender(<Harness {...props} lastCompactBoundaryIndex={2} />)
    await tick()
    expect(resetTranscriptSurface).toHaveBeenCalledTimes(1)

    ui.rerender(<Harness {...props} expandedViewActive lastCompactBoundaryIndex={3} />)
    await tick()
    expect(resetTranscriptSurface).toHaveBeenCalledTimes(2)
  })

  it('requests reset when hide-history toggles while expanded view is active', async () => {
    const resetTranscriptSurface = vi.fn(async () => {})
    const props = {
      actions: { resetTranscriptSurface },
      isPromptMode: false,
      expandedTranscriptOpen: true,
      setExpandedTranscriptOpen: vi.fn(),
      setExpandedTranscriptHideHistory: vi.fn(),
      lastCompactBoundaryIndex: 0,
      onToggleReady: () => {},
    }

    const ui = render(<Harness {...props} expandedViewActive={false} expandedTranscriptHideHistory={false} />)
    await tick()

    ui.rerender(<Harness {...props} expandedViewActive={false} expandedTranscriptHideHistory />)
    await tick()
    expect(resetTranscriptSurface).toHaveBeenCalledTimes(0)

    ui.rerender(<Harness {...props} expandedViewActive expandedTranscriptHideHistory={false} />)
    await tick()
    expect(resetTranscriptSurface).toHaveBeenCalledTimes(2)

    ui.rerender(<Harness {...props} expandedViewActive expandedTranscriptHideHistory />)
    await tick()
    expect(resetTranscriptSurface).toHaveBeenCalledTimes(3)
  })

  it('keeps reset loop alive when resetTranscriptSurface throws', async () => {
    const resetTranscriptSurface = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(undefined)
    const props = {
      actions: { resetTranscriptSurface },
      isPromptMode: false,
      expandedTranscriptOpen: false,
      setExpandedTranscriptOpen: vi.fn(),
      expandedTranscriptHideHistory: false,
      setExpandedTranscriptHideHistory: vi.fn(),
      lastCompactBoundaryIndex: 0,
      onToggleReady: () => {},
    }

    const ui = render(<Harness {...props} expandedViewActive={false} />)
    await tick()
    ui.rerender(<Harness {...props} expandedViewActive />)
    ui.rerender(<Harness {...props} expandedViewActive={false} />)
    await tick()
    await tick()
    expect(resetTranscriptSurface.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
