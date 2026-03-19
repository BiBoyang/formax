import { contextBridge, ipcRenderer } from 'electron'

const PICK_PROJECT_FOLDER_CHANNEL = 'formax:desktop:pick-project-folder'
const WINDOW_CONTROL_CHANNEL = 'formax:desktop:window-control'
const WINDOW_APPEARANCE_CHANNEL = 'formax:desktop:window-appearance'
const WINDOW_APPEARANCE_STATE_CHANNEL = 'formax:desktop:window-appearance:state'

type DesktopWindowControl = 'close' | 'minimize' | 'toggle-maximize'
type DesktopWindowAppearanceAction = 'get-state' | 'set-window-transparency'
type WindowAppearanceState = {
  revision: number
  windowTransparencyEnabled: boolean
}

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
})

contextBridge.exposeInMainWorld('formaxDesktop', runtimeInfo)
