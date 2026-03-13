import { contextBridge, ipcRenderer } from 'electron'

const PICK_PROJECT_FOLDER_CHANNEL = 'formax:desktop:pick-project-folder'
const WINDOW_CONTROL_CHANNEL = 'formax:desktop:window-control'
const WINDOW_APPEARANCE_CHANNEL = 'formax:desktop:window-appearance'

type DesktopWindowControl = 'close' | 'minimize' | 'toggle-maximize'
type DesktopWindowAppearanceAction = 'set-sidebar-transparency'

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
    setSidebarTransparency: (enabled: boolean) => Promise<boolean>
  }
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
  windowAppearance: Object.freeze({
    setSidebarTransparency: (enabled: boolean) =>
      ipcRenderer.invoke(
        WINDOW_APPEARANCE_CHANNEL,
        'set-sidebar-transparency' satisfies DesktopWindowAppearanceAction,
        enabled,
      ),
  }),
})

contextBridge.exposeInMainWorld('formaxDesktop', runtimeInfo)
