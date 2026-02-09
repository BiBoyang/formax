import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

function recentIso() {
  return new Date(Date.now() - 30_000).toISOString()
}

test.describe('send loading indicator', () => {
  test('shows thinking loading after send while turn is active', async ({ page }) => {
    const updatedAt = recentIso()
    await installMockRpc(page, {
      threads: [
        {
          id: 'thread-send',
          cwd: '/tmp/formax',
          createdAt: updatedAt,
          updatedAt,
          messageCount: 0,
          lastUserPrompt: null,
          label: 'Thread Send',
        },
      ],
      threadMessages: {
        'thread-send': {
          __null__: { data: [], nextCursor: null },
        },
      },
      turnStart: { id: 'turn-send-1' },
      notificationsByRequestMethod: {
        'turn/start': [
          {
            method: 'turn/started',
            params: { turn: { id: 'turn-send-1' } },
            delayMs: 20,
          },
          {
            method: 'turn/completed',
            params: { turn: { id: 'turn-send-1' } },
            delayMs: 280,
          },
        ],
      },
    })

    await page.goto('/')
    await page.getByRole('button', { name: /Thread Send/i }).click()
    await page.getByPlaceholder('Ask for follow-up changes').fill('hello loading')
    await page.getByLabel('Send message').click()

    await expect(page.getByTestId('turn-loading')).toBeVisible()
    await expect(page.getByText('thinking')).toBeVisible()
    await expect(page.getByTestId('turn-loading')).toHaveCount(0)
  })
})
