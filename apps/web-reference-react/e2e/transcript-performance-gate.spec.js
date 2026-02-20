import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

function recentIso() {
  return new Date(Date.now() - 30_000).toISOString()
}

function buildMessages(prefix, start, count) {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset
    return {
      id: `${prefix}-m-${index}`,
      kind: 'message',
      role: index % 2 === 0 ? 'assistant' : 'user',
      text: `${prefix}-msg-${index}`,
    }
  })
}

test.describe('transcript performance gate', () => {
  test('keeps long-transcript interactions under regression thresholds', async ({ page }) => {
    const updatedAt = recentIso()
    const latestMessages = [
      ...buildMessages('latest', 0, 200),
      {
        id: 'tool-1',
        kind: 'tool',
        toolUseId: 'tool-use-1',
        toolName: 'Bash',
        status: 'completed',
        summary: 'Ran command for 1.5s',
        paramsText: 'command="npm run type-check"',
        detailLines: ['> tsc --noEmit'],
      },
      ...buildMessages('latest', 200, 20),
    ]
    const earlierMessages = buildMessages('older', 0, 180)

    await installMockRpc(page, {
      threads: [
        {
          id: 'thread-perf-gate',
          cwd: '/tmp/formax-perf',
          createdAt: updatedAt,
          updatedAt,
          messageCount: latestMessages.length + earlierMessages.length,
          lastUserPrompt: 'perf baseline',
          label: 'Transcript Perf Gate',
        },
      ],
      threadMessages: {
        'thread-perf-gate': {
          __null__: {
            data: latestMessages,
            nextCursor: 'cursor-older',
          },
          'cursor-older': {
            data: earlierMessages,
            nextCursor: null,
          },
        },
      },
    })

    await page.goto('/')
    await page.getByRole('button', { name: /Transcript Perf Gate/i }).click()
    await expect(page.getByText('latest-msg-219')).toBeVisible()

    const input = page.getByPlaceholder('Ask for follow-up changes')
    const inputDuration = await page.evaluate(async () => {
      const inputElement = document.querySelector('textarea[placeholder="Ask for follow-up changes"]')
      if (!(inputElement instanceof HTMLTextAreaElement)) return Number.POSITIVE_INFINITY

      const start = performance.now()
      inputElement.value = 'perf gate input'
      inputElement.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      return performance.now() - start
    })
    await expect(input).toHaveValue('perf gate input')
    expect(inputDuration).toBeLessThan(1200)

    const toolRowButton = page.getByRole('button', { name: 'Bash npm run type-check' })
    await expect(toolRowButton).toBeVisible()
    const toggleDuration = await page.evaluate(async () => {
      const resolveToolRow = () =>
        Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Bash npm run type-check')
      const toolButton = resolveToolRow()
      if (!(toolButton instanceof HTMLButtonElement)) return Number.POSITIVE_INFINITY

      const start = performance.now()
      for (let index = 0; index < 40; index += 1) {
        toolButton.click()
      }
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      return performance.now() - start
    })
    expect(toggleDuration).toBeLessThan(4500)

    const loadEarlierButton = page.getByRole('button', { name: 'Load earlier messages' })
    await expect(loadEarlierButton).toBeVisible()
    const loadEarlierDuration = await page.evaluate(async () => {
      const resolveButton = () =>
        Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Load earlier messages')
      const button = resolveButton()
      if (!(button instanceof HTMLButtonElement)) return Number.POSITIVE_INFINITY

      const start = performance.now()
      button.click()
      const timeoutAt = start + 8000
      while (performance.now() < timeoutAt) {
        if (!resolveButton()) {
          return performance.now() - start
        }
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      }
      return Number.POSITIVE_INFINITY
    })
    await expect(loadEarlierButton).toBeHidden()
    expect(loadEarlierDuration).toBeLessThan(4500)
  })
})
