import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ImperativePanelGroupHandle } from 'react-resizable-panels'
import { clampRightRailWidth, clampSidebarWidth } from './usePaneLayout'

export type UsePanelDragCommitArgs = {
  isRightRailOpen: boolean
  isSidebarOpen: boolean
  panelGroupRef: MutableRefObject<ImperativePanelGroupHandle | null>
  rightRailPanelGroupRef: MutableRefObject<ImperativePanelGroupHandle | null>
  rightRailWidth: number
  setIsRightRailOpen: Dispatch<SetStateAction<boolean>>
  setIsSidebarOpen: Dispatch<SetStateAction<boolean>>
  setRightRailWidth: Dispatch<SetStateAction<number>>
  setSidebarWidth: Dispatch<SetStateAction<number>>
  sidebarWidth: number
}

export function usePanelDragCommit(args: UsePanelDragCommitArgs) {
  const pendingSidebarPercentRef = useRef(args.sidebarWidth)
  const pendingRightRailPercentRef = useRef(args.rightRailWidth)
  const lastOpenSidebarWidthRef = useRef(clampSidebarWidth(args.sidebarWidth))
  const lastOpenRightRailWidthRef = useRef(clampRightRailWidth(args.rightRailWidth))
  const previousSidebarOpenRef = useRef(args.isSidebarOpen)
  const previousRightRailOpenRef = useRef(args.isRightRailOpen)

  useEffect(() => {
    if (!args.isSidebarOpen) return
    lastOpenSidebarWidthRef.current = clampSidebarWidth(args.sidebarWidth)
  }, [args.isSidebarOpen, args.sidebarWidth])

  useEffect(() => {
    const panelGroup = args.panelGroupRef.current
    if (!panelGroup) return
    if (previousSidebarOpenRef.current === args.isSidebarOpen) return
    previousSidebarOpenRef.current = args.isSidebarOpen
    const currentLayout = panelGroup.getLayout()
    if (currentLayout.length < 2) return

    if (!args.isSidebarOpen) {
      panelGroup.setLayout([0, 100])
      return
    }

    const restoredSidebarWidth = clampSidebarWidth(lastOpenSidebarWidthRef.current)
    panelGroup.setLayout([restoredSidebarWidth, Math.max(0, 100 - restoredSidebarWidth)])
  }, [args.isSidebarOpen, args.panelGroupRef])

  useEffect(() => {
    if (!args.isRightRailOpen) return
    lastOpenRightRailWidthRef.current = clampRightRailWidth(args.rightRailWidth)
  }, [args.isRightRailOpen, args.rightRailWidth])

  useEffect(() => {
    const panelGroup = args.rightRailPanelGroupRef.current
    if (!panelGroup) return
    if (previousRightRailOpenRef.current === args.isRightRailOpen) return
    previousRightRailOpenRef.current = args.isRightRailOpen
    const currentLayout = panelGroup.getLayout()
    if (currentLayout.length < 2) return

    if (!args.isRightRailOpen) {
      panelGroup.setLayout([100, 0])
      return
    }

    const restoredRightRailWidth = clampRightRailWidth(lastOpenRightRailWidthRef.current)
    panelGroup.setLayout([Math.max(0, 100 - restoredRightRailWidth), restoredRightRailWidth])
  }, [args.isRightRailOpen, args.rightRailPanelGroupRef])

  const commitSidebarWidth = useCallback((nextSidebarWidth: number) => {
    args.setSidebarWidth((previous) => (Math.abs(nextSidebarWidth - previous) >= 1 ? nextSidebarWidth : previous))
  }, [args.setSidebarWidth])

  const commitRightRailWidth = useCallback((nextRightRailWidth: number) => {
    args.setRightRailWidth((previous) =>
      Math.abs(nextRightRailWidth - previous) >= 1 ? nextRightRailWidth : previous,
    )
  }, [args.setRightRailWidth])

  const onLeftResize = useCallback((sidebarSizePercent: number) => {
    if (!args.isSidebarOpen) return
    const clampedSidebar = clampSidebarWidth(sidebarSizePercent)
    pendingSidebarPercentRef.current = clampedSidebar
  }, [args.isSidebarOpen])

  const onRightResize = useCallback((rightSizePercent: number) => {
    if (!args.isRightRailOpen) return
    const clampedRight = clampRightRailWidth(rightSizePercent)
    pendingRightRailPercentRef.current = clampedRight
  }, [args.isRightRailOpen])

  const onLeftDragStateChange = useCallback((isDragging: boolean) => {
    if (isDragging) return
    if (!args.isSidebarOpen) return
    const clampedSidebar = pendingSidebarPercentRef.current
    if (Math.abs(clampedSidebar - args.sidebarWidth) >= 1) {
      commitSidebarWidth(clampedSidebar)
    }
  }, [args.isSidebarOpen, args.sidebarWidth, commitSidebarWidth])

  const onRightDragStateChange = useCallback((isDragging: boolean) => {
    if (isDragging) return
    if (!args.isRightRailOpen) return
    const clampedRight = pendingRightRailPercentRef.current
    if (Math.abs(clampedRight - args.rightRailWidth) >= 1) {
      commitRightRailWidth(clampedRight)
    }
  }, [args.isRightRailOpen, args.rightRailWidth, commitRightRailWidth])

  const onToggleSidebar = useCallback(() => {
    if (args.isSidebarOpen) {
      lastOpenSidebarWidthRef.current = clampSidebarWidth(args.sidebarWidth)
      args.setIsSidebarOpen(false)
      return
    }

    const restoredSidebarWidth = clampSidebarWidth(lastOpenSidebarWidthRef.current)
    args.setSidebarWidth(restoredSidebarWidth)
    args.setIsSidebarOpen(true)
  }, [args.isSidebarOpen, args.setIsSidebarOpen, args.setSidebarWidth, args.sidebarWidth])

  const onToggleRightRail = useCallback(() => {
    if (args.isRightRailOpen) {
      lastOpenRightRailWidthRef.current = clampRightRailWidth(args.rightRailWidth)
      args.setIsRightRailOpen(false)
      return
    }

    const restoredRightRailWidth = clampRightRailWidth(lastOpenRightRailWidthRef.current)
    args.setRightRailWidth(restoredRightRailWidth)
    args.setIsRightRailOpen(true)
  }, [args.isRightRailOpen, args.rightRailWidth, args.setIsRightRailOpen, args.setRightRailWidth])

  return {
    onLeftDragStateChange,
    onLeftResize,
    onRightDragStateChange,
    onRightResize,
    onToggleRightRail,
    onToggleSidebar,
  }
}
