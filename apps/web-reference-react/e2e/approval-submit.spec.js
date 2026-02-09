import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString()
}

test.describe('approval flow', () => {
  test('submits approval decision and shows submit status', async ({ page }) => {
    const updatedAt = nowIso(-60_000)
    await installMockRpc(page, {
      threads: [
        {
          id: 'thread-approval',
          cwd: '/tmp/formax',
          createdAt: updatedAt,
          updatedAt,
          messageCount: 0,
          lastUserPrompt: null,
          label: 'Thread Approval',
        },
      ],
      notificationsOnInitialized: [
        {
          method: 'turn/inputRequested',
          params: {
            input: {
              inputId: 'input-1',
              threadId: 'thread-approval',
              turnId: 'turn-approval-1',
              toolUseId: 'tool-approval-1',
              kind: 'approval',
              status: 'pending',
              createdAt: nowIso(),
              expiresAt: nowIso(5 * 60_000),
              payload: {
                toolName: 'Exec',
                action: { command: 'ls -la' },
              },
            },
          },
        },
      ],
      submitResult: { status: 'submitted' },
    })

    await page.goto('/')
    await expect(page.getByText('Approval Required')).toBeVisible()

    await page.getByRole('button', { name: 'Submit Decision' }).click()
    await expect(page.getByText('submitted')).toBeVisible()

    const submissions = await page.evaluate(() => window.__mockRpcState?.submissions || [])
    expect(submissions).toHaveLength(1)
    expect(submissions[0].answers).toEqual({ decision: 'approve' })
  })
})
