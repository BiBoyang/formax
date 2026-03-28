import { contextBridge, ipcRenderer } from 'electron'

const PICK_PROJECT_FOLDER_CHANNEL = 'formax:desktop:pick-project-folder'
const WINDOW_CONTROL_CHANNEL = 'formax:desktop:window-control'
const WINDOW_APPEARANCE_CHANNEL = 'formax:desktop:window-appearance'
const WINDOW_APPEARANCE_STATE_CHANNEL = 'formax:desktop:window-appearance:state'
const POWER_MANAGEMENT_CHANNEL = 'formax:desktop:power-management'
const OPEN_TARGETS_CHANNEL = 'formax:desktop:open-targets'
const TERMINAL_CHANNEL = 'formax:desktop:terminal'
const TERMINAL_EVENT_CHANNEL = 'formax:desktop:terminal:event'

type DesktopWindowControl = 'close' | 'minimize' | 'toggle-maximize'
type DesktopWindowAppearanceAction = 'get-state' | 'set-window-transparency'
type DesktopPowerManagementAction = 'get-prevent-sleep' | 'set-prevent-sleep'
type DesktopOpenTargetsAction = 'list-available' | 'open-path'
type DesktopTerminalAction = 'ensure-session' | 'get-snapshot' | 'write' | 'resize' | 'destroy-session'

type OpenTargetDescriptor = {
  id: 'vscode' | 'cursor' | 'antigravity' | 'finder' | 'terminal' | 'iterm2' | 'xcode'
  label: string
}
type WindowAppearanceState = {
  revision: number
  windowTransparencyEnabled: boolean
}

type TerminalEnsureSessionResult = {
  created: boolean
  exists: boolean
}

type TerminalSnapshotResult = {
  exists: boolean
  output: string
  exitCode?: number | null
  dataSeq?: number
}

type TerminalEvent =
  | { type: 'data'; threadId: string; chunk: string; dataSeq: number }
  | { type: 'exit'; threadId: string; exitCode: number | null }

type FormaxDesktopRuntimeInfo = {
  mode: string
  startUrl: string
  pickProjectFolder: () => Promise<string | null>
  windowControls: {
    close: () => Promise<boolean>
    minimize: () => Promise<boolean>
    toggleMaximize: () => Promise<boolean>
  }
  windowAppearance: {
    getState: () => Promise<WindowAppearanceState>
    setWindowTransparency: (enabled: boolean) => Promise<WindowAppearanceState>
    subscribe: (listener: (state: WindowAppearanceState) => void) => () => void
  }
  powerManagement: {
    getPreventSleep: () => Promise<boolean>
    setPreventSleep: (enabled: boolean) => Promise<boolean>
  }
  openTargets: {
    listAvailable: () => Promise<OpenTargetDescriptor[]>
    openPath: (target: OpenTargetDescriptor['id'], path: string) => Promise<boolean>
  }
  terminal: {
    ensureSession: (threadId: string, cwd?: string) => Promise<TerminalEnsureSessionResult>
    getSnapshot: (threadId: string) => Promise<TerminalSnapshotResult>
    write: (threadId: string, data: string) => Promise<boolean>
    resize: (threadId: string, cols: number, rows: number) => Promise<boolean>
    destroySession: (threadId: string) => Promise<boolean>
    subscribe: (listener: (event: TerminalEvent) => void) => () => void
  }
}


function createDefaultWindowAppearanceState(): WindowAppearanceState {
  return {
    revision: 0,
    windowTransparencyEnabled: true,
  }
}

function normalizeWindowAppearanceState(payload: unknown): WindowAppearanceState {
  const fallback = createDefaultWindowAppearanceState()
  if (!payload || typeof payload !== 'object') return fallback
  const candidate = payload as Partial<WindowAppearanceState>
  const revisionRaw = candidate.revision
  const revision =
    typeof revisionRaw === 'number' && Number.isFinite(revisionRaw) && revisionRaw >= 0 ? Math.floor(revisionRaw) : 0
  const windowTransparencyEnabled = candidate.windowTransparencyEnabled === true
  return {
    revision,
    windowTransparencyEnabled,
  }
}

function isWindowAppearanceStatePayload(payload: unknown): payload is WindowAppearanceState {
  if (!payload || typeof payload !== 'object') return false
  return 'revision' in payload && 'windowTransparencyEnabled' in payload
}

function normalizeSetResult(
  payload: unknown,
  requestedEnabled: boolean,
  previousState: WindowAppearanceState,
): WindowAppearanceState {
  if (isWindowAppearanceStatePayload(payload)) {
    return normalizeWindowAppearanceState(payload)
  }
  return {
    revision: previousState.revision + 1,
    windowTransparencyEnabled: requestedEnabled,
  }
}

