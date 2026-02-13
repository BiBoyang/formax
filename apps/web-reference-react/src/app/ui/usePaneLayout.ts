import { useEffect, useMemo, useState } from 'react'
import {
  CENTER_MIN_WIDTH,
  DIVIDER_WIDTH,
  RIGHT_RAIL_MAX_WIDTH,
  RIGHT_RAIL_MIN_WIDTH,
  RIGHT_RAIL_WIDTH_STORAGE_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from '../core/constants'
import { createBrowserPaneSizingPort, type PaneSizingPort } from './paneSizingPort'

export function clampSidebarWidth(desiredWidth: number, viewportWidth: number, rightRailWidth: number): number {
  const available = viewportWidth - rightRailWidth - DIVIDER_WIDTH - DIVIDER_WIDTH - CENTER_MIN_WIDTH
  if (!Number.isFinite(available) || available <= 0) return SIDEBAR_MIN_WIDTH
  const maxByViewport = Math.min(SIDEBAR_MAX_WIDTH, available)
  const minByViewport = Math.min(SIDEBAR_MIN_WIDTH, maxByViewport)
  return Math.max(minByViewport, Math.min(maxByViewport, desiredWidth))
}

export function clampRightRailWidth(
  desiredWidth: number,
  viewportWidth: number,
  isSidebarOpen: boolean,
  sidebarWidth: number,
): number {
  const leftReserved = isSidebarOpen ? sidebarWidth + DIVIDER_WIDTH : 0
  const available = viewportWidth - leftReserved - DIVIDER_WIDTH - CENTER_MIN_WIDTH
  if (!Number.isFinite(available) || available <= 0) return 0
  const maxByViewport = Math.min(RIGHT_RAIL_MAX_WIDTH, available)
  const minByViewport = Math.min(RIGHT_RAIL_MIN_WIDTH, maxByViewport)
  return Math.max(minByViewport, Math.min(maxByViewport, desiredWidth))
}

export function usePaneLayout(port?: PaneSizingPort) {
  const layoutPort = useMemo(() => port ?? createBrowserPaneSizingPort(), [port])
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const viewportWidth = layoutPort.getViewportWidth()
    const storedRightRailWidth = layoutPort.readStoredPaneWidth(RIGHT_RAIL_WIDTH_STORAGE_KEY) ?? 400
    const storedSidebarWidth = layoutPort.readStoredPaneWidth(SIDEBAR_WIDTH_STORAGE_KEY) ?? SIDEBAR_DEFAULT_WIDTH
    return clampSidebarWidth(storedSidebarWidth, viewportWidth, storedRightRailWidth)
  })
  const [rightRailWidth, setRightRailWidth] = useState(() => {
    const viewportWidth = layoutPort.getViewportWidth()
    const storedRightRailWidth = layoutPort.readStoredPaneWidth(RIGHT_RAIL_WIDTH_STORAGE_KEY) ?? 400
    const storedSidebarWidth = layoutPort.readStoredPaneWidth(SIDEBAR_WIDTH_STORAGE_KEY) ?? SIDEBAR_DEFAULT_WIDTH
    const clampedSidebarWidth = clampSidebarWidth(storedSidebarWidth, viewportWidth, storedRightRailWidth)
    return clampRightRailWidth(storedRightRailWidth, viewportWidth, true, clampedSidebarWidth)
  })

  useEffect(() => {
    const syncLayoutWidths = () => {
      const viewportWidth = layoutPort.getViewportWidth()
      const nextSidebarWidth = clampSidebarWidth(sidebarWidth, viewportWidth, rightRailWidth)
      if (nextSidebarWidth !== sidebarWidth) {
        setSidebarWidth(nextSidebarWidth)
      }
      setRightRailWidth((previous) => clampRightRailWidth(previous, viewportWidth, isSidebarOpen, nextSidebarWidth))
    }
    syncLayoutWidths()
    return layoutPort.onViewportResize(syncLayoutWidths)
  }, [isSidebarOpen, layoutPort, rightRailWidth, sidebarWidth])

  useEffect(() => {
    layoutPort.writeStoredPaneWidth(SIDEBAR_WIDTH_STORAGE_KEY, sidebarWidth)
  }, [layoutPort, sidebarWidth])

  useEffect(() => {
    layoutPort.writeStoredPaneWidth(RIGHT_RAIL_WIDTH_STORAGE_KEY, rightRailWidth)
  }, [layoutPort, rightRailWidth])

  return {
    isSidebarOpen,
    setIsSidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    rightRailWidth,
    setRightRailWidth,
  }
}
