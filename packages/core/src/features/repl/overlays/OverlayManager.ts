import type { OverlaySpec } from '../../commands/contracts'

export type OverlayListener = (overlay: OverlaySpec | null) => void

export type OverlayManager = {
  open: (spec: OverlaySpec) => void
  close: () => void
  current: () => OverlaySpec | null
  subscribe: (listener: OverlayListener) => () => void
}

export function createOverlayManager(initial: OverlaySpec | null = null): OverlayManager {
  let overlay = initial
  const listeners = new Set<OverlayListener>()

  const notify = () => {
    for (const fn of listeners) fn(overlay)
  }

  return {
    open: (spec) => {
      overlay = spec
      notify()
    },
    close: () => {
      overlay = null
      notify()
    },
    current: () => overlay,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

