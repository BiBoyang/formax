import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

const FIXED_NOW = Date.UTC(2026, 1, 14, 12, 0, 0)

function width(node) {
  return Math.round(node.getBoundingClientRect().width)
}

test.describe('pane resize', () => {
  test('left and right handles both resize their target panes', async ({ page }) => {
    const updatedAt = new Date(FIXED_NOW - 60_000).toISOString()
    await installMockRpc(page, {
      threads: [
        {
          id: 'thread-alpha',
          cwd: '/repo',
          createdAt: updatedAt,
          updatedAt,
          messageCount: 3,
          lastUserPrompt: 'alpha prompt',
          label: 'Alpha Session',
        },
      ],
      threadMessages: {
        'thread-alpha': {
          __null__: { data: [{ id: 'm1', role: 'assistant', text: 'hello' }], nextCursor: null },
        },
      },
      diffSnapshot: {
        cwd: '/repo',
        generatedAt: new Date(FIXED_NOW).toISOString(),
        hasChanges: true,
        truncated: false,
        files: [{ path: 'a.txt', additions: 2, deletions: 0, patch: '+a\n+b' }],
      },
    })

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: /Alpha Session/i }).click()
    await expect(page.getByTestId('left-rail')).toBeVisible()
    await expect(page.getByTestId('right-rail')).toBeVisible()

    const handles = page.locator('[data-slot="resizable-handle"]')
    await expect(handles).toHaveCount(2)

    const leftBefore = await page.getByTestId('left-rail').evaluate(width)
    const rightBefore = await page.getByTestId('right-rail').evaluate(width)

    const leftHandle = await handles.nth(0).boundingBox()
    if (!leftHandle) throw new Error('left resize handle not found')
    await page.mouse.move(leftHandle.x + leftHandle.width / 2, leftHandle.y + 120)
    await page.mouse.down()
    await page.mouse.move(leftHandle.x + 120, leftHandle.y + 120, { steps: 10 })
    await page.mouse.up()

    const leftAfter = await page.getByTestId('left-rail').evaluate(width)
    expect(leftAfter).toBeGreaterThan(leftBefore + 40)

    const rightHandle = await handles.nth(1).boundingBox()
    if (!rightHandle) throw new Error('right resize handle not found')
    await page.mouse.move(rightHandle.x + rightHandle.width / 2, rightHandle.y + 120)
    await page.mouse.down()
    await page.mouse.move(rightHandle.x - 140, rightHandle.y + 120, { steps: 10 })
    await page.mouse.up()

    const rightAfter = await page.getByTestId('right-rail').evaluate(width)
    expect(rightAfter).toBeGreaterThan(rightBefore + 60)
  })
})
