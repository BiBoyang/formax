import { useEffect, useMemo, useState } from 'react'
import {
  RIGHT_RAIL_DEFAULT_SIZE,
  RIGHT_RAIL_MAX_SIZE,
  RIGHT_RAIL_MIN_SIZE,
  RIGHT_RAIL_OPEN_STORAGE_KEY,
  RIGHT_RAIL_WIDTH_STORAGE_KEY,
  SIDEBAR_DEFAULT_SIZE,
  SIDEBAR_MAX_SIZE,
  SIDEBAR_MIN_SIZE,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from '../core/constants'
import { createBrowserPaneSizingPort, type PaneSizingPort } from './paneSizingPort'

export function clampSidebarWidth(desiredSize: number): number {
  if (!Number.isFinite(desiredSize)) return SIDEBAR_DEFAULT_SIZE
  return Math.max(SIDEBAR_MIN_SIZE, Math.min(SIDEBAR_MAX_SIZE, desiredSize))
}

export function clampRightRailWidth(desiredSize: number): number {
  if (!Number.isFinite(desiredSize)) return RIGHT_RAIL_DEFAULT_SIZE
  return Math.max(RIGHT_RAIL_MIN_SIZE, Math.min(RIGHT_RAIL_MAX_SIZE, desiredSize))
}

function readStoredPercent(raw: number | null, fallback: number): number {
  if (raw == null || !Number.isFinite(raw)) return fallback
  if (raw <= 0 || raw > 100) return fallback
  return raw
}

export function usePaneLayout(port?: PaneSizingPort) {
  const layoutPort = useMemo(() => port ?? createBrowserPaneSizingPort(), [port])
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const storedSidebar = readStoredPercent(
      layoutPort.readStoredPaneWidth(SIDEBAR_WIDTH_STORAGE_KEY),
      SIDEBAR_DEFAULT_SIZE,
    )
    return clampSidebarWidth(storedSidebar)
  })
  const [isRightRailOpen, setIsRightRailOpen] = useState(() => {
    const stored = layoutPort.readStoredPaneBoolean(RIGHT_RAIL_OPEN_STORAGE_KEY)
    if (stored != null) return stored
    // Backward compatibility: right rail was visible by default before open-state persistence existed.
    return true
  })
  const [rightRailWidth, setRightRailWidth] = useState(() => {
    const storedRight = readStoredPercent(
      layoutPort.readStoredPaneWidth(RIGHT_RAIL_WIDTH_STORAGE_KEY),
      RIGHT_RAIL_DEFAULT_SIZE,
    )
    return clampRightRailWidth(storedRight)
  })

  useEffect(() => {
    layoutPort.writeStoredPaneWidth(SIDEBAR_WIDTH_STORAGE_KEY, sidebarWidth)
  }, [layoutPort, sidebarWidth])

  useEffect(() => {
    layoutPort.writeStoredPaneWidth(RIGHT_RAIL_WIDTH_STORAGE_KEY, rightRailWidth)
  }, [layoutPort, rightRailWidth])

  useEffect(() => {
    layoutPort.writeStoredPaneBoolean(RIGHT_RAIL_OPEN_STORAGE_KEY, isRightRailOpen)
  }, [layoutPort, isRightRailOpen])

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  return {
    isSidebarOpen,
    setIsSidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    isRightRailOpen,
    setIsRightRailOpen,
    rightRailWidth,
    setRightRailWidth,
    isSettingsOpen,
    setIsSettingsOpen,
  }
}
