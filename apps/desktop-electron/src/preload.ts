import { contextBridge } from 'electron'

type FormaxDesktopRuntimeInfo = {
  mode: string
  startUrl: string
}

const runtimeInfo: FormaxDesktopRuntimeInfo = Object.freeze({
  mode: process.env.FORMAX_ELECTRON_MODE ?? 'dev',
  startUrl: process.env.FORMAX_ELECTRON_START_URL ?? 'http://127.0.0.1:3781',
})

contextBridge.exposeInMainWorld('formaxDesktop', runtimeInfo)
