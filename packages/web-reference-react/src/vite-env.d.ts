/// <reference types="vite/client" />

type SidebarTransparencyMode = 'css' | 'native'

type WindowAppearanceState = {
  revision: number
  sidebarTransparencyEnabled: boolean
  sidebarTransparencyMode: SidebarTransparencyMode
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
    setSidebarTransparency?: (enabled: boolean) => Promise<WindowAppearanceState>
    subscribe?: (listener: (state: WindowAppearanceState) => void) => () => void
  }
}

interface Window {
  formaxDesktop?: FormaxDesktopBridge
}
