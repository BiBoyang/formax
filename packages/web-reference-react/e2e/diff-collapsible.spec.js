import { expect, test } from '@playwright/test'
import { installMockRpc } from './helpers/mockRpc'

function recentIso() {
  return new Date(Date.now() - 60_000).toISOString()
}

function createSmallPatch(path, index) {
  return {
    path,
    additions: index + 1,
    deletions: 1,
    patch: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1,1 +1,1 @@',
      `-old ${index}`,
      `+new ${index}`,
    ].join('\n'),
  }
}

async function getShadowText(locator) {
  return locator.evaluate((node) => node.shadowRoot?.textContent || '')
}

test.describe('diff collapsible', () => {
  test('renders Codex-style file cards and mounts one PatchDiff per expanded file', async ({ page }) => {
    const updatedAt = recentIso()
    const longNewLine = `new line ${'x'.repeat(240)}`
    const fillerLines = Array.from({ length: 80 }, (_, index) => `+filler line ${index}`)
    const extraFiles = Array.from({ length: 23 }, (_, index) => (
      createSmallPatch(`src/features/diff/file-${String(index + 2).padStart(2, '0')}.ts`, index + 2)
    ))
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
              '@@ -1,1 +1,81 @@',
              '-old line',
              `+${longNewLine}`,
              ...fillerLines,
            ].join('\n'),
          },
          ...extraFiles,
        ],
      },
    })

    await page.goto('/')
    await page.getByText('Thread Diff').click()
    await expect(page.getByText('src/features/diff/view.tsx')).toBeVisible()

    const cards = page.getByTestId('worktree-diff-file-card')
    const toggles = page.getByTestId('worktree-diff-file-toggle')
    await expect(cards).toHaveCount(24)
    await expect(toggles).toHaveCount(24)
    await expect(page.locator('diffs-container')).toHaveCount(0)

    await toggles.nth(0).click()
    await expect(page.locator('diffs-container')).toHaveCount(1)
    const firstDiff = page.locator('diffs-container').nth(0)
    await expect.poll(() => getShadowText(firstDiff)).toContain('new line')
    await expect.poll(() => getShadowText(firstDiff)).toContain('old line')

    const scrollMetrics = await firstDiff.evaluate((node) => {
      const root = node.shadowRoot
      const code = root?.querySelector('[data-code]')
      const gutter = root?.querySelector('[data-gutter]')
      if (!(code instanceof HTMLElement) || !(gutter instanceof HTMLElement)) {
        return null
      }

      const gutterLeftBefore = gutter.getBoundingClientRect().left
      code.scrollLeft = 160
      const gutterLeftAfter = gutter.getBoundingClientRect().left
      return {
        clientWidth: code.clientWidth,
        gutterLeftBefore,
        gutterLeftAfter,
        scrollLeft: code.scrollLeft,
        scrollWidth: code.scrollWidth,
      }
    })
    expect(scrollMetrics).not.toBeNull()
    expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth)
    expect(scrollMetrics.scrollLeft).toBeGreaterThan(0)
    expect(Math.abs(scrollMetrics.gutterLeftAfter - scrollMetrics.gutterLeftBefore)).toBeLessThan(1)

    const stickyMetrics = await page.getByTestId('worktree-diff-card-list').evaluate(async (node) => {
      const card = node.querySelector('[data-testid="worktree-diff-file-card"]')
      const header = card?.querySelector('[role="button"]')
      if (!(card instanceof HTMLElement) || !(header instanceof HTMLElement)) return null
      node.scrollTop = 140
      await new Promise((resolve) => requestAnimationFrame(resolve))
      return {
        cardBottom: card.getBoundingClientRect().bottom,
        headerTop: header.getBoundingClientRect().top,
        listTop: node.getBoundingClientRect().top,
        scrollTop: node.scrollTop,
      }
    })
    expect(stickyMetrics).not.toBeNull()
    expect(stickyMetrics.scrollTop).toBeGreaterThan(0)
    expect(stickyMetrics.headerTop).toBeGreaterThanOrEqual(stickyMetrics.listTop - 1)
    expect(stickyMetrics.headerTop).toBeLessThan(stickyMetrics.cardBottom)

    await toggles.nth(1).click()
    await expect(page.locator('diffs-container')).toHaveCount(2)
    await expect.poll(() => getShadowText(page.locator('diffs-container').nth(1))).toContain('new 2')
    await expect(cards).toHaveCount(24)
    await expect(toggles).toHaveCount(24)

    await toggles.nth(0).click()
    await expect(page.locator('diffs-container')).toHaveCount(1)
    await expect(cards).toHaveCount(24)
    await expect(toggles).toHaveCount(24)
    await expect.poll(() => getShadowText(page.locator('diffs-container').nth(0))).toContain('new 2')

    const visualDriftAfterVisibleToggle = await page.getByTestId('worktree-diff-card-list').evaluate(async (node) => {
      const viewportRect = node.getBoundingClientRect()
      const visibleToggle = Array.from(node.querySelectorAll('[data-testid="worktree-diff-file-toggle"]')).find((element) => {
        if (!(element instanceof HTMLElement)) return false
        const rect = element.getBoundingClientRect()
        return rect.top >= viewportRect.top && rect.bottom <= viewportRect.bottom
      })
      if (!(visibleToggle instanceof HTMLElement)) return Number.POSITIVE_INFINITY
      const beforeToggleTop = visibleToggle.getBoundingClientRect().top
      visibleToggle.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const afterToggleTop = visibleToggle.getBoundingClientRect().top
      return Math.abs(afterToggleTop - beforeToggleTop)
    })
    expect(visualDriftAfterVisibleToggle).toBeLessThan(1)
    await expect(cards).toHaveCount(24)

    const splitButton = page.getByRole('button', { name: /Split|分栏/ })
    await splitButton.click()
    await expect(splitButton).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('diffs-container')).toHaveCount(2)
    await expect
      .poll(async () => {
        return page.locator('diffs-container').nth(0).evaluate((node) => (
          node.shadowRoot?.querySelector('[data-diff-type="split"]') != null
        ))
      })
      .toBe(true)

    const splitGutterPositions = await page.locator('diffs-container').nth(0).evaluate((node) => {
      const root = node.shadowRoot
      return Array.from(root?.querySelectorAll('[data-diff-type="split"] [data-gutter]') ?? []).map((gutter) => (
        window.getComputedStyle(gutter).position
      ))
    })
    expect(splitGutterPositions.length).toBeGreaterThan(1)
    expect(splitGutterPositions).not.toContain('sticky')
  })
})