function createWindowAppearanceBridge(): FormaxDesktopRuntimeInfo['windowAppearance'] {
  let lastKnownState = createDefaultWindowAppearanceState()
  const listeners = new Set<(state: WindowAppearanceState) => void>()
  const handleStateChanged = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    if (!isWindowAppearanceStatePayload(payload)) return
    const nextState = normalizeWindowAppearanceState(payload)
    lastKnownState = nextState
    for (const listener of listeners) {
      listener(nextState)
    }
  }

  let subscribed = false

  const ensureSubscribed = () => {
    if (subscribed) return
    ipcRenderer.on(WINDOW_APPEARANCE_STATE_CHANNEL, handleStateChanged)
    subscribed = true
  }

  const ensureUnsubscribed = () => {
    if (!subscribed || listeners.size > 0) return
    ipcRenderer.removeListener(WINDOW_APPEARANCE_STATE_CHANNEL, handleStateChanged)
    subscribed = false
  }

  return Object.freeze({
    getState: async () => {
      const state = await ipcRenderer.invoke(
        WINDOW_APPEARANCE_CHANNEL,
        'get-state' satisfies DesktopWindowAppearanceAction,
      )
      if (!isWindowAppearanceStatePayload(state)) return lastKnownState
      const normalizedState = normalizeWindowAppearanceState(state)
      lastKnownState = normalizedState
      return normalizedState
    },
    setWindowTransparency: async (enabled: boolean) => {
      const state = await ipcRenderer.invoke(
        WINDOW_APPEARANCE_CHANNEL,
        'set-window-transparency' satisfies DesktopWindowAppearanceAction,
        enabled === true,
      )
      const normalizedState = normalizeSetResult(state, enabled === true, lastKnownState)
      lastKnownState = normalizedState
      return normalizedState
    },
    subscribe: (listener: (state: WindowAppearanceState) => void) => {
      listeners.add(listener)
      ensureSubscribed()
      return () => {
        listeners.delete(listener)
        ensureUnsubscribed()
      }
    },
  })
}

function normalizeTerminalEnsureSessionResult(payload: unknown): TerminalEnsureSessionResult {
  if (!payload || typeof payload !== 'object') return { created: false, exists: false }
  const candidate = payload as Partial<TerminalEnsureSessionResult>
  return {
    created: candidate.created === true,
    exists: candidate.exists === true,
  }
}

function normalizeTerminalSnapshotResult(payload: unknown): TerminalSnapshotResult {
  if (!payload || typeof payload !== 'object') return { exists: false, output: '' }
  const candidate = payload as Partial<TerminalSnapshotResult>
  const exitCodeRaw = candidate.exitCode
  const dataSeqRaw = candidate.dataSeq
  const exitCode =
    exitCodeRaw == null || (typeof exitCodeRaw === 'number' && Number.isFinite(exitCodeRaw))
      ? (exitCodeRaw as number | null | undefined)
      : undefined
  const dataSeq = typeof dataSeqRaw === 'number' && Number.isFinite(dataSeqRaw) ? Math.max(0, Math.floor(dataSeqRaw)) : undefined
  return {
    exists: candidate.exists === true,
    output: typeof candidate.output === 'string' ? candidate.output : '',
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(dataSeq !== undefined ? { dataSeq } : {}),
  }
}

