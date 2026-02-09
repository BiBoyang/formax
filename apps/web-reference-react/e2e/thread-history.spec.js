import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

function recentIso() {
  return new Date(Date.now() - 60_000).toISOString()
}

test.describe('thread history', () => {
  test('loads selected thread history and supports loading earlier messages', async ({ page }) => {
    const updatedAt = recentIso()
    await installMockRpc(page, {
      threads: [
        {
          id: 'thread-alpha',
          cwd: '/tmp/formax',
          createdAt: updatedAt,
          updatedAt,
          messageCount: 4,
          lastUserPrompt: 'alpha prompt',
          label: 'Thread Alpha',
        },
      ],
      threadMessages: {
        'thread-alpha': {
          __null__: {
            data: [
              { id: 'm3', role: 'user', text: 'newer question' },
              { id: 'm4', role: 'assistant', text: 'newer answer' },
            ],
            nextCursor: 'older-1',
          },
          'older-1': {
            data: [
              { id: 'm1', role: 'user', text: 'older question' },
              { id: 'm2', role: 'assistant', text: 'older answer' },
            ],
            nextCursor: null,
          },
        },
      },
    })

    await page.goto('/')
    await page.getByRole('button', { name: /Thread Alpha/i }).click()

    await expect(page.getByText('newer answer')).toBeVisible()
    const loadEarlierButton = page.getByRole('button', { name: 'Load earlier messages' })
    await expect(loadEarlierButton).toBeVisible()
    await loadEarlierButton.click()

    await expect(page.getByText('older answer')).toBeVisible()
    await expect(loadEarlierButton).toHaveCount(0)
  })
})
