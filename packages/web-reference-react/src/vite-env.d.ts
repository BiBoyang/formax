/// <reference types="vite/client" />

type WindowAppearanceState = {
  revision: number
  windowTransparencyEnabled: boolean
}

type DesktopTerminalEnsureSessionResult = {
  created: boolean
  exists: boolean
}

type DesktopTerminalSnapshotResult = {
  exists: boolean
  output: string
  exitCode?: number | null
  dataSeq?: number
}

type DesktopTerminalEvent =
  | { type: 'data'; threadId: string; chunk: string; dataSeq: number }
  | { type: 'exit'; threadId: string; exitCode: number | null }

type FormaxDesktopBridge = {
  mode: string
  startUrl: string
  bridgePort?: number
  managedRuntime?: boolean
  pickProjectFolder?: () => Promise<string | null>
  windowControls?: {
    close?: () => Promise<boolean>
    minimize?: () => Promise<boolean>
    toggleMaximize?: () => Promise<boolean>
  }
  windowAppearance?: {
    getState?: () => Promise<WindowAppearanceState>
    setWindowTransparency?: (enabled: boolean) => Promise<WindowAppearanceState>
    subscribe?: (listener: (state: WindowAppearanceState) => void) => () => void
  }
  powerManagement?: {
    getPreventSleep?: () => Promise<boolean>
    setPreventSleep?: (enabled: boolean) => Promise<boolean>
  }
  setup?: {
    complete?: () => Promise<boolean>
    cancel?: () => Promise<boolean>
    openMain?: () => Promise<boolean>
    subscribe?: (listener: (event: { action: 'complete' | 'open-main'; ok: boolean }) => void) => () => void
  }
  openTargets?: {
    listAvailable?: () => Promise<Array<{
      id: 'vscode' | 'cursor' | 'antigravity' | 'finder' | 'terminal' | 'iterm2' | 'xcode'
      label: string
    }>>
    openPath?: (
      target: 'vscode' | 'cursor' | 'antigravity' | 'finder' | 'terminal' | 'iterm2' | 'xcode',
      path: string,
    ) => Promise<boolean>
  }
  terminal?: {
    ensureSession: (threadId: string, cwd?: string) => Promise<DesktopTerminalEnsureSessionResult>
    getSnapshot: (threadId: string) => Promise<DesktopTerminalSnapshotResult>
    write: (threadId: string, data: string) => Promise<boolean>
    resize: (threadId: string, cols: number, rows: number) => Promise<boolean>
    destroySession: (threadId: string) => Promise<boolean>
    subscribe: (listener: (event: DesktopTerminalEvent) => void) => () => void
  }
}

interface Window {
  formaxDesktop?: FormaxDesktopBridge
}
