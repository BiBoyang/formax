import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

function recentIso() {
  return new Date(Date.now() - 60_000).toISOString()
}

test.describe('diff collapsible', () => {
  test('renders file list collapsed and expands patch rows on click', async ({ page }) => {
    const updatedAt = recentIso()
    await installMockRpc(page, {
      threads: [
        {
          id: 'thread-diff',
          cwd: '/tmp/formax',
          createdAt: updatedAt,
          updatedAt,
          messageCount: 0,
          lastUserPrompt: null,
          label: 'Thread Diff',
        },
      ],
      diffSnapshot: {
        cwd: '/tmp/formax',
        generatedAt: new Date().toISOString(),
        hasChanges: true,
        truncated: false,
        files: [
          {
            path: 'src/features/diff/view.tsx',
            additions: 1,
            deletions: 1,
            patch: '@@ -1,1 +1,1 @@\n-old line\n+new line',
          },
        ],
      },
    })

    await page.goto('/')
    await expect(page.getByText('src/features/diff/view.tsx')).toBeVisible()
    await expect(page.getByText('new line')).toHaveCount(0)

    await page.getByRole('button', { name: /src\/features\/diff\/view\.tsx/ }).click()
    await expect(page.getByText('new line')).toBeVisible()
    await expect(page.getByText('old line')).toBeVisible()

    await page.getByRole('button', { name: /src\/features\/diff\/view\.tsx/ }).click()
    await expect(page.getByText('new line')).toHaveCount(0)
  })
})
