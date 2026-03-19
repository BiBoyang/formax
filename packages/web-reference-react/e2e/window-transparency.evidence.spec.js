import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

function nowStamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function evidencePath(label) {
  const fileName = `${label}-${nowStamp()}.png`
  return path.join(process.cwd(), 'evidence', 'window-transparency', fileName)
}

test('captures window transparency before and after toggle', async ({ page }) => {
  await page.addInitScript(() => {
    /** @type {Set<(state: { revision: number, windowTransparencyEnabled: boolean }) => void>} */
    const listeners = new Set()
    /** @type {{ revision: number, windowTransparencyEnabled: boolean }} */
    let state = { revision: 1, windowTransparencyEnabled: true }

    const publish = () => {
      for (const listener of listeners) listener(state)
    }

    // @ts-expect-error - injected desktop bridge for browser e2e only.
    window.formaxDesktop = {
      mode: 'dev',
      startUrl: 'http://127.0.0.1:3781',
      pickProjectFolder: async () => null,
      windowControls: {
        close: async () => true,
        minimize: async () => true,
        toggleMaximize: async () => true,
      },
      windowAppearance: {
        getState: async () => state,
        setWindowTransparency: async (enabled) => {
          state = {
            revision: state.revision + 1,
            windowTransparencyEnabled: enabled === true,
          }
          publish()
          return state
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    }
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Toggle window transparency' })).toBeVisible()

  await expect(page.locator('[data-testid="app-shell"]')).toHaveAttribute('data-window-transparency', 'on')

  const beforePath = evidencePath('before')
  mkdirSync(path.dirname(beforePath), { recursive: true })
  await page.screenshot({ path: beforePath, fullPage: true })

  await page.getByRole('button', { name: 'Toggle window transparency' }).click()
  await expect(page.locator('[data-testid="app-shell"]')).toHaveAttribute('data-window-transparency', 'off')

  const afterOffPath = evidencePath('after-off')
  mkdirSync(path.dirname(afterOffPath), { recursive: true })
  await page.screenshot({ path: afterOffPath, fullPage: true })

  await page.getByRole('button', { name: 'Toggle window transparency' }).click()
  await expect(page.locator('[data-testid="app-shell"]')).toHaveAttribute('data-window-transparency', 'on')

  const afterOnPath = evidencePath('after-on')
  mkdirSync(path.dirname(afterOnPath), { recursive: true })
  await page.screenshot({ path: afterOnPath, fullPage: true })

  console.log(`Window transparency screenshots: ${beforePath}`)
  console.log(`Window transparency screenshots: ${afterOffPath}`)
  console.log(`Window transparency screenshots: ${afterOnPath}`)
})
