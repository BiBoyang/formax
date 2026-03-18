import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { queueTranscriptSurfaceReplace, queueTranscriptSurfaceReset } from './surfaceReset'

function useTranscriptSurfaceActions(args: {
  surfaceOpQueueRef: { current: Promise<void> }
  onClearTerminal?: () => void | Promise<void>
  setTranscriptSeq: Dispatch<SetStateAction<number>>
  setMessages: Dispatch<SetStateAction<Msg[]>>
}): {
  resetTranscriptSurface: () => Promise<void>
  replaceTranscript: (nextMessages: Msg[]) => Promise<void>
} {
  const resetTranscriptSurface = useCallback(() => {
    // Ink <Static> is append-only; clear + remount must be serialized to avoid
    // rapid keypress races (Ctrl+O/Ctrl+E) that can leave stale frame artifacts.
    return queueTranscriptSurfaceReset({
      surfaceOpQueueRef: args.surfaceOpQueueRef,
      onClearTerminal: args.onClearTerminal,
      setTranscriptSeq: args.setTranscriptSeq,
    })
  }, [args.onClearTerminal, args.setTranscriptSeq, args.surfaceOpQueueRef])

  const replaceTranscript = useCallback(
    (nextMessages: Msg[]) => {
      return queueTranscriptSurfaceReplace({
        surfaceOpQueueRef: args.surfaceOpQueueRef,
        onClearTerminal: args.onClearTerminal,
        setTranscriptSeq: args.setTranscriptSeq,
        setMessages: args.setMessages,
        nextMessages,
      })
    },
    [args.onClearTerminal, args.setMessages, args.setTranscriptSeq, args.surfaceOpQueueRef],
  )

  return {
    resetTranscriptSurface,
    replaceTranscript,
  }
}

export {
  useTranscriptSurfaceActions,
}
