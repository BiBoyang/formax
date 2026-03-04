import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

function recentIso() {
  return new Date(Date.now() - 45_000).toISOString()
}

test.describe('rpc queue dev tools', () => {
  test('exposes queue metrics and burst helpers in dev runtime', async ({ page }) => {
    const updatedAt = recentIso()
    await installMockRpc(page, {
      threads: [
        {
          id: 'thread-rpc-dev',
          cwd: '/tmp/formax-dev',
          createdAt: updatedAt,
          updatedAt,
          messageCount: 1,
          lastUserPrompt: 'rpc dev',
          label: 'Thread RPC Dev',
        },
      ],
      threadMessages: {
        'thread-rpc-dev': {
          __null__: {
            data: [{ id: 'm1', kind: 'message', role: 'assistant', text: 'ready for rpc burst' }],
            nextCursor: null,
          },
        },
      },
    })

    await page.goto('/')
    await page.getByRole('button', { name: /Thread RPC Dev/i }).click()
    await expect(page.getByText('ready for rpc burst')).toBeVisible()
    await expect(page.getByText('connected')).toBeVisible()

    const helperFlags = await page.evaluate(() => ({
      hasMetrics: typeof window.__formaxDevRpcQueueMetrics === 'function',
      hasBurst: typeof window.__formaxDevRpcBurst === 'function',
    }))
    expect(helperFlags.hasMetrics).toBe(true)
    expect(helperFlags.hasBurst).toBe(true)

    const initialMetrics = await page.evaluate(() => window.__formaxDevRpcQueueMetrics?.() ?? null)
    expect(initialMetrics).not.toBeNull()
    expect(typeof initialMetrics.outboundQueueDepth).toBe('number')
    expect(typeof initialMetrics.outboundQueueCapacity).toBe('number')
    expect(typeof initialMetrics.inboundNotificationQueueDepth).toBe('number')
    expect(typeof initialMetrics.inboundNotificationQueueCapacity).toBe('number')
    expect(typeof initialMetrics.droppedOutboundNotifications).toBe('number')
    expect(typeof initialMetrics.droppedInboundNotifications).toBe('number')
    expect(typeof initialMetrics.overloadedRequests).toBe('number')

    const beforeCount = await page.evaluate(
      () =>
        (window.__mockRpcState?.requests || []).filter(
          (entry) => String(entry?.method || '') === 'dev/ping' && entry?.params?.source === 'e2e-rpc-burst',
        ).length,
    )

    const burstResult = await page.evaluate(async () => {
      return window.__formaxDevRpcBurst?.({
        totalRequests: 12,
        concurrency: 4,
        sampleEveryMs: 20,
        method: 'dev/ping',
        params: { source: 'e2e-rpc-burst' },
      })
    })

    expect(burstResult).toBeDefined()
    expect(burstResult.method).toBe('dev/ping')
    expect(burstResult.totalRequests).toBe(12)
    expect(burstResult.concurrency).toBe(4)
    expect(burstResult.started).toBe(12)
    expect(burstResult.completed).toBe(12)
    expect(burstResult.succeeded).toBe(12)
    expect(burstResult.failed).toBe(0)
    expect(burstResult.overloadErrors).toBe(0)
    expect(Array.isArray(burstResult.samples)).toBe(true)
    expect(burstResult.samples.length).toBeGreaterThan(1)

    const afterCount = await page.evaluate(
      () =>
        (window.__mockRpcState?.requests || []).filter(
          (entry) => String(entry?.method || '') === 'dev/ping' && entry?.params?.source === 'e2e-rpc-burst',
        ).length,
    )
    expect(afterCount - beforeCount).toBe(12)
  })

  test('captures overload and dropped-inbound regressions under constrained queue capacities', async ({ page }) => {
    const updatedAt = recentIso()
    await installMockRpc(page, {
      rpcQueueConfig: {
        outboundQueueCapacity: 2,
        inboundNotificationQueueCapacity: 1,
      },
      threads: [
        {
          id: 'thread-rpc-guard',
          cwd: '/tmp/formax-rpc-guard',
          createdAt: updatedAt,
          updatedAt,
          messageCount: 1,
          lastUserPrompt: 'rpc guard',
          label: 'Thread RPC Guard',
        },
      ],
      threadMessages: {
        'thread-rpc-guard': {
          __null__: {
            data: [{ id: 'm1', kind: 'message', role: 'assistant', text: 'ready for rpc guard' }],
            nextCursor: null,
          },
        },
      },
      notificationsByRequestMethod: {
        'dev/ping': [
          { method: 'turn/event', params: { threadId: 'thread-rpc-guard', turnId: 'turn-1', event: { type: 'tick' } }, emitMode: 'sync' },
          { method: 'turn/event', params: { threadId: 'thread-rpc-guard', turnId: 'turn-1', event: { type: 'tick' } }, emitMode: 'sync' },
          { method: 'turn/event', params: { threadId: 'thread-rpc-guard', turnId: 'turn-1', event: { type: 'tick' } }, emitMode: 'sync' },
        ],
      },
    })

    await page.goto('/')
    await page.getByRole('button', { name: /Thread RPC Guard/i }).click()
    await expect(page.getByText('ready for rpc guard')).toBeVisible()
    await expect(page.getByText('connected')).toBeVisible()

    const burstResult = await page.evaluate(async () => {
      return window.__formaxDevRpcBurst?.({
        totalRequests: 80,
        concurrency: 32,
        sampleEveryMs: 10,
        method: 'dev/ping',
        params: { source: 'e2e-rpc-overload-drop' },
      })
    })

    expect(burstResult).toBeDefined()
    expect(burstResult.started).toBe(80)
    expect(burstResult.completed).toBe(80)
    expect(burstResult.overloadErrors).toBeGreaterThan(0)

    const metrics = await page.evaluate(() => window.__formaxDevRpcQueueMetrics?.() ?? null)
    expect(metrics).not.toBeNull()
    expect(metrics.overloadedRequests).toBeGreaterThan(0)
    expect(metrics.droppedInboundNotifications).toBeGreaterThan(0)

    await expect(page.getByText(/\[rpc\] outbound request queue overloaded/i).first()).toBeVisible()
    await expect(page.getByText(/\[rpc\] dropped inbound notifications/i).first()).toBeVisible()
  })
})
