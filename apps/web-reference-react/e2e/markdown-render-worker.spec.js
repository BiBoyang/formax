import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

function recentIso() {
  return new Date(Date.now() - 45_000).toISOString()
}

function markdownScenario(threadId, label) {
  const updatedAt = recentIso()
  return {
    threads: [
      {
        id: threadId,
        cwd: '/tmp/formax-markdown',
        createdAt: updatedAt,
        updatedAt,
        messageCount: 1,
        lastUserPrompt: 'markdown sample',
        label,
      },
    ],
    threadMessages: {
      [threadId]: {
        __null__: {
          data: [
            {
              id: `${threadId}-m1`,
              kind: 'message',
              role: 'assistant',
              text: "```js\nconsole.log('markdown worker path')\n```",
            },
          ],
          nextCursor: null,
        },
      },
    },
  }
}

async function installClipboardCapture(page) {
  await page.evaluate(() => {
    window.__copiedCodeFromMarkdown = null
    const writeText = async (text) => {
      window.__copiedCodeFromMarkdown = String(text ?? '')
    }

    try {
      if (!navigator.clipboard) {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText },
        })
        return
      }
      navigator.clipboard.writeText = writeText
    } catch {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { ...(navigator.clipboard ?? {}), writeText },
      })
    }
  })
}

test.describe('markdown render worker path', () => {
  test('uses worker path and keeps copy-code behavior', async ({ page }) => {
    await page.addInitScript(() => {
      const NativeWorker = window.Worker
      window.__markdownWorkerConstructCount = 0
      if (typeof NativeWorker !== 'function') return

      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args)
          window.__markdownWorkerConstructCount += 1
        }
      }
    })

    await installMockRpc(page, markdownScenario('thread-markdown-worker', 'Thread Markdown Worker'))
    await page.goto('/')
    await page.getByRole('button', { name: /Thread Markdown Worker/i }).click()

    await expect(page.locator('[data-component="markdown-code"]')).toBeVisible()
    await expect(page.locator('[data-component="markdown-code"] .shiki')).toBeVisible()
    await expect(page.locator('[data-copy-code]').first()).toBeVisible()

    const workerCount = await page.evaluate(() => window.__markdownWorkerConstructCount ?? 0)
    expect(workerCount).toBeGreaterThan(0)

    await installClipboardCapture(page)
    await page.locator('[data-copy-code]').first().click()
    await expect(page.locator('[data-copy-code]').first()).toHaveText('Copied')

    const copied = await page.evaluate(() => window.__copiedCodeFromMarkdown)
    expect(copied).toContain("console.log('markdown worker path')")
  })

  test('falls back to main-thread rendering when worker errors', async ({ page }) => {
    await page.addInitScript(() => {
      window.__failingWorkerConstructCount = 0
      window.Worker = class {
        constructor() {
          this.onmessage = null
          this.onerror = null
          window.__failingWorkerConstructCount += 1
        }

        postMessage() {
          if (typeof this.onerror === 'function') {
            this.onerror(new Event('error'))
          }
        }

        terminate() {}
      }
    })

    await installMockRpc(page, markdownScenario('thread-markdown-fallback', 'Thread Markdown Fallback'))
    await page.goto('/')
    await page.getByRole('button', { name: /Thread Markdown Fallback/i }).click()

    await expect(page.locator('[data-component="markdown-code"]')).toBeVisible()
    await expect(page.locator('[data-component="markdown-code"] .shiki')).toBeVisible()
    await expect(page.locator('[data-copy-code]').first()).toBeVisible()

    const failingWorkerCount = await page.evaluate(() => window.__failingWorkerConstructCount ?? 0)
    expect(failingWorkerCount).toBeGreaterThan(0)

    await installClipboardCapture(page)
    await page.locator('[data-copy-code]').first().click()
    await expect(page.locator('[data-copy-code]').first()).toHaveText('Copied')

    const copied = await page.evaluate(() => window.__copiedCodeFromMarkdown)
    expect(copied).toContain("console.log('markdown worker path')")
  })
})
