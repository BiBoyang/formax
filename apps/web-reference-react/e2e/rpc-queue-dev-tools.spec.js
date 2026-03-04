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
})
