import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

function recentIso() {
  return new Date(Date.now() - 30_000).toISOString()
}

function buildMessages(count) {
  return Array.from({ length: count }, (_, idx) => ({
    id: `m-${idx + 1}`,
    kind: 'message',
    role: idx % 2 === 0 ? 'assistant' : 'user',
    text: `message-${idx + 1}`,
  }))
}

function buildDiffFiles(count) {
  return Array.from({ length: count }, (_, idx) => ({
    path: `src/module-${idx + 1}.ts`,
    additions: (idx % 5) + 1,
    deletions: idx % 3,
    patch: '',
  }))
}

test.describe('nested scroll boundary', () => {
  test('center and right panes keep independent wheel scrolling', async ({ page }) => {
    const updatedAt = recentIso()
    await installMockRpc(page, {
      threads: [
        {
          id: 'thread-scroll',
          cwd: '/tmp/formax',
          createdAt: updatedAt,
          updatedAt,
          messageCount: 120,
          lastUserPrompt: 'scroll test',
          label: 'Thread Scroll',
        },
      ],
      threadMessages: {
        'thread-scroll': {
          __null__: {
            data: buildMessages(140),
            nextCursor: null,
          },
        },
      },
      diffSnapshot: {
        cwd: '/tmp/formax',
        generatedAt: new Date().toISOString(),
        hasChanges: true,
        truncated: false,
        files: buildDiffFiles(120),
      },
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: /Thread Scroll/i }).click()
    await expect(page.getByText('message-140')).toBeVisible()

    const viewports = page.locator('[data-radix-scroll-area-viewport]')
    await expect(viewports).toHaveCount(2)

    const centerViewport = viewports.nth(0)
    const rightViewport = viewports.nth(1)

    await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[data-radix-scroll-area-viewport]'))
      const center = nodes[0]
      const right = nodes[1]
      if (center) center.scrollTop = 300
      if (right) right.scrollTop = 300
    })

    const centerBefore = await centerViewport.evaluate((node) => node.scrollTop)
    const rightBefore = await rightViewport.evaluate((node) => node.scrollTop)

    await centerViewport.hover()
    await page.mouse.wheel(0, 280)
    await page.waitForTimeout(80)

    const centerAfterCenterWheel = await centerViewport.evaluate((node) => node.scrollTop)
    const rightAfterCenterWheel = await rightViewport.evaluate((node) => node.scrollTop)
    expect(centerAfterCenterWheel).toBeGreaterThan(centerBefore)
    expect(rightAfterCenterWheel).toBe(rightBefore)

    await rightViewport.hover()
    await page.mouse.wheel(0, 280)
    await page.waitForTimeout(80)

    const centerAfterRightWheel = await centerViewport.evaluate((node) => node.scrollTop)
    const rightAfterRightWheel = await rightViewport.evaluate((node) => node.scrollTop)
    expect(rightAfterRightWheel).toBeGreaterThan(rightAfterCenterWheel)
    expect(centerAfterRightWheel).toBe(centerAfterCenterWheel)
  })
})
