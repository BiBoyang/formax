import { expect, test } from '@playwright/test'

async function measureOverflow(page) {
  return page.evaluate(() => {
    const element = (id) => document.querySelector(`[data-testid="${id}"]`)
    const metrics = (id) => {
      const node = element(id)
      if (!node) return null
      return {
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      }
    }

    return {
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
      appShell: metrics('app-shell'),
      centerPane: metrics('center-pane'),
      rightRail: metrics('right-rail'),
    }
  })
}

function expectNoHorizontalOverflow(name, value) {
  expect(value, `${name} should exist`).toBeTruthy()
  expect(value.scrollWidth, `${name} should not overflow horizontally`).toBeLessThanOrEqual(
    value.clientWidth + 1,
  )
}

test.describe('layout overflow guard', () => {
  test('default viewport keeps all panes within width', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.getByTestId('composer')).toBeVisible()

    const result = await measureOverflow(page)
    expect(result.document.scrollWidth).toBeLessThanOrEqual(result.document.clientWidth + 1)
    expectNoHorizontalOverflow('app shell', result.appShell)
    expectNoHorizontalOverflow('center pane', result.centerPane)
    expectNoHorizontalOverflow('right rail', result.rightRail)
  })

  test('compact laptop viewport still keeps composer visible and no x-overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 })
    await page.goto('/')
    await expect(page.getByTestId('composer')).toBeVisible()
    await expect(page.getByPlaceholder('Ask for follow-up changes')).toBeVisible()

    const result = await measureOverflow(page)
    expect(result.document.scrollWidth).toBeLessThanOrEqual(result.document.clientWidth + 1)
    expectNoHorizontalOverflow('center pane', result.centerPane)
  })
})
