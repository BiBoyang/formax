import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

function recentIso() {
  return new Date(Date.now() - 45_000).toISOString()
}

test.describe('tool row toggle stress', () => {
  test('keeps transcript responsive after 50 open/close toggles', async ({ page }) => {
    const updatedAt = recentIso()
    await installMockRpc(page, {
      threads: [
        {
          id: 'thread-tools-stress',
          cwd: '/tmp/formax',
          createdAt: updatedAt,
          updatedAt,
          messageCount: 3,
          lastUserPrompt: 'run checks',
          label: 'Thread Tools Stress',
        },
      ],
      threadMessages: {
        'thread-tools-stress': {
          __null__: {
            data: [
              { id: 'm1', kind: 'message', role: 'user', text: 'run type-check' },
              {
                id: 't1',
                kind: 'tool',
                toolUseId: 'tool-1',
                toolName: 'Bash',
                status: 'completed',
                summary: 'Ran command for 3s',
                paramsText: 'command=\"npm run type-check\"',
                detailLines: ['> tsc --noEmit'],
              },
              { id: 'm2', kind: 'message', role: 'assistant', text: 'done' },
            ],
            nextCursor: null,
          },
        },
      },
    })

    await page.goto('/')
    await page.getByRole('button', { name: /Thread Tools Stress/i }).click()

    const toolRowButton = page.getByRole('button', { name: 'Bash npm run type-check' })
    await expect(toolRowButton).toBeVisible()

    for (let index = 0; index < 50; index += 1) {
      await toolRowButton.click()
    }

    await expect(toolRowButton).toBeVisible()
    await expect(page.getByPlaceholder('Ask for follow-up changes')).toBeVisible()
  })
})
