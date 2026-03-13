import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Msg } from '../../../../shared/toolMessageTypes'

type SurfaceOperation = () => Promise<void>

function waitForNextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

async function clearTerminalAndRemount(args: {
  onClearTerminal?: () => void | Promise<void>
  setTranscriptSeq: Dispatch<SetStateAction<number>>
  waitForNextMacrotaskFn?: () => Promise<void>
}): Promise<void> {
  let clearError: unknown = null
  try {
    await args.onClearTerminal?.()
  } catch (error) {
    clearError = error
  }

  args.setTranscriptSeq((n) => n + 1)
  await (args.waitForNextMacrotaskFn ?? waitForNextMacrotask)()

  if (clearError) throw clearError
}

export function enqueueSurfaceOperation(args: {
  surfaceOpQueueRef: MutableRefObject<Promise<void>>
  op: SurfaceOperation
}): Promise<void> {
  const next = args.surfaceOpQueueRef.current.catch(() => undefined).then(args.op)
  args.surfaceOpQueueRef.current = next.catch(() => undefined)
  return next
}

export function queueTranscriptSurfaceReset(args: {
  surfaceOpQueueRef: MutableRefObject<Promise<void>>
  onClearTerminal?: () => void | Promise<void>
  setTranscriptSeq: Dispatch<SetStateAction<number>>
  waitForNextMacrotaskFn?: () => Promise<void>
}): Promise<void> {
  return enqueueSurfaceOperation({
    surfaceOpQueueRef: args.surfaceOpQueueRef,
    op: async () => {
      await clearTerminalAndRemount(args)
    },
  })
}

export function queueTranscriptSurfaceReplace(args: {
  surfaceOpQueueRef: MutableRefObject<Promise<void>>
  onClearTerminal?: () => void | Promise<void>
  setTranscriptSeq: Dispatch<SetStateAction<number>>
  setMessages: Dispatch<SetStateAction<Msg[]>>
  nextMessages: Msg[]
  waitForNextMacrotaskFn?: () => Promise<void>
}): Promise<void> {
  return enqueueSurfaceOperation({
    surfaceOpQueueRef: args.surfaceOpQueueRef,
    op: async () => {
      args.setMessages(() => args.nextMessages)
      await clearTerminalAndRemount(args)
    },
  })
}
