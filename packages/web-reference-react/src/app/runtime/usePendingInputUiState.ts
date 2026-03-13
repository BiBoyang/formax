import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, MutableRefObject } from 'react'
import type { AppAction } from '../../store'
import type { PendingInput } from '../../types'
import {
  buildAskUiStateFromPendingInputs,
  mapsAreShallowEqual,
  pruneMapByPendingIds,
  resolveSelectedInputId,
  toPendingInputIdSet,
} from '../core/inputStateMachine'
import type { ReplayStateSnapshot } from '../core/rpcParsers'

export type SubmitStatusByInputId = Record<string, { status: string; kind: 'success' | 'error'; message?: string }>

type UsePendingInputUiStateArgs = {
  pendingInputs: Record<string, PendingInput>
  selectedInputId: string | null
  dispatch: Dispatch<AppAction>
  activeThreadIdRef: MutableRefObject<string | null>
  selectedInputIdRef: MutableRefObject<string | null>
}

export function usePendingInputUiState(args: UsePendingInputUiStateArgs) {
  const { pendingInputs, selectedInputId, dispatch, activeThreadIdRef, selectedInputIdRef } = args
  const [submitStatusByInputId, setSubmitStatusByInputId] = useState<SubmitStatusByInputId>({})
  const [askDockOpenByInputId, setAskDockOpenByInputId] = useState<Record<string, boolean>>({})
  const [askDraftByInputId, setAskDraftByInputId] = useState<Record<string, Record<string, string>>>({})
  const [askPageIndexByInputId, setAskPageIndexByInputId] = useState<Record<string, number>>({})

  const selectedInput = selectedInputId ? pendingInputs[selectedInputId] : null
  const selectedAskDraft = selectedInput ? (askDraftByInputId[selectedInput.inputId] ?? {}) : {}
  const selectedAskPageIndex = selectedInput ? (askPageIndexByInputId[selectedInput.inputId] ?? 0) : 0
  const isSelectedAskOpen =
    selectedInput?.kind === 'ask_user_question' ? Boolean(askDockOpenByInputId[selectedInput.inputId] ?? true) : false
  const composerLocked =
    selectedInput != null &&
    (selectedInput.kind === 'approval' || (selectedInput.kind === 'ask_user_question' && isSelectedAskOpen))

  const submitStatus = selectedInput ? (submitStatusByInputId[selectedInput.inputId] ?? null) : null

  const syncPendingInputsFromReplayState = useCallback(
    (threadId: string, replayState: ReplayStateSnapshot | null) => {
      if (activeThreadIdRef.current !== threadId) return
      const replayPendingInputs = replayState?.pendingInputs ?? []
      const pendingInputIdSet = new Set(replayPendingInputs.map((input) => input.inputId))
      const selectedInputIdBeforeSync = selectedInputIdRef.current

      dispatch({ type: 'clear_pending_inputs' })
      for (const input of replayPendingInputs) {
        dispatch({ type: 'input_requested', input })
      }
      if (selectedInputIdBeforeSync && pendingInputIdSet.has(selectedInputIdBeforeSync)) {
        dispatch({ type: 'set_selected_input', inputId: selectedInputIdBeforeSync })
      }

      setSubmitStatusByInputId((prev) => {
        if (Object.keys(prev).length === 0) return prev
        const next: SubmitStatusByInputId = {}
        for (const [inputId, status] of Object.entries(prev)) {
          if (!pendingInputIdSet.has(inputId)) continue
          next[inputId] = status
        }
        return next
      })

      setAskDockOpenByInputId((prevAskDockOpenByInputId) => {
        return buildAskUiStateFromPendingInputs({
          pendingInputs: replayPendingInputs,
          prevAskDockOpenByInputId,
          prevAskDraftByInputId: {},
          prevAskPageIndexByInputId: {},
        }).askDockOpenByInputId
      })
      setAskDraftByInputId((prevAskDraftByInputId) => {
        return buildAskUiStateFromPendingInputs({
          pendingInputs: replayPendingInputs,
          prevAskDockOpenByInputId: {},
          prevAskDraftByInputId,
          prevAskPageIndexByInputId: {},
        }).askDraftByInputId
      })
      setAskPageIndexByInputId((prevAskPageIndexByInputId) => {
        return buildAskUiStateFromPendingInputs({
          pendingInputs: replayPendingInputs,
          prevAskDockOpenByInputId: {},
          prevAskDraftByInputId: {},
          prevAskPageIndexByInputId,
        }).askPageIndexByInputId
      })
    },
    [activeThreadIdRef, dispatch, selectedInputIdRef],
  )

  useEffect(() => {
    const pendingIdSet = toPendingInputIdSet(pendingInputs)
    const nextSelectedInputId = resolveSelectedInputId({
      pendingInputsById: pendingInputs,
      selectedInputId,
    })
    if (nextSelectedInputId !== selectedInputId) {
      dispatch({ type: 'set_selected_input', inputId: nextSelectedInputId })
    }

    setAskDockOpenByInputId((prev) => {
      const next = pruneMapByPendingIds(prev, pendingIdSet)
      return mapsAreShallowEqual(prev, next) ? prev : next
    })
    setAskDraftByInputId((prev) => {
      const next = pruneMapByPendingIds(prev, pendingIdSet)
      return mapsAreShallowEqual(prev, next) ? prev : next
    })
    setAskPageIndexByInputId((prev) => {
      const next = pruneMapByPendingIds(prev, pendingIdSet)
      return mapsAreShallowEqual(prev, next) ? prev : next
    })
  }, [dispatch, pendingInputs, selectedInputId])

  useEffect(() => {
    const pendingInputList = Object.values(pendingInputs)
    setAskDockOpenByInputId((prev) => {
      const next = buildAskUiStateFromPendingInputs({
        pendingInputs: pendingInputList,
        prevAskDockOpenByInputId: prev,
        prevAskDraftByInputId: {},
        prevAskPageIndexByInputId: {},
      }).askDockOpenByInputId
      return mapsAreShallowEqual(prev, next) ? prev : next
    })
    setAskDraftByInputId((prev) => {
      const next = buildAskUiStateFromPendingInputs({
        pendingInputs: pendingInputList,
        prevAskDockOpenByInputId: {},
        prevAskDraftByInputId: prev,
        prevAskPageIndexByInputId: {},
      }).askDraftByInputId
      return mapsAreShallowEqual(prev, next) ? prev : next
    })
    setAskPageIndexByInputId((prev) => {
      const next = buildAskUiStateFromPendingInputs({
        pendingInputs: pendingInputList,
        prevAskDockOpenByInputId: {},
        prevAskDraftByInputId: {},
        prevAskPageIndexByInputId: prev,
      }).askPageIndexByInputId
      return mapsAreShallowEqual(prev, next) ? prev : next
    })
  }, [pendingInputs])

  const onAskOpen = useCallback(() => {
    if (!selectedInput || selectedInput.kind !== 'ask_user_question') return
    setAskDockOpenByInputId((prev) => ({ ...prev, [selectedInput.inputId]: true }))
  }, [selectedInput])

  const onAskDismiss = useCallback(() => {
    if (!selectedInput || selectedInput.kind !== 'ask_user_question') return
    setAskDockOpenByInputId((prev) => ({ ...prev, [selectedInput.inputId]: false }))
  }, [selectedInput])

  const onAskPageChange = useCallback(
    (page: number) => {
      if (!selectedInput || selectedInput.kind !== 'ask_user_question') return
      setAskPageIndexByInputId((prev) => ({ ...prev, [selectedInput.inputId]: Math.max(0, page) }))
    },
    [selectedInput],
  )

  const onAskDraftChange = useCallback(
    (fieldId: string, value: string) => {
      if (!selectedInput || selectedInput.kind !== 'ask_user_question') return
      setAskDraftByInputId((prev) => ({
        ...prev,
        [selectedInput.inputId]: {
          ...(prev[selectedInput.inputId] ?? {}),
          [fieldId]: value,
        },
      }))
    },
    [selectedInput],
  )

  return {
    selectedInput,
    selectedAskDraft,
    selectedAskPageIndex,
    isSelectedAskOpen,
    composerLocked,
    submitStatus,
    submitStatusByInputId,
    setSubmitStatusByInputId,
    setAskDockOpenByInputId,
    setAskDraftByInputId,
    setAskPageIndexByInputId,
    onAskOpen,
    onAskDismiss,
    onAskPageChange,
    onAskDraftChange,
    syncPendingInputsFromReplayState,
  }
}
