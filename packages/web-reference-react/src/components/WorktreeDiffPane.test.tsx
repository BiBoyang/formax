import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider, type I18nProviderProps } from '../app/i18n/I18nProvider'
import { WorktreeDiffPane, type DiffFilePreviewPayload } from './WorktreeDiffPane'

const TEST_TIMEOUT_MS = 20_000

function renderPane(node: ReactElement, language: I18nProviderProps['language'] = 'en-US') {
  return render(<I18nProvider language={language}>{node}</I18nProvider>)
}

async function expectDiffShadowText(text: string) {
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  await waitFor(() => {
    expect(document.querySelector('[data-testid="diff-preview-loading"]')).toBeNull()
    expect(document.querySelector('diffs-container')?.shadowRoot?.textContent ?? '').toContain(text)
  }, { timeout: 10_000 })
}

async function findDiffShadowRoot() {
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  await waitFor(() => {
    expect(document.querySelector('[data-testid="diff-preview-loading"]')).toBeNull()
    expect(document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-diff]')).not.toBeNull()
  }, { timeout: 10_000 })
  const shadowRoot = document.querySelector('diffs-container')?.shadowRoot
  expect(shadowRoot).not.toBeNull()
  return shadowRoot
}

async function clickFileToggle(index = 0) {
  const toggle = screen.getAllByTestId('worktree-diff-file-toggle')[index]
  expect(toggle).not.toBeNull()
  await act(async () => {
    ;(toggle as HTMLElement).click()
  })
}

async function expectDiffRenderStyle(style: 'unified' | 'split') {
  const shadowRoot = await findDiffShadowRoot()
  const expectedDiffType = style === 'split' ? 'split' : 'single'
  await waitFor(() => {
    expect(shadowRoot?.querySelector(`[data-diff-type="${expectedDiffType}"]`)).not.toBeNull()
  }, { timeout: 10_000 })
}

function expectNoDiffShadowText(text: string) {
  expect(document.querySelector('diffs-container')?.shadowRoot?.textContent ?? '').not.toContain(text)
}