function createTerminalBridge(): FormaxDesktopRuntimeInfo['terminal'] {
  const listeners = new Set<(event: TerminalEvent) => void>()

  const handleTerminalEvent = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const record = payload as Partial<TerminalEvent>
    if (record.type === 'data') {
      if (
        typeof record.threadId !== 'string' ||
        typeof record.chunk !== 'string' ||
        typeof (record as { dataSeq?: unknown }).dataSeq !== 'number' ||
        !Number.isFinite((record as { dataSeq?: number }).dataSeq)
      ) {
        return
      }
      const terminalEvent: TerminalEvent = {
        type: 'data',
        threadId: record.threadId,
        chunk: record.chunk,
        dataSeq: Math.max(0, Math.floor((record as { dataSeq: number }).dataSeq)),
      }
      for (const listener of listeners) listener(terminalEvent)
      return
    }
    if (record.type === 'exit') {
      if (typeof record.threadId !== 'string') return
      const rawExitCode = record.exitCode
      const exitCode =
        rawExitCode == null || (typeof rawExitCode === 'number' && Number.isFinite(rawExitCode))
          ? (rawExitCode as number | null)
          : null
      const terminalEvent: TerminalEvent = { type: 'exit', threadId: record.threadId, exitCode }
      for (const listener of listeners) listener(terminalEvent)
    }
  }

  let subscribed = false

  const ensureSubscribed = () => {
    if (subscribed) return
    ipcRenderer.on(TERMINAL_EVENT_CHANNEL, handleTerminalEvent)
    subscribed = true
  }

  const ensureUnsubscribed = () => {
    if (!subscribed || listeners.size > 0) return
    ipcRenderer.removeListener(TERMINAL_EVENT_CHANNEL, handleTerminalEvent)
    subscribed = false
  }

  return Object.freeze({
    ensureSession: async (threadId: string, cwd?: string) => {
      const payload = await ipcRenderer.invoke(
        TERMINAL_CHANNEL,
        'ensure-session' satisfies DesktopTerminalAction,
        threadId,
        cwd,
      )
      return normalizeTerminalEnsureSessionResult(payload)
    },
    getSnapshot: async (threadId: string) => {
      const payload = await ipcRenderer.invoke(
        TERMINAL_CHANNEL,
        'get-snapshot' satisfies DesktopTerminalAction,
        threadId,
      )
      return normalizeTerminalSnapshotResult(payload)
    },
    write: async (threadId: string, data: string) => {
      const result = await ipcRenderer.invoke(
        TERMINAL_CHANNEL,
        'write' satisfies DesktopTerminalAction,
        threadId,
        data,
      )
      return result === true
    },
    resize: async (threadId: string, cols: number, rows: number) => {
      const result = await ipcRenderer.invoke(
        TERMINAL_CHANNEL,
        'resize' satisfies DesktopTerminalAction,
        threadId,
        cols,
        rows,
      )
      return result === true
    },
    destroySession: async (threadId: string) => {
      const result = await ipcRenderer.invoke(
        TERMINAL_CHANNEL,
        'destroy-session' satisfies DesktopTerminalAction,
        threadId,
      )
      return result === true
    },
    subscribe: (listener: (event: TerminalEvent) => void) => {
      listeners.add(listener)
      ensureSubscribed()
      return () => {
        listeners.delete(listener)
        ensureUnsubscribed()
      }
    },
  })
}

const runtimeInfo: FormaxDesktopRuntimeInfo = Object.freeze({
  mode: process.env.FORMAX_ELECTRON_MODE ?? 'dev',
  startUrl: process.env.FORMAX_ELECTRON_START_URL ?? 'http://127.0.0.1:3781',
  pickProjectFolder: async () => {
    const selected = await ipcRenderer.invoke(PICK_PROJECT_FOLDER_CHANNEL)
    if (typeof selected === 'string' && selected.trim()) return selected
    return null
  },
  windowControls: Object.freeze({
    close: () => ipcRenderer.invoke(WINDOW_CONTROL_CHANNEL, 'close' satisfies DesktopWindowControl),
    minimize: () => ipcRenderer.invoke(WINDOW_CONTROL_CHANNEL, 'minimize' satisfies DesktopWindowControl),
    toggleMaximize: () =>
      ipcRenderer.invoke(WINDOW_CONTROL_CHANNEL, 'toggle-maximize' satisfies DesktopWindowControl),
  }),
  windowAppearance: createWindowAppearanceBridge(),
  powerManagement: Object.freeze({
    getPreventSleep: async () => {
      const state = await ipcRenderer.invoke(
        POWER_MANAGEMENT_CHANNEL,
        'get-prevent-sleep' satisfies DesktopPowerManagementAction,
      )
      return state === true
    },
    setPreventSleep: async (enabled: boolean) => {
      const state = await ipcRenderer.invoke(
        POWER_MANAGEMENT_CHANNEL,
        'set-prevent-sleep' satisfies DesktopPowerManagementAction,
        enabled === true,
      )
      return state === true
    },
  }),
  openTargets: Object.freeze({
    listAvailable: async () => {
      const payload = await ipcRenderer.invoke(
        OPEN_TARGETS_CHANNEL,
        'list-available' satisfies DesktopOpenTargetsAction,
      )
      if (!Array.isArray(payload)) return []
      return payload
        .filter((entry): entry is OpenTargetDescriptor => {
          if (!entry || typeof entry !== 'object') return false
          const candidate = entry as Partial<OpenTargetDescriptor>
          return typeof candidate.id === 'string' && typeof candidate.label === 'string'
        })
        .map((entry) => ({ id: entry.id, label: entry.label }))
    },
    openPath: async (target: OpenTargetDescriptor['id'], path: string) => {
      const result = await ipcRenderer.invoke(
        OPEN_TARGETS_CHANNEL,
        'open-path' satisfies DesktopOpenTargetsAction,
        target,
        path,
      )
      return result === true
    },
  }),
  terminal: createTerminalBridge(),
})

contextBridge.exposeInMainWorld('formaxDesktop', runtimeInfo)
