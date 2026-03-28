import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_OPEN_TARGET_OPTIONS, type OpenTargetOption, type UpdateUserSetting, type UserSettings } from '../core/userSettings'

type DesktopBridge = NonNullable<Window['formaxDesktop']>
type DesktopTerminalBridge = NonNullable<NonNullable<Window['formaxDesktop']>['terminal']>
type DesktopWindowAppearanceState = {
  revision: number
  windowTransparencyEnabled: boolean
}

const DEFAULT_DESKTOP_WINDOW_APPEARANCE_STATE: DesktopWindowAppearanceState = {
  revision: 0,
  windowTransparencyEnabled: true,
}

function readDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  return window.formaxDesktop ?? null
}

function readDesktopTerminalBridge(bridge: DesktopBridge | null): DesktopTerminalBridge | null {
  const candidate = bridge?.terminal
  if (
    !candidate?.ensureSession ||
    !candidate.getSnapshot ||
    !candidate.write ||
    !candidate.resize ||
    !candidate.destroySession ||
    !candidate.subscribe
  ) {
    return null
  }
  return candidate as DesktopTerminalBridge
}

function normalizeDesktopWindowAppearanceState(payload: unknown): DesktopWindowAppearanceState {
  if (!payload || typeof payload !== 'object') return DEFAULT_DESKTOP_WINDOW_APPEARANCE_STATE
  const candidate = payload as Partial<DesktopWindowAppearanceState>
  const revisionRaw = candidate.revision
  const revision =
    typeof revisionRaw === 'number' && Number.isFinite(revisionRaw) && revisionRaw >= 0 ? Math.floor(revisionRaw) : 0
  const windowTransparencyEnabled = candidate.windowTransparencyEnabled === true
  return {
    revision,
    windowTransparencyEnabled,
  }
}

export type UseDesktopBridgeArgs = {
  defaultOpenTarget: UserSettings['defaultOpenTarget']
  onUserSettingChange: UpdateUserSetting
  shouldKeepSystemAwake: boolean
}

