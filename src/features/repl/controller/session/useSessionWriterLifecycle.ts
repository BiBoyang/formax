import { useCallback } from 'react'
import type { ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import type { SessionWriterRefs } from './sessionLifecycle'
import {
  ensureSessionWriter as ensureSessionWriterInternal,
  openInitialSessionWriter as openInitialSessionWriterInternal,
  shutdownSessionWriter as shutdownSessionWriterInternal,
  startNewSessionWriter as startNewSessionWriterInternal,
} from './sessionLifecycle'

function useSessionWriterLifecycle(args: {
  sessionSaveEnabled: boolean
  cwd: string
  env: NodeJS.ProcessEnv
  model: string
  historyRef: { current: ChatHistory }
  refs: SessionWriterRefs
  initialSessionFilePathRef: { current: string | undefined }
  initialSessionMessages?: Msg[]
}): {
  startNewSessionWriter: () => Promise<void>
  openInitialSessionWriter: () => Promise<void>
  shutdownSessionWriter: () => Promise<void>
  ensureSessionWriter: () => Promise<void>
} {
  const startNewSessionWriter = useCallback(async (): Promise<void> => {
    await startNewSessionWriterInternal({
      sessionSaveEnabled: args.sessionSaveEnabled,
      cwd: args.cwd,
      env: args.env,
      model: args.model,
      historyRef: args.historyRef,
      refs: args.refs,
    })
  }, [args.cwd, args.env, args.historyRef, args.model, args.refs, args.sessionSaveEnabled])

  const openInitialSessionWriter = useCallback(async (): Promise<void> => {
    const initialSessionFilePath = args.initialSessionFilePathRef.current
    await openInitialSessionWriterInternal({
      sessionSaveEnabled: args.sessionSaveEnabled,
      initialSession: {
        ...(initialSessionFilePath ? { filePath: initialSessionFilePath } : {}),
        ...(args.initialSessionMessages ? { messages: args.initialSessionMessages } : {}),
      },
      historyRef: args.historyRef,
      refs: args.refs,
      startNewWriter: startNewSessionWriter,
    })
  }, [args.historyRef, args.initialSessionFilePathRef, args.initialSessionMessages, args.refs, args.sessionSaveEnabled, startNewSessionWriter])

  const shutdownSessionWriter = useCallback(async (): Promise<void> => {
    await shutdownSessionWriterInternal(args.refs)
  }, [args.refs])

  const ensureSessionWriter = useCallback(async (): Promise<void> => {
    await ensureSessionWriterInternal({
      sessionSaveEnabled: args.sessionSaveEnabled,
      refs: args.refs,
      openInitialWriter: openInitialSessionWriter,
    })
  }, [args.refs, args.sessionSaveEnabled, openInitialSessionWriter])

  return {
    startNewSessionWriter,
    openInitialSessionWriter,
    shutdownSessionWriter,
    ensureSessionWriter,
  }
}

export {
  useSessionWriterLifecycle,
}
