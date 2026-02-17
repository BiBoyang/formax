import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

type SurfaceOperation = () => Promise<void>

function waitForNextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
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
      await args.onClearTerminal?.()
      args.setTranscriptSeq((n) => n + 1)
      await (args.waitForNextMacrotaskFn ?? waitForNextMacrotask)()
    },
  })
}
