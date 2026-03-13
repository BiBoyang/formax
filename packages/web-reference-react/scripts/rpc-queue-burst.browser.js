;(async () => {
  if (typeof window === 'undefined') {
    throw new Error('This script must run in a browser context.')
  }

  const burst = window.__formaxDevRpcBurst
  if (typeof burst !== 'function') {
    throw new Error('window.__formaxDevRpcBurst is not available. Ensure dev mode is enabled.')
  }

  const options = {
    totalRequests: 400,
    concurrency: 32,
    sampleEveryMs: 100,
    method: 'thread/list',
    params: { limit: 20 },
  }

  const result = await burst(options)
  const summary = {
    method: result.method,
    totalRequests: result.totalRequests,
    concurrency: result.concurrency,
    sampleEveryMs: result.sampleEveryMs,
    succeeded: result.succeeded,
    failed: result.failed,
    overloadErrors: result.overloadErrors,
    droppedOutboundNotifications: result.finalMetrics.droppedOutboundNotifications,
    droppedInboundNotifications: result.finalMetrics.droppedInboundNotifications,
    overloadedRequests: result.finalMetrics.overloadedRequests,
  }

  console.table(summary)
  console.log('queue metrics samples:', result.samples)
})().catch((error) => {
  console.error('[rpc-queue-burst] failed', error)
})
