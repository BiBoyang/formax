import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

function recentIso() {
  return new Date(Date.now() - 45_000).toISOString()
}

test.describe('tool history persistence on refresh', () => {
  test('keeps tool summary rows available after browser refresh', async ({ page }) => {
    const updatedAt = recentIso()
    await installMockRpc(page, {
      threads: [
        {
          id: 'thread-tools',
          cwd: '/tmp/formax',
          createdAt: updatedAt,
          updatedAt,
          messageCount: 3,
          lastUserPrompt: 'run checks',
          label: 'Thread Tools',
        },
      ],
      threadMessages: {
        'thread-tools': {
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
    await page.getByRole('button', { name: /Thread Tools/i }).click()
    await expect(page.getByText(/Bash\(command=/)).toBeVisible()
    await expect(page.getByText('Ran command for 3s')).toBeVisible()

    await page.reload()
    await page.getByRole('button', { name: /Thread Tools/i }).click()
    await expect(page.getByText(/Bash\(command=/)).toBeVisible()
    await expect(page.getByText('Ran command for 3s')).toBeVisible()
  })
})
