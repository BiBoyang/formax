import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../app/i18n/I18nProvider'
import {
  DIFF_RENDER_MAX_LINES,
  DiffPatchView,
  type DiffPreviewUnavailableReason,
} from './DiffPatchView'

function renderDiff(patch: string, props: Partial<Parameters<typeof DiffPatchView>[0]> = {}) {
  return render(
    <I18nProvider language="en-US">
      <DiffPatchView path="src/example.ts" patch={patch} additions={2} deletions={1} {...props} />
    </I18nProvider>,
  )
}

function getUnavailable(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[data-testid="diff-preview-unavailable"]')
}

async function findDiffShadowText(container: HTMLElement) {
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  await waitFor(() => {
    expect(container.querySelector('[data-testid="diff-preview-loading"]')).toBeNull()
    expect(container.querySelector('diffs-container')?.shadowRoot?.textContent ?? '').not.toBe('')
  }, { timeout: 10_000 })
  return container.querySelector('diffs-container')?.shadowRoot?.textContent ?? ''
}

async function findDiffShadowRoot(container: HTMLElement) {
  await findDiffShadowText(container)
  const shadowRoot = container.querySelector('diffs-container')?.shadowRoot
  expect(shadowRoot).not.toBeNull()
  return shadowRoot
}

async function expectUnavailable(container: HTMLElement, reason: DiffPreviewUnavailableReason) {
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  await waitFor(() => {
    expect(container.querySelector('[data-testid="diff-preview-loading"]')).toBeNull()
    const unavailable = getUnavailable(container)
    expect(unavailable).not.toBeNull()
    expect(unavailable?.dataset.reason).toBe(reason)
    expect(unavailable).toHaveTextContent('Diff preview unavailable')
    expect(unavailable).toHaveTextContent('src/example.ts')
    expect(unavailable).toHaveTextContent('+2')
    expect(unavailable).toHaveTextContent('-1')
  }, { timeout: 10_000 })
}

