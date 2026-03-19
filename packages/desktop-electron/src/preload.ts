import { contextBridge, ipcRenderer } from 'electron'
import { createDefaultWindowAppearanceState, type SidebarTransparencyMode, type WindowAppearanceState } from './windowAppearanceState'

const PICK_PROJECT_FOLDER_CHANNEL = 'formax:desktop:pick-project-folder'
const WINDOW_CONTROL_CHANNEL = 'formax:desktop:window-control'
const WINDOW_APPEARANCE_CHANNEL = 'formax:desktop:window-appearance'
const WINDOW_APPEARANCE_STATE_CHANNEL = 'formax:desktop:window-appearance:state'

type DesktopWindowControl = 'close' | 'minimize' | 'toggle-maximize'
type DesktopWindowAppearanceAction = 'get-state' | 'set-sidebar-transparency'

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
    setSidebarTransparency: (enabled: boolean) => Promise<WindowAppearanceState>
    subscribe: (listener: (state: WindowAppearanceState) => void) => () => void
  }
}

function normalizeSidebarTransparencyMode(raw: unknown): SidebarTransparencyMode {
  if (raw === 'native' || raw === 'css') return raw
  return 'css'
}

function normalizeWindowAppearanceState(payload: unknown): WindowAppearanceState {
  const fallback = createDefaultWindowAppearanceState()
  if (!payload || typeof payload !== 'object') return fallback
  const candidate = payload as Partial<WindowAppearanceState>
  const revisionRaw = candidate.revision
  const revision =
    typeof revisionRaw === 'number' && Number.isFinite(revisionRaw) && revisionRaw >= 0 ? Math.floor(revisionRaw) : 0
  const sidebarTransparencyEnabled = candidate.sidebarTransparencyEnabled === true
  const mode = normalizeSidebarTransparencyMode(candidate.sidebarTransparencyMode)
  return {
    revision,
    sidebarTransparencyEnabled,
    sidebarTransparencyMode: mode,
  }
}

function createWindowAppearanceBridge(): FormaxDesktopRuntimeInfo['windowAppearance'] {
  const listeners = new Set<(state: WindowAppearanceState) => void>()
  const handleStateChanged = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    const nextState = normalizeWindowAppearanceState(payload)
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
      return normalizeWindowAppearanceState(state)
    },
    setSidebarTransparency: async (enabled: boolean) => {
      const state = await ipcRenderer.invoke(
        WINDOW_APPEARANCE_CHANNEL,
        'set-sidebar-transparency' satisfies DesktopWindowAppearanceAction,
        enabled === true,
      )
      return normalizeWindowAppearanceState(state)
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
