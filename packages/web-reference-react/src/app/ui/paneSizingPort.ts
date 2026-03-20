export interface PaneSizingPort {
  getViewportWidth: () => number
  readStoredPaneWidth: (storageKey: string) => number | null
  writeStoredPaneWidth: (storageKey: string, width: number) => void
  readStoredPaneBoolean: (storageKey: string) => boolean | null
  writeStoredPaneBoolean: (storageKey: string, value: boolean) => void
  onViewportResize: (listener: () => void) => () => void
}

export function createBrowserPaneSizingPort(defaultViewportWidth = 1600): PaneSizingPort {
  return {
    getViewportWidth: () => (typeof window === 'undefined' ? defaultViewportWidth : window.innerWidth),
    readStoredPaneWidth: (storageKey: string) => {
      if (typeof window === 'undefined') return null
      try {
        const raw = window.localStorage.getItem(storageKey)
        if (!raw) return null
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) return null
        return parsed
      } catch {
        return null
      }
    },
    writeStoredPaneWidth: (storageKey: string, width: number) => {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(storageKey, String(Math.round(width)))
      } catch {
        // best effort only
      }
    },
    readStoredPaneBoolean: (storageKey: string) => {
      if (typeof window === 'undefined') return null
      try {
        const raw = window.localStorage.getItem(storageKey)
        if (!raw) return null
        return raw === 'true'
      } catch {
        return null
      }
    },
    writeStoredPaneBoolean: (storageKey: string, value: boolean) => {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(storageKey, value ? 'true' : 'false')
      } catch {
        // best effort only
      }
    },
    onViewportResize: (listener: () => void) => {
      if (typeof window === 'undefined') return () => undefined
      window.addEventListener('resize', listener)
      return () => {
        window.removeEventListener('resize', listener)
      }
    },
  }
}