describe('DiffPatchView', () => {
  it('enables vertical scrolling when max height is constrained', async () => {
    const patch = [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -0,0 +1,3 @@',
      '+one',
      '+two',
      '+three',
    ].join('\n')

    const { container } = renderDiff(patch, { maxHeightClassName: 'max-h-[40px]' })
    await findDiffShadowText(container)
    const scroller = container.querySelector('[data-testid="pierre-diff-view"]')
    expect(scroller).not.toBeNull()
    expect(scroller?.className).toContain('max-h-[40px]')
    expect(scroller?.className).toContain('overflow-x-hidden')
    expect(scroller?.className).toContain('overflow-y-auto')
  })

  it('keeps the file header visible by default for standalone previews', async () => {
    const patch = [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')

    const { container } = renderDiff(patch)
    const shadowText = await findDiffShadowText(container)
    expect(shadowText).toContain('src/example.ts')
  })

  it('delegates horizontal scrolling to the diff code area', async () => {
    const patch = [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')

    const { container } = renderDiff(patch)
    const shadowRoot = await findDiffShadowRoot(container)
    await waitFor(() => {
      expect(shadowRoot?.querySelector('[data-overflow="scroll"]')).not.toBeNull()
    }, { timeout: 10_000 })
  })

  it('renders a modified file patch with additions and deletions', async () => {
    const patch = [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')

    const { container } = renderDiff(patch)
    const shadowText = await findDiffShadowText(container)
    expect(shadowText).toContain('old')
    expect(shadowText).toContain('new')
  })

  it('renders markdown patches with the plain-text language override', async () => {
    const patch = [
      'diff --git a/CODEMAP.md b/CODEMAP.md',
      '--- a/CODEMAP.md',
      '+++ b/CODEMAP.md',
      '@@ -1 +1 @@',
      '-old docs',
      '+new docs',
    ].join('\n')

    const { container } = renderDiff(patch, { path: 'CODEMAP.md' })
    const shadowText = await findDiffShadowText(container)
    expect(shadowText).toContain('old docs')
    expect(shadowText).toContain('new docs')
  })

  it('renders an added file patch', async () => {
    const patch = [
      'diff --git a/dev/null b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1 @@',
      '+created',
    ].join('\n')

    const { container } = renderDiff(patch)
    const shadowText = await findDiffShadowText(container)
    expect(shadowText).toContain('created')
  })

  it('renders a deleted file patch', async () => {
    const patch = [
      'diff --git a/src/old.ts b/src/old.ts',
      'deleted file mode 100644',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-removed',
    ].join('\n')

    const { container } = renderDiff(patch)
    const shadowText = await findDiffShadowText(container)
    expect(shadowText).toContain('removed')
  })

  it('shows unsupported state for a pure rename patch without hunks', async () => {
    const patch = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 100%',
      'rename from src/old.ts',
      'rename to src/new.ts',
    ].join('\n')

    const { container } = renderDiff(patch)
    await expectUnavailable(container, 'unsupported_patch')
  })

  it('shows binary state for binary patches', async () => {
    const patch = [
      'diff --git a/src/image.png b/src/image.png',
      'Binary files a/src/image.png and b/src/image.png differ',
    ].join('\n')

    const { container } = renderDiff(patch)
    await expectUnavailable(container, 'binary_patch')
  })

  it('shows empty state for empty patches', async () => {
    const { container } = renderDiff('   \n')
    await expectUnavailable(container, 'empty_patch')
  })

  it('shows invalid state for malformed patches', async () => {
    const { container } = renderDiff('@@\nnot a git patch')
    await expectUnavailable(container, 'invalid_patch')
  })

  it('shows truncated state for truncated patch payloads and markers', async () => {
    const patch = [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')

    const { container, rerender } = render(
      <I18nProvider language="en-US">
        <DiffPatchView path="src/example.ts" patch={patch} truncated additions={2} deletions={1} />
      </I18nProvider>,
    )
    await expectUnavailable(container, 'truncated_patch')

    rerender(
      <I18nProvider language="en-US">
        <DiffPatchView
          path="src/example.ts"
          patch={`${patch}\n... [file patch truncated]`}
          additions={2}
          deletions={1}
        />
      </I18nProvider>,
    )
    await expectUnavailable(container, 'truncated_patch')
  })

  it('shows large state for patches over the line threshold', async () => {
    const patch = [
      'diff --git a/src/large.ts b/src/large.ts',
      '--- a/src/large.ts',
      '+++ b/src/large.ts',
      `@@ -0,0 +1,${DIFF_RENDER_MAX_LINES + 1} @@`,
      ...Array.from({ length: DIFF_RENDER_MAX_LINES + 1 }, (_, index) => `+line-${index}`),
    ].join('\n')

    const { container } = renderDiff(patch)
    await expectUnavailable(container, 'large_patch')
  })

  it('updates rendered output when the patch prop changes', async () => {
    const firstPatch = [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1 +1 @@',
      '-old',
      '+first',
    ].join('\n')
    const secondPatch = [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1 +1 @@',
      '-old',
      '+second',
    ].join('\n')

    const { container, rerender } = renderDiff(firstPatch)
    expect(await findDiffShadowText(container)).toContain('first')

    rerender(
      <I18nProvider language="en-US">
        <DiffPatchView path="src/example.ts" patch={secondPatch} additions={1} deletions={1} />
      </I18nProvider>,
    )

    await act(async () => {
      await vi.dynamicImportSettled()
    })
    await waitFor(() => {
      expect(container.querySelector('[data-testid="diff-preview-loading"]')).toBeNull()
      const shadowText = container.querySelector('diffs-container')?.shadowRoot?.textContent ?? ''
      expect(shadowText).toContain('second')
      expect(shadowText).not.toContain('first')
    }, { timeout: 10_000 })
  })

  it('keeps the diff element mounted when switching unified and split modes', async () => {
    const patch = [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')

    const { container, rerender } = renderDiff(patch, { diffStyle: 'unified' })
    await findDiffShadowText(container)
    const initialDiffElement = container.querySelector('diffs-container')
    expect(initialDiffElement).not.toBeNull()

    rerender(
      <I18nProvider language="en-US">
        <DiffPatchView path="src/example.ts" patch={patch} additions={1} deletions={1} diffStyle="split" />
      </I18nProvider>,
    )

    await waitFor(() => {
      expect(container.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-diff-type="split"]')).not.toBeNull()
    }, { timeout: 10_000 })
    expect(container.querySelector('diffs-container')).toBe(initialDiffElement)
  })
})
