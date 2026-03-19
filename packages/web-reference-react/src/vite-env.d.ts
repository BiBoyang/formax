/// <reference types="vite/client" />

type WindowAppearanceState = {
  revision: number
  windowTransparencyEnabled: boolean
}

type FormaxDesktopBridge = {
  mode: string
  startUrl: string
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
}

interface Window {
  formaxDesktop?: FormaxDesktopBridge
}
