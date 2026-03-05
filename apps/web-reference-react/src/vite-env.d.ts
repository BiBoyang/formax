/// <reference types="vite/client" />

type FormaxDesktopBridge = {
  mode: string
  startUrl: string
  pickProjectFolder?: () => Promise<string | null>
  windowControls?: {
    close?: () => Promise<boolean>
    minimize?: () => Promise<boolean>
    toggleMaximize?: () => Promise<boolean>
  }
}

interface Window {
  formaxDesktop?: FormaxDesktopBridge
}
