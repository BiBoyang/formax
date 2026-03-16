import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

test.describe('add project action', () => {
  test('shows desktop-only tooltip in browser mode', async ({ page }) => {
    await installMockRpc(page, {
      threads: [],
    })

    await page.goto('/')

    const addProjectButton = page.getByRole('button', { name: 'Add project' })
    await expect(addProjectButton).toBeVisible()

    await addProjectButton.hover()
    await expect(page.getByRole('tooltip')).toContainText('仅桌面客户端可用')
  })
})