describe('WorktreeDiffPane', () => {
  it('renders latest request collapse summary when provided', () => {
    renderPane(
      <WorktreeDiffPane
        latestRequestCollapse={{
          phase: 'reactive_retry',
          collapsedHeadMessageCount: 5,
          estimatedTokensSaved: 320,
          recapFingerprint: 'recap-abcdef123456',
        }}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: false,
          truncated: false,
          files: [],
        }}
      />,
    )

    expect(screen.getByTestId('worktree-collapse-summary')).toHaveTextContent(
      'Latest request collapse',
    )
    expect(screen.getByTestId('worktree-collapse-summary')).toHaveTextContent(
      'Saved 320 tok · 5 older msgs · retry',
    )
    expect(screen.getByText('recap-abcdef')).toBeInTheDocument()
  }, TEST_TIMEOUT_MS)

  it('renders diff files and expands patch content', async () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'packages/web-reference-react/src/App.tsx',
              additions: 10,
              deletions: 2,
              patch: `diff --git a/packages/web-reference-react/src/App.tsx b/packages/web-reference-react/src/App.tsx
@@ -1 +1 @@
-old
+new`,
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Uncommitted worktree changes')).toBeInTheDocument()
    expect(screen.getByText('Changes: 1')).toBeInTheDocument()
    expect(screen.getAllByTestId('worktree-diff-file-card')).toHaveLength(1)
    expect(screen.getByText('packages/web-reference-react/src/App.tsx')).toBeInTheDocument()
    expect(document.querySelectorAll('diffs-container')).toHaveLength(0)
    await clickFileToggle()
    await expectDiffShadowText('new')
    expect(document.querySelectorAll('diffs-container')).toHaveLength(1)
  }, TEST_TIMEOUT_MS)

  it('uses Codex file icon tokens for common code and config files', () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            { path: 'src/App.tsx', additions: 1, deletions: 0 },
            { path: 'src/index.ts', additions: 1, deletions: 0 },
            { path: 'src/app.js', additions: 1, deletions: 0 },
            { path: 'vite.config.ts', additions: 1, deletions: 0 },
            { path: '.gitignore', additions: 1, deletions: 0 },
          ],
        }}
      />,
    )

    const iconTokenByPath = (path: string) => document
      .querySelector(`[data-review-path="${path}"] [data-file-icon-token]`)
      ?.getAttribute('data-file-icon-token')

    expect(iconTokenByPath('src/App.tsx')).toBe('react')
    expect(iconTokenByPath('src/index.ts')).toBe('typescript')
    expect(iconTokenByPath('src/app.js')).toBe('javascript')
    expect(iconTokenByPath('vite.config.ts')).toBe('vite')
    expect(iconTokenByPath('.gitignore')).toBe('git')
  }, TEST_TIMEOUT_MS)

  it('lazy-loads image previews per expanded file item', async () => {
    let resolvePreview: (value: DiffFilePreviewPayload) => void = () => undefined
    const onRequestPreview = vi.fn(
      () =>
        new Promise<DiffFilePreviewPayload>((resolve) => {
          resolvePreview = resolve
        }),
    )
    const onRequestPatch = vi.fn(async () => null)

    renderPane(
      <WorktreeDiffPane
        onRequestPatch={onRequestPatch}
        onRequestPreview={onRequestPreview}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            { path: 'images/a.webp', additions: 0, deletions: 0 },
            { path: 'src/a.ts', additions: 1, deletions: 0 },
          ],
        }}
      />,
    )

    expect(onRequestPreview).not.toHaveBeenCalled()
    expect(onRequestPatch).not.toHaveBeenCalled()

    await clickFileToggle(0)
    expect(screen.getByTestId('worktree-diff-image-preview-loading')).toHaveTextContent('Loading image preview...')
    expect(onRequestPreview).toHaveBeenCalledWith('images/a.webp')
    expect(onRequestPatch).not.toHaveBeenCalled()

    await act(async () => {
      resolvePreview({
        path: 'images/a.webp',
        found: true,
        preview: {
          kind: 'image',
          mimeType: 'image/webp',
          dataUrl: 'data:image/webp;base64,abc',
          sizeBytes: 1536,
        },
      })
    })

    const preview = await screen.findByTestId('worktree-diff-image-preview')
    expect(preview.querySelector('img')).toHaveAttribute('src', 'data:image/webp;base64,abc')
    expect(preview).toHaveTextContent('image/webp')
    expect(preview).toHaveTextContent('1.5 KB')

    await clickFileToggle(0)
    expect(screen.queryByTestId('worktree-diff-image-preview')).not.toBeInTheDocument()
    await clickFileToggle(0)
    expect(screen.getByTestId('worktree-diff-image-preview')).toBeInTheDocument()
    expect(onRequestPreview).toHaveBeenCalledTimes(1)
  }, TEST_TIMEOUT_MS)

  it('shows deleted image previews with a no-image marker', async () => {
    const onRequestPreview = vi.fn(async (): Promise<DiffFilePreviewPayload> => ({
      path: 'images/deleted.webp',
      found: true,
      preview: {
        kind: 'image',
        mimeType: 'image/webp',
        dataUrl: 'data:image/webp;base64,abc',
        sizeBytes: 1536,
        source: 'head',
        changeKind: 'deleted',
      },
    }))

    renderPane(
      <WorktreeDiffPane
        onRequestPreview={onRequestPreview}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{ path: 'images/deleted.webp', additions: 0, deletions: 0 }],
        }}
      />,
    )

    await clickFileToggle()
    const preview = await screen.findByTestId('worktree-diff-image-preview')
    expect(preview).toHaveAttribute('data-change-kind', 'deleted')
    expect(preview.querySelector('img')).toHaveAttribute('src', 'data:image/webp;base64,abc')
    expect(screen.getByTestId('worktree-diff-image-preview-deleted')).toHaveTextContent('No image')
  }, TEST_TIMEOUT_MS)

  it('shows an image preview error state when preview loading fails', async () => {
    const onRequestPreview = vi.fn()
    onRequestPreview.mockResolvedValueOnce({
      path: 'images/a.webp',
      found: false,
      preview: null,
      error: 'not_found',
    })
    onRequestPreview.mockResolvedValueOnce({
      path: 'images/a.webp',
      found: true,
      preview: {
        kind: 'image',
        mimeType: 'image/webp',
        dataUrl: 'data:image/webp;base64,retried',
        sizeBytes: 3,
      },
    })

    renderPane(
      <WorktreeDiffPane
        onRequestPreview={onRequestPreview}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{ path: 'images/a.webp', additions: 0, deletions: 0 }],
        }}
      />,
    )

    await clickFileToggle()
    const error = await screen.findByTestId('worktree-diff-image-preview-error')
    expect(error).toHaveAttribute('data-error', 'unavailable')
    expect(error).toHaveTextContent('Image preview unavailable')

    await clickFileToggle()
    expect(screen.queryByTestId('worktree-diff-image-preview-error')).not.toBeInTheDocument()
    await clickFileToggle()

    const preview = await screen.findByTestId('worktree-diff-image-preview')
    expect(preview.querySelector('img')).toHaveAttribute('src', 'data:image/webp;base64,retried')
    expect(onRequestPreview).toHaveBeenCalledTimes(2)
  }, TEST_TIMEOUT_MS)

  it('does not leave image rows loading forever when no preview handler exists', async () => {
    const onRequestPatch = vi.fn(async () => null)

    renderPane(
      <WorktreeDiffPane
        onRequestPatch={onRequestPatch}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{ path: 'images/a.webp', additions: 0, deletions: 0 }],
        }}
      />,
    )

    await clickFileToggle()
    await waitFor(() => {
      expect(onRequestPatch).toHaveBeenCalledWith('images/a.webp')
    })
    expect(screen.queryByTestId('worktree-diff-image-preview-loading')).not.toBeInTheDocument()
  }, TEST_TIMEOUT_MS)

  it('switches between unified and split diff rendering', async () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'src/view-mode.ts',
              additions: 1,
              deletions: 1,
              patch: `diff --git a/src/view-mode.ts b/src/view-mode.ts\n@@ -1 +1 @@\n-old\n+new`,
            },
          ],
        }}
      />,
    )

    const unifiedButton = screen.getByRole('button', { name: 'Unified' })
    const splitButton = screen.getByRole('button', { name: 'Split' })
    expect(unifiedButton).toHaveAttribute('aria-pressed', 'true')
    expect(splitButton).toHaveAttribute('aria-pressed', 'false')
    expect(document.querySelectorAll('diffs-container')).toHaveLength(0)
    await clickFileToggle()
    await expectDiffRenderStyle('unified')

    fireEvent.click(splitButton)
    expect(unifiedButton).toHaveAttribute('aria-pressed', 'false')
    expect(splitButton).toHaveAttribute('aria-pressed', 'true')
    await expectDiffRenderStyle('split')

    fireEvent.click(unifiedButton)
    expect(unifiedButton).toHaveAttribute('aria-pressed', 'true')
    expect(splitButton).toHaveAttribute('aria-pressed', 'false')
    await expectDiffRenderStyle('unified')
    expect(screen.getByTestId('worktree-diff-file-body')).toBeInTheDocument()
  }, TEST_TIMEOUT_MS)

  it('loads file patch when an unpatched summary row is expanded', async () => {
    const onRequestPatch = vi.fn(async () => ({
      path: 'src/lazy.ts',
      found: true,
      truncated: false,
      patch: `diff --git a/src/lazy.ts b/src/lazy.ts\n@@ -1 +1 @@\n-old\n+new`,
      additions: 1,
      deletions: 1,
    }))
    renderPane(
      <WorktreeDiffPane
        onRequestPatch={onRequestPatch}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'src/lazy.ts',
              additions: 1,
              deletions: 1,
            },
          ],
        }}
      />,
    )

    expect(screen.getAllByTestId('worktree-diff-file-card')).toHaveLength(1)
    expect(onRequestPatch).not.toHaveBeenCalled()
    await clickFileToggle()
    await waitFor(() => {
      expect(onRequestPatch).toHaveBeenCalledWith('src/lazy.ts')
    })
    await expectDiffShadowText('new')
    expect(onRequestPatch).toHaveBeenCalledTimes(1)
  }, TEST_TIMEOUT_MS)

  it('keeps expanded row visible when the renderer marks a patch unavailable', async () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'src/invalid.ts',
              additions: 1,
              deletions: 1,
              patch: 'not a git patch',
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('src/invalid.ts')).toBeInTheDocument()
    expect(document.querySelectorAll('diffs-container')).toHaveLength(0)
    await clickFileToggle()
    expect(await screen.findByTestId('diff-preview-unavailable')).toHaveAttribute('data-reason', 'invalid_patch')
    expect(screen.getByText('Diff preview unavailable')).toBeInTheDocument()
    const card = screen.getByTestId('worktree-diff-file-card')
    expect(card).toHaveTextContent('src/invalid.ts')
    expect(card).toHaveTextContent('+1')
    expect(card).toHaveTextContent('-1')
  }, TEST_TIMEOUT_MS)

  it('allows retrying a lazy patch after an unavailable response', async () => {
    const onRequestPatch = vi
      .fn<() => Promise<{ path: string; found: boolean; truncated: boolean; patch: string; additions: number; deletions: number } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        path: 'src/retry.ts',
        found: true,
        truncated: false,
        patch: `diff --git a/src/retry.ts b/src/retry.ts\n@@ -1 +1 @@\n-old\n+retried`,
        additions: 1,
        deletions: 1,
      })

    renderPane(
      <WorktreeDiffPane
        onRequestPatch={onRequestPatch}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{ path: 'src/retry.ts', additions: 0, deletions: 0 }],
        }}
      />,
    )

    await clickFileToggle()
    expect(await screen.findByText('Patch unavailable for this file')).toBeInTheDocument()
    expect(onRequestPatch).toHaveBeenCalledTimes(1)

    await clickFileToggle()
    expect(document.querySelectorAll('diffs-container')).toHaveLength(0)
    await clickFileToggle()
    await waitFor(() => {
      expect(onRequestPatch).toHaveBeenCalledTimes(2)
    })
    await expectDiffShadowText('retried')
  }, TEST_TIMEOUT_MS)

  it('does not double-toggle when the chevron button receives keyboard activation', async () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'src/keyboard.ts',
              additions: 1,
              deletions: 1,
              patch: `diff --git a/src/keyboard.ts b/src/keyboard.ts\n@@ -1 +1 @@\n-old\n+new`,
            },
          ],
        }}
      />,
    )

    const toggle = screen.getByTestId('worktree-diff-file-toggle')
    fireEvent.keyDown(toggle, { key: ' ', code: 'Space' })
    expect(document.querySelectorAll('diffs-container')).toHaveLength(0)
    fireEvent.click(toggle)
    await expectDiffShadowText('new')
    expect(document.querySelectorAll('diffs-container')).toHaveLength(1)
  }, TEST_TIMEOUT_MS)

  it('keeps the pending first-toggle when the same file is clicked again', async () => {
    class FakeWorker {
      addEventListener() {}
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)

    try {
      renderPane(
        <WorktreeDiffPane
          diffSnapshot={{
            cwd: '/repo',
            generatedAt: '2026-02-09T00:00:00.000Z',
            hasChanges: true,
            truncated: false,
            files: [
              {
                path: 'src/pending.ts',
                additions: 1,
                deletions: 1,
                patch: `diff --git a/src/pending.ts b/src/pending.ts\n@@ -1 +1 @@\n-old\n+new`,
              },
            ],
          }}
        />,
      )

      const toggle = screen.getByTestId('worktree-diff-file-toggle')
      fireEvent.click(toggle)
      expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'false')
      fireEvent.click(screen.getByTestId('worktree-diff-file-toggle'))
      expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'false')

      await act(async () => {
        await vi.dynamicImportSettled()
      })
      await waitFor(() => {
        expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')
      })
    } finally {
      vi.unstubAllGlobals()
    }
  }, TEST_TIMEOUT_MS)

  it('replaces pending first-toggle work when another file is clicked during worker warmup', async () => {
    class FakeWorker {
      addEventListener() {}
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)

    try {
      renderPane(
        <WorktreeDiffPane
          diffSnapshot={{
            cwd: '/repo',
            generatedAt: '2026-02-09T00:00:00.000Z',
            hasChanges: true,
            truncated: false,
            files: [
              {
                path: 'src/pending-a.ts',
                additions: 1,
                deletions: 1,
                patch: `diff --git a/src/pending-a.ts b/src/pending-a.ts\n@@ -1 +1 @@\n-old\n+new-a`,
              },
              {
                path: 'src/pending-b.ts',
                additions: 1,
                deletions: 1,
                patch: `diff --git a/src/pending-b.ts b/src/pending-b.ts\n@@ -1 +1 @@\n-old\n+new-b`,
              },
            ],
          }}
        />,
      )

      fireEvent.click(screen.getAllByTestId('worktree-diff-file-toggle')[0])
      fireEvent.click(screen.getAllByTestId('worktree-diff-file-toggle')[1])

      await act(async () => {
        await vi.dynamicImportSettled()
      })
      await waitFor(() => {
        expect(document.querySelector('[data-review-path="src/pending-a.ts"]')).toHaveAttribute('data-expanded', 'false')
        expect(document.querySelector('[data-review-path="src/pending-b.ts"]')).toHaveAttribute('data-expanded', 'true')
      })
    } finally {
      vi.unstubAllGlobals()
    }
  }, TEST_TIMEOUT_MS)

  it('starts lazy patch loading immediately during first worker warmup', async () => {
    class FakeWorker {
      addEventListener() {}
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)
    const onRequestPatch = vi.fn(async () => ({
      path: 'src/lazy-warmup.ts',
      found: true,
      truncated: false,
      patch: `diff --git a/src/lazy-warmup.ts b/src/lazy-warmup.ts\n@@ -1 +1 @@\n-old\n+new`,
      additions: 1,
      deletions: 1,
    }))

    try {
      renderPane(
        <WorktreeDiffPane
          onRequestPatch={onRequestPatch}
          diffSnapshot={{
            cwd: '/repo',
            generatedAt: '2026-02-09T00:00:00.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'src/lazy-warmup.ts', additions: 1, deletions: 1 }],
          }}
        />,
      )

      fireEvent.click(screen.getByTestId('worktree-diff-file-toggle'))
      expect(onRequestPatch).toHaveBeenCalledWith('src/lazy-warmup.ts')
      expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'false')

      await act(async () => {
        await vi.dynamicImportSettled()
      })
      await waitFor(() => {
        expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')
      })
    } finally {
      vi.unstubAllGlobals()
    }
  }, TEST_TIMEOUT_MS)

  it('opens the pending file without a worker provider when worker bootstrap fails', async () => {
    class FakeWorker {
      addEventListener() {}
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)
    vi.doMock('@pierre/diffs/react', () => {
      throw new Error('worker bootstrap failed')
    })

    try {
      renderPane(
        <WorktreeDiffPane
          diffSnapshot={{
            cwd: '/repo',
            generatedAt: '2026-02-09T00:00:00.000Z',
            hasChanges: true,
            truncated: false,
            files: [
              {
                path: 'src/bootstrap-fallback.ts',
                additions: 1,
                deletions: 1,
                patch: `diff --git a/src/bootstrap-fallback.ts b/src/bootstrap-fallback.ts\n@@ -1 +1 @@\n-old\n+new`,
              },
            ],
          }}
        />,
      )

      fireEvent.click(screen.getByTestId('worktree-diff-file-toggle'))
      expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'false')

      await act(async () => {
        await vi.dynamicImportSettled()
      })
      await waitFor(() => {
        expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')
      })
    } finally {
      vi.doUnmock('@pierre/diffs/react')
      vi.unstubAllGlobals()
    }
  }, TEST_TIMEOUT_MS)

  it('does not request a lazy patch twice when the first warmup request is unavailable', async () => {
    class FakeWorker {
      addEventListener() {}
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)
    const onRequestPatch = vi.fn(async () => null)

    try {
      renderPane(
        <WorktreeDiffPane
          onRequestPatch={onRequestPatch}
          diffSnapshot={{
            cwd: '/repo',
            generatedAt: '2026-02-09T00:00:00.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'src/lazy-unavailable.ts', additions: 1, deletions: 1 }],
          }}
        />,
      )

      fireEvent.click(screen.getByTestId('worktree-diff-file-toggle'))
      await act(async () => {
        await Promise.resolve()
      })
      expect(onRequestPatch).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.dynamicImportSettled()
      })
      await waitFor(() => {
        expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')
        expect(screen.getByText('Patch unavailable for this file')).toBeInTheDocument()
      })
      expect(onRequestPatch).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  }, TEST_TIMEOUT_MS)

  it('cancels pending first-toggle work when a new snapshot arrives', async () => {
    class FakeWorker {
      addEventListener() {}
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)

    const snapshot = (generatedAt: string) => ({
      cwd: '/repo',
      generatedAt,
      hasChanges: true,
      truncated: false,
      files: [
        {
          path: 'src/pending-refresh.ts',
          additions: 1,
          deletions: 1,
          patch: `diff --git a/src/pending-refresh.ts b/src/pending-refresh.ts\n@@ -1 +1 @@\n-old\n+new`,
        },
      ],
    })

    try {
      const { rerender } = renderPane(
        <WorktreeDiffPane diffSnapshot={snapshot('2026-02-09T00:00:00.000Z')} />,
      )

      fireEvent.click(screen.getByTestId('worktree-diff-file-toggle'))
      expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'false')

      rerender(
        <I18nProvider language="en-US">
          <WorktreeDiffPane diffSnapshot={snapshot('2026-02-09T00:00:01.000Z')} />
        </I18nProvider>,
      )

      await act(async () => {
        await vi.dynamicImportSettled()
      })
      expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'false')
    } finally {
      vi.unstubAllGlobals()
    }
  }, TEST_TIMEOUT_MS)

  it('only shows the untracked indicator for untracked files', () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            { path: 'src/tracked.ts', additions: 1, deletions: 0, patch: '' },
            { path: 'src/untracked.ts', additions: 1, deletions: 0, patch: '', untracked: true },
          ],
        }}
      />,
    )

    expect(screen.getAllByTestId('worktree-diff-file-card')).toHaveLength(2)
    expect(screen.getAllByTestId('worktree-diff-untracked-indicator')).toHaveLength(1)
  }, TEST_TIMEOUT_MS)

  it('updates +/- badges from loaded patch payload after lazy fetch', async () => {
    const onRequestPatch = vi.fn(async () => ({
      path: 'src/counts.ts',
      found: true,
      truncated: false,
      patch: `diff --git a/src/counts.ts b/src/counts.ts\n@@ -1 +1,3 @@\n-old\n+one\n+two\n+three`,
      additions: 3,
      deletions: 1,
    }))

    renderPane(
      <WorktreeDiffPane
        onRequestPatch={onRequestPatch}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{ path: 'src/counts.ts', additions: 0, deletions: 0 }],
        }}
      />,
    )

    expect(onRequestPatch).not.toHaveBeenCalled()
    await clickFileToggle()
    await waitFor(() => {
      expect(onRequestPatch).toHaveBeenCalledWith('src/counts.ts')
    })
    await expectDiffShadowText('three')

    await waitFor(() => {
      const cardText = screen.getByTestId('worktree-diff-file-card').textContent ?? ''
      expect(cardText).toContain('+3')
      expect(cardText).toContain('-1')
    })
  }, TEST_TIMEOUT_MS)

  it('preserves expansion after same-file snapshot refresh and requests the latest patch', async () => {
    const onRequestPatch = vi
      .fn<() => Promise<{ path: string; found: boolean; truncated: boolean; patch: string; additions: number; deletions: number }>>()
      .mockResolvedValueOnce({
        path: 'src/reload.ts',
        found: true,
        truncated: false,
        patch: `diff --git a/src/reload.ts b/src/reload.ts\n@@ -1 +1 @@\n-old\n+new-v1`,
        additions: 1,
        deletions: 1,
      })
      .mockResolvedValueOnce({
        path: 'src/reload.ts',
        found: true,
        truncated: false,
        patch: `diff --git a/src/reload.ts b/src/reload.ts\n@@ -1 +1 @@\n-old\n+new-v2`,
        additions: 1,
        deletions: 1,
      })

    const { rerender } = renderPane(
      <WorktreeDiffPane
        onRequestPatch={onRequestPatch}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'src/reload.ts',
              additions: 1,
              deletions: 1,
            },
          ],
        }}
      />,
    )

    expect(onRequestPatch).not.toHaveBeenCalled()
    await clickFileToggle()
    await waitFor(() => {
      expect(onRequestPatch).toHaveBeenCalledTimes(1)
    })
    await expectDiffShadowText('new-v1')

    rerender(
      <I18nProvider language="en-US">
        <WorktreeDiffPane
          onRequestPatch={onRequestPatch}
          diffSnapshot={{
            cwd: '/repo',
            generatedAt: '2026-02-09T00:00:01.000Z',
            hasChanges: true,
            truncated: false,
            files: [
              {
                path: 'src/reload.ts',
                additions: 1,
                deletions: 1,
              },
            ],
          }}
        />
      </I18nProvider>,
    )

    expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')
    await waitFor(() => {
      expect(onRequestPatch).toHaveBeenCalledTimes(2)
    })
    await expectDiffShadowText('new-v2')
    expect(screen.queryByText('Patch unavailable for this file')).not.toBeInTheDocument()
  }, TEST_TIMEOUT_MS)

  it('resets expanded files when the active thread changes in the same workspace', async () => {
    const snapshot = {
      cwd: '/repo',
      generatedAt: '2026-02-09T00:00:00.000Z',
      hasChanges: true,
      truncated: false,
      files: [
        {
          path: 'src/thread-scoped.ts',
          additions: 1,
          deletions: 1,
          patch: `diff --git a/src/thread-scoped.ts b/src/thread-scoped.ts\n@@ -1 +1 @@\n-old\n+new`,
        },
      ],
    }

    const { rerender } = renderPane(
      <WorktreeDiffPane activeThreadId="thread-a" diffSnapshot={snapshot} />,
    )

    await clickFileToggle()
    await expectDiffShadowText('new')
    expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')

    rerender(
      <I18nProvider language="en-US">
        <WorktreeDiffPane activeThreadId="thread-b" diffSnapshot={snapshot} />
      </I18nProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'false')
    })
    expect(document.querySelectorAll('diffs-container')).toHaveLength(0)
  }, TEST_TIMEOUT_MS)

  it('preserves expanded files that still exist when unrelated files enter or leave', async () => {
    const { rerender } = renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'src/kept.ts',
              additions: 1,
              deletions: 1,
              patch: `diff --git a/src/kept.ts b/src/kept.ts\n@@ -1 +1 @@\n-old\n+kept-v1`,
            },
            {
              path: 'src/leaving.ts',
              additions: 1,
              deletions: 0,
              patch: `diff --git a/src/leaving.ts b/src/leaving.ts\n@@ -0,0 +1 @@\n+leaving`,
            },
          ],
        }}
      />,
    )

    await clickFileToggle(0)
    await expectDiffShadowText('kept-v1')

    rerender(
      <I18nProvider language="en-US">
        <WorktreeDiffPane
          diffSnapshot={{
            cwd: '/repo',
            generatedAt: '2026-02-09T00:00:01.000Z',
            hasChanges: true,
            truncated: false,
            files: [
              {
                path: 'src/entering.ts',
                additions: 1,
                deletions: 0,
                patch: `diff --git a/src/entering.ts b/src/entering.ts\n@@ -0,0 +1 @@\n+entering`,
              },
              {
                path: 'src/kept.ts',
                additions: 1,
                deletions: 1,
                patch: `diff --git a/src/kept.ts b/src/kept.ts\n@@ -1 +1 @@\n-old\n+kept-v2`,
              },
            ],
          }}
        />
      </I18nProvider>,
    )

    expect(document.querySelector('[data-review-path="src/kept.ts"]')).toHaveAttribute('data-expanded', 'true')
    await expectDiffShadowText('kept-v2')
    expect(screen.queryByText('src/leaving.ts')).not.toBeInTheDocument()
  }, TEST_TIMEOUT_MS)

  it('does not auto-retry patch requests after an unavailable result', async () => {
    const onRequestPatch = vi.fn(async () => null)
    renderPane(
      <WorktreeDiffPane
        onRequestPatch={onRequestPatch}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'src/unavailable.ts',
              additions: 0,
              deletions: 0,
            },
          ],
        }}
      />,
    )

    await clickFileToggle()
    expect(await screen.findByText('Patch unavailable for this file')).toBeInTheDocument()

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(onRequestPatch).toHaveBeenCalledTimes(1)
  }, TEST_TIMEOUT_MS)

  it('re-translates persisted patch errors when the UI language changes', async () => {
    const onRequestPatch = vi.fn(async () => null)
    const snapshot = {
      cwd: '/repo',
      generatedAt: '2026-02-09T00:00:00.000Z',
      hasChanges: true,
      truncated: false,
      files: [
        {
          path: 'src/unavailable.ts',
          additions: 0,
          deletions: 0,
        },
      ],
    }

    const { rerender } = renderPane(
      <WorktreeDiffPane onRequestPatch={onRequestPatch} diffSnapshot={snapshot} />,
      'en-US',
    )

    await clickFileToggle()
    expect(await screen.findByText('Patch unavailable for this file')).toBeInTheDocument()
    expect(onRequestPatch).toHaveBeenCalledTimes(1)

    rerender(
      <I18nProvider language="zh-CN">
        <WorktreeDiffPane onRequestPatch={onRequestPatch} diffSnapshot={snapshot} />
      </I18nProvider>,
    )

    expect(await screen.findByText('当前文件无法提供补丁')).toBeInTheDocument()
    expect(screen.queryByText('Patch unavailable for this file')).not.toBeInTheDocument()
    expect(onRequestPatch).toHaveBeenCalledTimes(1)
  }, TEST_TIMEOUT_MS)

  it('ignores stale patch response after snapshot refresh and keeps latest patch', async () => {
    let resolveFirst: (value: any) => void = () => undefined
    let resolveSecond: (value: any) => void = () => undefined
    const firstPromise = new Promise<any>((resolve) => {
      resolveFirst = resolve
    })
    const secondPromise = new Promise<any>((resolve) => {
      resolveSecond = resolve
    })
    const onRequestPatch = vi.fn()
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise)

    const { rerender } = renderPane(
      <WorktreeDiffPane
        onRequestPatch={onRequestPatch}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{ path: 'src/race.ts', additions: 1, deletions: 1 }],
        }}
      />,
    )

    await clickFileToggle()
    await waitFor(() => {
      expect(onRequestPatch).toHaveBeenCalledTimes(1)
    })

    rerender(
      <I18nProvider language="en-US">
        <WorktreeDiffPane
          onRequestPatch={onRequestPatch}
          diffSnapshot={{
            cwd: '/repo',
            generatedAt: '2026-02-09T00:00:01.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'src/race.ts', additions: 2, deletions: 1 }],
          }}
        />
      </I18nProvider>,
    )

    expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')
    await waitFor(() => {
      expect(onRequestPatch).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      resolveFirst({
        path: 'src/race.ts',
        found: true,
        truncated: false,
        patch: `diff --git a/src/race.ts b/src/race.ts\n@@ -1 +1 @@\n-old\n+stale`,
        additions: 1,
        deletions: 1,
      })
      await vi.dynamicImportSettled()
    })
    expectNoDiffShadowText('stale')

    await act(async () => {
      resolveSecond({
        path: 'src/race.ts',
        found: true,
        truncated: false,
        patch: `diff --git a/src/race.ts b/src/race.ts\n@@ -1 +1 @@\n-old\n+fresh`,
        additions: 2,
        deletions: 1,
      })
      await vi.dynamicImportSettled()
    })
    await expectDiffShadowText('fresh')
    expectNoDiffShadowText('stale')
  }, TEST_TIMEOUT_MS)

  it('refreshes diff from header control', () => {
    const onRefreshDiff = vi.fn()
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: false,
          truncated: false,
          files: [],
        }}
        onRefreshDiff={onRefreshDiff}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh diff' }))
    expect(onRefreshDiff).toHaveBeenCalledTimes(1)
    expect(screen.getByText('No unstaged changes')).toBeInTheDocument()
    expect(screen.getByText('Code changes will appear here')).toBeInTheDocument()
  }, TEST_TIMEOUT_MS)

  it('renders long file paths through the outer file card header', async () => {
    const longPath = 'packages/web-reference-react/src/some/really/deeply/nested/folder/with/a/very/long/file/path/example.ts'
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{
            path: longPath,
            additions: 1,
            deletions: 0,
            patch: `diff --git a/${longPath} b/${longPath}\n@@ -0,0 +1 @@\n+new`,
          }],
        }}
      />,
    )

    expect(screen.getByText(longPath)).toBeInTheDocument()
    expect(document.querySelectorAll('diffs-container')).toHaveLength(0)
    await clickFileToggle()
    await expectDiffShadowText('new')
  }, TEST_TIMEOUT_MS)

  it('does not show clean-state message before diff snapshot is loaded', () => {
    renderPane(<WorktreeDiffPane diffSnapshot={null} />)
    expect(screen.queryByText('No unstaged changes')).not.toBeInTheDocument()
    expect(screen.queryByText('Code changes will appear here')).not.toBeInTheDocument()
  }, TEST_TIMEOUT_MS)

  it('shows budget message when snapshot is truncated and no files are available', () => {
    renderPane(
      <WorktreeDiffPane
        latestRequestCollapse={{
          phase: 'reactive_retry',
          collapsedHeadMessageCount: 5,
          estimatedTokensSaved: 320,
          recapFingerprint: 'recap-abcdef123456',
        }}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: true,
          files: [],
        }}
      />,
    )
    expect(screen.getByText('Large diff detected')).toBeInTheDocument()
    expect(screen.getByText('Preview unavailable for current diff budget')).toBeInTheDocument()
    expect(screen.getByTestId('worktree-collapse-summary')).toHaveTextContent('Latest request collapse')
  }, TEST_TIMEOUT_MS)

  it('shows large-change-set message when file count exceeds render limit', () => {
    renderPane(
      <WorktreeDiffPane
        latestRequestCollapse={{
          phase: 'reactive_retry',
          collapsedHeadMessageCount: 5,
          estimatedTokensSaved: 320,
          recapFingerprint: 'recap-abcdef123456',
        }}
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: Array.from({ length: 121 }, (_, index) => ({
            path: `src/file-${index}.ts`,
            additions: 1,
            deletions: 0,
            patch: '',
          })),
        }}
      />,
    )
    expect(screen.getByText('Change set too large to preview')).toBeInTheDocument()
    expect(screen.queryByTestId('worktree-diff-file-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('worktree-collapse-summary')).toHaveTextContent('Latest request collapse')
  }, TEST_TIMEOUT_MS)

  it('shows partial preview banner and keeps renderable files when diff is truncated', async () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: true,
          files: [
            {
              path: 'src/partial.ts',
              additions: 5,
              deletions: 1,
              patch: `diff --git a/src/partial.ts b/src/partial.ts\n@@ -1 +1 @@\n-old\n+new`,
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Large diff detected - showing partial preview.')).toBeInTheDocument()
    expect(screen.getByText('src/partial.ts')).toBeInTheDocument()
    expect(document.querySelectorAll('diffs-container')).toHaveLength(0)
    await clickFileToggle()
    await expectDiffShadowText('new')
    expect(screen.queryByText('Change set too large to preview')).not.toBeInTheDocument()
  }, TEST_TIMEOUT_MS)

  it('renders zh-CN diff status copy through i18n messages', () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: false,
          truncated: false,
          files: [],
        }}
      />,
      'zh-CN',
    )

    expect(screen.getByText('未提交的工作树变更')).toBeInTheDocument()
    expect(screen.getByText('变更数：0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '统一' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '分栏' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('没有未暂存的变更')).toBeInTheDocument()
  }, TEST_TIMEOUT_MS)
})
