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
    const inputPerf = await page.evaluate(async () => {
      const inputElement = document.querySelector('textarea[placeholder="Ask for follow-up changes"]')
      if (!(inputElement instanceof HTMLTextAreaElement)) {
        return { samples: [Number.POSITIVE_INFINITY], median: Number.POSITIVE_INFINITY, finalValue: '' }
      }

      const median = (values) => {
        const sorted = [...values].sort((left, right) => left - right)
        return sorted[Math.floor(sorted.length / 2)]
      }

      // Warm-up one render cycle to stabilize measurements.
      inputElement.value = ''
      inputElement.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

      const samples = []
      let finalValue = ''
      for (let index = 0; index < 3; index += 1) {
        const value = `perf gate input ${index}`
        const start = performance.now()
        inputElement.value = value
        inputElement.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
        samples.push(performance.now() - start)
        finalValue = value
      }

      return { samples, median: median(samples), finalValue }
    })
    await expect(input).toHaveValue(inputPerf.finalValue)
    expect(inputPerf.median).toBeLessThan(1200)

    const toolRowButton = page.getByRole('button', { name: /^Bash$/ })
    await expect(toolRowButton).toBeVisible()
    const togglePerf = await page.evaluate(async () => {
      const resolveToolRow = () =>
        Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Bash')
      const toolButton = resolveToolRow()
      if (!(toolButton instanceof HTMLButtonElement)) {
        return { samples: [Number.POSITIVE_INFINITY], median: Number.POSITIVE_INFINITY }
      }

      const median = (values) => {
        const sorted = [...values].sort((left, right) => left - right)
        return sorted[Math.floor(sorted.length / 2)]
      }

      // Warm-up one quick open/close cycle for stable median sampling.
      toolButton.click()
      toolButton.click()
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

      const samples = []
      for (let sample = 0; sample < 3; sample += 1) {
        const start = performance.now()
        for (let index = 0; index < 40; index += 1) {
          toolButton.click()
        }
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
        samples.push(performance.now() - start)
      }

      return { samples, median: median(samples) }
    })
    expect(togglePerf.median).toBeLessThan(4500)

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
