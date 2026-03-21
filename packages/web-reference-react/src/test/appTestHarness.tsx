import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'

export const APP_TEST_MODE_ORDER = ['Ask before edits', 'Edit automatically', 'Plan mode'] as const

const SIDEBAR_SETTINGS_LABEL = /Settings|设置/

export function createDesktopWindowAppearanceState(enabled: boolean, revision: number) {
  return {
    revision,
    windowTransparencyEnabled: enabled,
  }
}

export async function setComposerMode(target: (typeof APP_TEST_MODE_ORDER)[number]) {
  const modeButton = screen.getByLabelText('Execution mode')
  for (let index = 0; index <= APP_TEST_MODE_ORDER.length; index += 1) {
    const before = modeButton.textContent ?? ''
    if (before.includes(target)) return
    fireEvent.click(modeButton)
    await waitFor(() => {
      expect(modeButton.textContent ?? '').not.toBe(before)
    })
  }
  throw new Error(`Unable to set composer mode to ${target}`)
}

export async function clickWindowTransparencyMenuItem() {
  const leftRail = await screen.findByTestId('left-rail')
  const settingsTrigger = within(leftRail).getByRole('button', { name: SIDEBAR_SETTINGS_LABEL })
  fireEvent.keyDown(settingsTrigger, { key: 'Enter' })
  fireEvent.click(settingsTrigger, { button: 0 })
  const menuItems = await screen.findAllByRole('menuitem')
  const transparencyItem = menuItems[menuItems.length - 1]
  if (!transparencyItem) {
    throw new Error('Expected transparency menu item to exist')
  }
  fireEvent.click(transparencyItem)
}

export function createDesktopTerminalHarness(
  initialSessions?: Record<string, { exists: boolean; output: string; exitCode?: number | null; dataSeq?: number }>,
) {
  const listeners = new Set<(event: DesktopTerminalEvent) => void>()
  const sessions = new Map<string, { exists: boolean; output: string; exitCode?: number | null; dataSeq: number }>()
  if (initialSessions) {
    for (const [threadId, snapshot] of Object.entries(initialSessions)) {
      sessions.set(threadId, {
        exists: snapshot.exists,
        output: snapshot.output,
        ...(snapshot.exitCode !== undefined ? { exitCode: snapshot.exitCode } : {}),
        dataSeq: snapshot.dataSeq ?? 0,
      })
    }
  }

  const ensureSession = vi.fn(async (threadId: string, _cwd?: string) => {
    const existing = sessions.get(threadId)
    if (existing?.exists) {
      return { created: false, exists: true }
    }
    sessions.set(threadId, {
      exists: true,
      output: existing?.output ?? '',
      exitCode: null,
      dataSeq: existing?.dataSeq ?? 0,
    })
    return { created: true, exists: true }
  })
  const getSnapshot = vi.fn(async (threadId: string) => {
    const snapshot = sessions.get(threadId)
    if (!snapshot) return { exists: false, output: '' }
    return {
      exists: snapshot.exists,
      output: snapshot.output,
      ...(snapshot.exitCode !== undefined ? { exitCode: snapshot.exitCode } : {}),
      dataSeq: snapshot.dataSeq,
    }
  })
  const write = vi.fn(async (threadId: string, data: string) => {
    const snapshot = sessions.get(threadId)
    if (!snapshot || !snapshot.exists) return false
    snapshot.output += data
    snapshot.dataSeq += 1
    for (const listener of listeners) {
      listener({ type: 'data', threadId, chunk: data, dataSeq: snapshot.dataSeq })
    }
    return true
  })
  const resize = vi.fn(async (_threadId: string, _cols: number, _rows: number) => true)
  const destroySession = vi.fn(async (threadId: string) => sessions.delete(threadId))
  const subscribe = vi.fn((listener: (event: DesktopTerminalEvent) => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })

  const desktopBridge: NonNullable<Window['formaxDesktop']> = {
    mode: 'dev',
    startUrl: 'http://127.0.0.1:3781',
    windowControls: {},
    terminal: {
      ensureSession,
      getSnapshot,
      write,
      resize,
      destroySession,
      subscribe,
    },
  }

  const emit = (event: DesktopTerminalEvent) => {
    for (const listener of listeners) {
      listener(event)
    }
  }

  return {
    desktopBridge,
    ensureSession,
    getSnapshot,
    write,
    resize,
    destroySession,
    subscribe,
    emit,
  }
}
