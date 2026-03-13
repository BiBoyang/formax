function enqueueSessionTransition(args: {
  sessionTransitionQueueRef: { current: Promise<void> }
  sessionTransitionPendingCountRef: { current: number }
  run: () => Promise<void>
}): Promise<void> {
  args.sessionTransitionPendingCountRef.current += 1
  const next = args.sessionTransitionQueueRef.current.catch(() => undefined).then(async () => {
    try {
      await args.run()
    } finally {
      args.sessionTransitionPendingCountRef.current = Math.max(0, args.sessionTransitionPendingCountRef.current - 1)
    }
  })
  args.sessionTransitionQueueRef.current = next.catch(() => undefined)
  return next
}

export {
  enqueueSessionTransition,
}

