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
            patch: [
              'diff --git a/src/features/diff/view.tsx b/src/features/diff/view.tsx',
              '--- a/src/features/diff/view.tsx',
              '+++ b/src/features/diff/view.tsx',
              '@@ -1,1 +1,1 @@',
              '-old line',
              '+new line',
            ].join('\n'),
          },
        ],
      },
    })

    await page.goto('/')
    await page.getByText('Thread Diff').click()
    await expect(page.getByText('src/features/diff/view.tsx')).toBeVisible()
    await expect(page.locator('diffs-container')).toHaveCount(0)

    await page.getByTestId('diff-file-row-src/features/diff/view.tsx').click()
    await expect(page.locator('diffs-container')).toHaveCount(1)
    await expect
      .poll(async () => {
        return page.locator('diffs-container').evaluate((node) => node.shadowRoot?.textContent || '')
      })
      .toContain('new line')
    await expect
      .poll(async () => {
        return page.locator('diffs-container').evaluate((node) => node.shadowRoot?.textContent || '')
      })
      .toContain('old line')

    await page.getByTestId('diff-file-row-src/features/diff/view.tsx').click()
    await expect(page.locator('diffs-container')).toHaveCount(0)
  })
})