export function useDesktopBridge(args: UseDesktopBridgeArgs) {
  const { defaultOpenTarget, onUserSettingChange, shouldKeepSystemAwake } = args
  const desktopBridge = useMemo(() => readDesktopBridge(), [])
  const terminalBridge = useMemo(() => readDesktopTerminalBridge(desktopBridge), [desktopBridge])
  const isDesktopClient = desktopBridge != null
  const isMacDesktopClient =
    isDesktopClient &&
    typeof navigator !== 'undefined' &&
    (navigator.userAgentData?.platform?.toLowerCase() === 'macos' || /mac/i.test(navigator.platform))
  const [desktopWindowAppearanceState, setDesktopWindowAppearanceState] = useState<DesktopWindowAppearanceState>(
    DEFAULT_DESKTOP_WINDOW_APPEARANCE_STATE,
  )
  const [availableOpenTargets, setAvailableOpenTargets] = useState<OpenTargetOption[]>(DEFAULT_OPEN_TARGET_OPTIONS)
  const isWindowTransparent = desktopWindowAppearanceState.windowTransparencyEnabled

  const windowTransparencyCommandQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingWindowTransparencyCommandsRef = useRef(0)
  const windowTransparencyIntentRef = useRef(isWindowTransparent)
  const latestWindowTransparencyEnabledRef = useRef(isWindowTransparent)

  useEffect(() => {
    latestWindowTransparencyEnabledRef.current = isWindowTransparent
    if (pendingWindowTransparencyCommandsRef.current === 0) {
      windowTransparencyIntentRef.current = isWindowTransparent
    }
  }, [isWindowTransparent])

  const commitHostWindowAppearanceState = useCallback((payload: unknown) => {
    const normalizedState = normalizeDesktopWindowAppearanceState(payload)
    setDesktopWindowAppearanceState((previous) => (normalizedState.revision >= previous.revision ? normalizedState : previous))
    if (pendingWindowTransparencyCommandsRef.current === 0) {
      windowTransparencyIntentRef.current = normalizedState.windowTransparencyEnabled
    }
  }, [])

  const onToggleWindowTransparency = useCallback(() => {
    if (!isDesktopClient) return
    const setWindowTransparency = desktopBridge?.windowAppearance?.setWindowTransparency
    if (!setWindowTransparency) return
    const nextEnabled = !windowTransparencyIntentRef.current
    windowTransparencyIntentRef.current = nextEnabled

    pendingWindowTransparencyCommandsRef.current += 1

    const nextCommand = windowTransparencyCommandQueueRef.current
      .then(async () => {
        const nextState = await setWindowTransparency(nextEnabled)
        commitHostWindowAppearanceState(nextState)
      })
      .catch(() => {
        // Ignore transient desktop-bridge failures and keep latest known host state.
      })
      .finally(() => {
        pendingWindowTransparencyCommandsRef.current = Math.max(0, pendingWindowTransparencyCommandsRef.current - 1)
        if (pendingWindowTransparencyCommandsRef.current === 0) {
          windowTransparencyIntentRef.current = latestWindowTransparencyEnabledRef.current
        }
      })

    windowTransparencyCommandQueueRef.current = nextCommand.then(() => undefined, () => undefined)
  }, [commitHostWindowAppearanceState, desktopBridge, isDesktopClient])

  useEffect(() => {
    if (!isDesktopClient) return
    const windowAppearance = desktopBridge?.windowAppearance
    if (!windowAppearance) return
    let isDisposed = false

    const syncInitialState = async () => {
      if (!windowAppearance.getState) return
      try {
        const state = await windowAppearance.getState()
        if (isDisposed) return
        commitHostWindowAppearanceState(state)
      } catch {
        // Keep renderer fallback state when desktop bridge get-state is unavailable.
      }
    }

    void syncInitialState()

    const unsubscribe = windowAppearance.subscribe?.((state) => {
      if (isDisposed) return
      commitHostWindowAppearanceState(state)
    })

    return () => {
      isDisposed = true
      unsubscribe?.()
    }
  }, [commitHostWindowAppearanceState, desktopBridge, isDesktopClient])

  useLayoutEffect(() => {
    if (!isDesktopClient) return
    const root = document.documentElement
    root.dataset.windowTransparency = isWindowTransparent ? 'on' : 'off'
    root.dataset.desktopClient = 'true'
    root.dataset.desktopPlatform = isMacDesktopClient ? 'mac' : 'other'
  }, [isDesktopClient, isMacDesktopClient, isWindowTransparent])

  useLayoutEffect(() => {
    if (!isDesktopClient) return
    const root = document.documentElement
    return () => {
      delete root.dataset.windowTransparency
      delete root.dataset.desktopClient
      delete root.dataset.desktopPlatform
    }
  }, [isDesktopClient])

  useEffect(() => {
    if (!isDesktopClient) return
    const setPreventSleep = desktopBridge?.powerManagement?.setPreventSleep
    if (!setPreventSleep) return
    void setPreventSleep(shouldKeepSystemAwake).catch(() => {
      // Keep UI responsive if desktop power-management bridge is unavailable.
    })
  }, [desktopBridge, isDesktopClient, shouldKeepSystemAwake])

  useEffect(() => {
    if (!isDesktopClient) return
    const listAvailableOpenTargets = desktopBridge?.openTargets?.listAvailable
    if (!listAvailableOpenTargets) return
    let cancelled = false
    void listAvailableOpenTargets()
      .then((targets) => {
        if (cancelled) return
        if (!Array.isArray(targets) || targets.length === 0) {
          setAvailableOpenTargets(DEFAULT_OPEN_TARGET_OPTIONS)
          return
        }
        setAvailableOpenTargets(
          targets
            .filter((target): target is OpenTargetOption => Boolean(target?.id) && Boolean(target?.label))
            .map((target) => ({ id: target.id, label: target.label })),
        )
      })
      .catch(() => {
        if (cancelled) return
        setAvailableOpenTargets(DEFAULT_OPEN_TARGET_OPTIONS)
      })
    return () => {
      cancelled = true
    }
  }, [desktopBridge, isDesktopClient])

  useEffect(() => {
    if (availableOpenTargets.length === 0) return
    const hasConfiguredTarget = availableOpenTargets.some((target) => target.id === defaultOpenTarget)
    if (hasConfiguredTarget) return
    onUserSettingChange('defaultOpenTarget', availableOpenTargets[0]!.id)
  }, [availableOpenTargets, defaultOpenTarget, onUserSettingChange])

  return {
    availableOpenTargets,
    desktopBridge,
    isDesktopClient,
    isWindowTransparent,
    onToggleWindowTransparency,
    terminalBridge,
  }
}
