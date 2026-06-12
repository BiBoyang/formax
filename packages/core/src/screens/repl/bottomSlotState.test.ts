import { describe, expect, it } from 'vitest'
import {
  formatRunningToolsText,
  resolveReplBlockingOverlay,
  resolveReplBottomSlotState,
} from './bottomSlotState'

describe('resolveReplBottomSlotState', () => {
  it('gives blocking overlays the highest priority', () => {
    expect(
      resolveReplBottomSlotState({
        blockingOverlay: 'model',
        expandedViewActive: true,
        hasActiveInteractivePrompt: true,
        isLoading: true,
        runningToolCount: 2,
      }),
    ).toEqual({ kind: 'blocking_overlay', overlay: 'model' })
  })

  it('gives expanded transcript hint the highest priority', () => {
    expect(
      resolveReplBottomSlotState({
        expandedViewActive: true,
        hasActiveInteractivePrompt: true,
        isLoading: true,
        runningToolCount: 2,
      }),
    ).toEqual({ kind: 'expanded_hint' })
  })

  it('shows the active prompt before running tool status', () => {
    expect(
      resolveReplBottomSlotState({
        expandedViewActive: false,
        hasActiveInteractivePrompt: true,
        isLoading: true,
        runningToolCount: 2,
      }),
    ).toEqual({ kind: 'active_prompt' })
  })

  it('shows input in loading mode after approvals while tools are still running', () => {
    expect(
      resolveReplBottomSlotState({
        expandedViewActive: false,
        hasActiveInteractivePrompt: false,
        isLoading: true,
        runningToolCount: 2,
      }),
    ).toEqual({ kind: 'input', mode: 'loading', runningToolCount: 2 })
  })

  it('shows idle input when there is no overlay, expanded view, active prompt, or running tool', () => {
    expect(
      resolveReplBottomSlotState({
        expandedViewActive: false,
        hasActiveInteractivePrompt: false,
        isLoading: false,
        runningToolCount: 0,
      }),
    ).toEqual({ kind: 'input', mode: 'idle', runningToolCount: 0 })
  })

  it('shows loading input during generic model loading without running tools', () => {
    expect(
      resolveReplBottomSlotState({
        expandedViewActive: false,
        hasActiveInteractivePrompt: false,
        isLoading: true,
        runningToolCount: 0,
      }),
    ).toEqual({ kind: 'input', mode: 'loading', runningToolCount: 0 })
  })

  it('normalizes invalid running counts', () => {
    expect(
      resolveReplBottomSlotState({
        expandedViewActive: false,
        hasActiveInteractivePrompt: false,
        isLoading: false,
        runningToolCount: Number.NaN,
      }),
    ).toEqual({ kind: 'input', mode: 'idle', runningToolCount: 0 })

    expect(
      resolveReplBottomSlotState({
        expandedViewActive: false,
        hasActiveInteractivePrompt: false,
        isLoading: false,
        runningToolCount: 1.8,
      }),
    ).toEqual({ kind: 'input', mode: 'loading', runningToolCount: 1 })
  })
})

describe('resolveReplBlockingOverlay', () => {
  it('resolves command overlays in a stable priority order', () => {
    expect(resolveReplBlockingOverlay({ modelDialogOpen: true })).toBe('model')
    expect(resolveReplBlockingOverlay({ configDialogOpen: true, modelDialogOpen: true })).toBe('config')
    expect(resolveReplBlockingOverlay({})).toBeNull()
  })
})

describe('formatRunningToolsText', () => {
  it('formats zero, singular, and plural running tool counts', () => {
    expect(formatRunningToolsText(0)).toBeNull()
    expect(formatRunningToolsText(1)).toBe('Running 1 tool')
    expect(formatRunningToolsText(2)).toBe('Running 2 tools')
  })
})
