import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider, type I18nProviderProps } from '../app/i18n/I18nProvider'
import { WorktreeDiffPane } from './WorktreeDiffPane'
import type { DiffFilePreviewPayload } from './diff/diffTypes'

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
    const shadowText = Array.from(document.querySelectorAll('diffs-container'))
      .map((node) => node.shadowRoot?.textContent ?? '')
      .join('\n')
    expect(shadowText).toContain(text)
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

function openDropdown(button: HTMLElement) {
  button.focus()
  fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' })
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

    expect(screen.getByText('Unstaged')).toBeInTheDocument()
    expect(screen.getByText('Changes: 1')).toBeInTheDocument()
    expect(screen.getAllByTestId('worktree-diff-file-card')).toHaveLength(1)
    expect(screen.getByText('packages/web-reference-react/src/App.tsx')).toBeInTheDocument()
    expect(document.querySelectorAll('diffs-container')).toHaveLength(0)
    await clickFileToggle()
    await expectDiffShadowText('new')
    expect(document.querySelectorAll('diffs-container')).toHaveLength(1)
  }, TEST_TIMEOUT_MS)

  it('expands patch content when clicking the file item header', async () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'src/header-click.ts',
              additions: 1,
              deletions: 1,
              patch: `diff --git a/src/header-click.ts b/src/header-click.ts
@@ -1 +1 @@
-old
+new-header-click`,
            },
          ],
        }}
      />,
    )

    fireEvent.click(screen.getByText('src/header-click.ts'))
    expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')
    await expectDiffShadowText('new-header-click')
  }, TEST_TIMEOUT_MS)

  it('expands file headers in desktop mode without enabling the diff worker pool', async () => {
    const desktopWindow = window as unknown as { formaxDesktop?: unknown }
    const originalDesktopBridge = desktopWindow.formaxDesktop
    desktopWindow.formaxDesktop = {}
    const onRequestPatch = vi.fn(async () => ({
      path: 'src/electron-header.ts',
      found: true,
      truncated: false,
      additions: 1,
      deletions: 1,
      patch: `diff --git a/src/electron-header.ts b/src/electron-header.ts
@@ -1 +1 @@
-old
+new-electron-header`,
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
            files: [
              {
                path: 'src/electron-header.ts',
                additions: 1,
                deletions: 1,
              },
            ],
          }}
        />,
      )

      fireEvent.click(screen.getByText('src/electron-header.ts'))
      expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')
      await waitFor(() => {
        expect(onRequestPatch).toHaveBeenCalledWith('src/electron-header.ts', { kind: 'unstaged' })
      })
      await expectDiffShadowText('new-electron-header')
    } finally {
      if (originalDesktopBridge === undefined) {
        delete desktopWindow.formaxDesktop
      } else {
        desktopWindow.formaxDesktop = originalDesktopBridge
      }
    }
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
    expect(onRequestPreview).toHaveBeenCalledWith('images/a.webp', { kind: 'unstaged' })
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
      expect(onRequestPatch).toHaveBeenCalledWith('images/a.webp', { kind: 'unstaged' })
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

    const viewModeButton = screen.getByRole('button', { name: 'Switch to split diff view' })
    expect(viewModeButton).toHaveAttribute('aria-pressed', 'false')
    expect(document.querySelectorAll('diffs-container')).toHaveLength(0)
    await clickFileToggle()
    await expectDiffRenderStyle('unified')

    fireEvent.click(viewModeButton)
    expect(screen.getByRole('button', { name: 'Switch to unified diff view' })).toHaveAttribute('aria-pressed', 'true')
    await expectDiffRenderStyle('split')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to unified diff view' }))
    expect(screen.getByRole('button', { name: 'Switch to split diff view' })).toHaveAttribute('aria-pressed', 'false')
    await expectDiffRenderStyle('unified')
    expect(screen.getByTestId('worktree-diff-file-body')).toBeInTheDocument()
  }, TEST_TIMEOUT_MS)

  it('expands and collapses all files from the review toolbar', async () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'src/a.ts',
              additions: 1,
              deletions: 1,
              patch: `diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new-a`,
            },
            {
              path: 'src/b.ts',
              additions: 1,
              deletions: 1,
              patch: `diff --git a/src/b.ts b/src/b.ts\n@@ -1 +1 @@\n-old\n+new-b`,
            },
          ],
        }}
      />,
    )

    expect(screen.getAllByTestId('worktree-diff-file-card').map((card) => card.getAttribute('data-expanded'))).toEqual(['false', 'false'])

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getAllByTestId('worktree-diff-file-card').map((card) => card.getAttribute('data-expanded'))).toEqual(['true', 'true'])

    await clickFileToggle(0)
    expect(screen.getAllByTestId('worktree-diff-file-card').map((card) => card.getAttribute('data-expanded'))).toEqual(['false', 'true'])

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getAllByTestId('worktree-diff-file-card').map((card) => card.getAttribute('data-expanded'))).toEqual(['true', 'true'])

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.getAllByTestId('worktree-diff-file-card').map((card) => card.getAttribute('data-expanded'))).toEqual(['false', 'false'])
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
      expect(onRequestPatch).toHaveBeenCalledWith('src/lazy.ts', { kind: 'unstaged' })
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

  it('toggles a file immediately on repeated clicks', async () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'src/toggle.ts',
              additions: 1,
              deletions: 1,
              patch: `diff --git a/src/toggle.ts b/src/toggle.ts\n@@ -1 +1 @@\n-old\n+new`,
            },
          ],
        }}
      />,
    )

    const toggle = screen.getByTestId('worktree-diff-file-toggle')
    fireEvent.click(toggle)
    expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')
    fireEvent.click(screen.getByTestId('worktree-diff-file-toggle'))
    expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'false')
  }, TEST_TIMEOUT_MS)

  it('opens each clicked file immediately', async () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'src/open-a.ts',
              additions: 1,
              deletions: 1,
              patch: `diff --git a/src/open-a.ts b/src/open-a.ts\n@@ -1 +1 @@\n-old\n+new-a`,
            },
            {
              path: 'src/open-b.ts',
              additions: 1,
              deletions: 1,
              patch: `diff --git a/src/open-b.ts b/src/open-b.ts\n@@ -1 +1 @@\n-old\n+new-b`,
            },
          ],
        }}
      />,
    )

    await clickFileToggle(0)
    expect(document.querySelector('[data-review-path="src/open-a.ts"]')).toHaveAttribute('data-expanded', 'true')
    await expectDiffShadowText('new-a')
    await clickFileToggle(1)
    expect(document.querySelector('[data-review-path="src/open-a.ts"]')).toHaveAttribute('data-expanded', 'true')
    expect(document.querySelector('[data-review-path="src/open-b.ts"]')).toHaveAttribute('data-expanded', 'true')
    await expectDiffShadowText('new-b')
  }, TEST_TIMEOUT_MS)

  it('starts lazy patch loading immediately when a file opens', async () => {
    const onRequestPatch = vi.fn(async () => ({
      path: 'src/lazy-open.ts',
      found: true,
      truncated: false,
      patch: `diff --git a/src/lazy-open.ts b/src/lazy-open.ts\n@@ -1 +1 @@\n-old\n+new`,
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
          files: [{ path: 'src/lazy-open.ts', additions: 1, deletions: 1 }],
        }}
      />,
    )

    await clickFileToggle()
    await waitFor(() => {
      expect(onRequestPatch).toHaveBeenCalledWith('src/lazy-open.ts', { kind: 'unstaged' })
    })
    expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')
    expect(screen.getByTestId('worktree-diff-file-body')).toBeInTheDocument()
    await expectDiffShadowText('new')
  }, TEST_TIMEOUT_MS)

  it('does not request a lazy patch twice when the first request is unavailable', async () => {
    const onRequestPatch = vi.fn(async () => null)

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
  }, TEST_TIMEOUT_MS)

  it('preserves opened file state when a refreshed snapshot keeps the same file', async () => {
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

    const { rerender } = renderPane(
      <WorktreeDiffPane diffSnapshot={snapshot('2026-02-09T00:00:00.000Z')} />,
    )

    await clickFileToggle()
    expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')
    await expectDiffShadowText('new')

    rerender(
      <I18nProvider language="en-US">
        <WorktreeDiffPane diffSnapshot={snapshot('2026-02-09T00:00:01.000Z')} />
      </I18nProvider>,
    )

    expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')
    await expectDiffShadowText('new')
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
      expect(onRequestPatch).toHaveBeenCalledWith('src/counts.ts', { kind: 'unstaged' })
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

  it('resets expanded files when switching between commit review sources', async () => {
    const shaA = 'aaaaaaaaaaaaaaa'
    const shaB = 'bbbbbbbbbbbbbbb'
    const { rerender } = renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          source: { kind: 'commit', sha: shaA },
          sourceKey: `git:commit:${shaA}`,
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'src/shared.ts',
              additions: 1,
              deletions: 1,
              patch: `diff --git a/src/shared.ts b/src/shared.ts\n@@ -1 +1 @@\n-old-a\n+new-a`,
            },
          ],
        }}
      />,
    )

    await clickFileToggle()
    await expectDiffShadowText('new-a')
    expect(screen.getByTestId('worktree-diff-file-card')).toHaveAttribute('data-expanded', 'true')

    rerender(
      <I18nProvider language="en-US">
        <WorktreeDiffPane
          diffSnapshot={{
            cwd: '/repo',
            source: { kind: 'commit', sha: shaB },
            sourceKey: `git:commit:${shaB}`,
            generatedAt: '2026-02-09T00:00:01.000Z',
            hasChanges: true,
            truncated: false,
            files: [
              {
                path: 'src/shared.ts',
                additions: 1,
                deletions: 1,
                patch: `diff --git a/src/shared.ts b/src/shared.ts\n@@ -1 +1 @@\n-old-b\n+new-b`,
              },
            ],
          }}
        />
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

  it('switches between unstaged and staged review sources', async () => {
    const onRefreshDiff = vi.fn()
    const view = renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          source: { kind: 'unstaged' },
          sourceKey: 'git:unstaged',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            { path: 'src/example.ts', additions: 1, deletions: 0 },
            { path: 'src/unstaged-only.ts', additions: 1, deletions: 0 },
          ],
        }}
        onRefreshDiff={onRefreshDiff}
      />,
    )

    openDropdown(screen.getByRole('button', { name: /Unstaged/ }))

    expect(screen.getAllByText('Unstaged').length).toBeGreaterThanOrEqual(2)
    fireEvent.click(await screen.findByText('Staged'))
    expect(onRefreshDiff).toHaveBeenCalledWith({ kind: 'staged' })
    expect(screen.getByRole('button', { name: /Staged/ }).textContent).not.toContain('2')

    view.rerender(
      <I18nProvider language="en-US">
        <WorktreeDiffPane
          diffSnapshot={{
            cwd: '/repo',
            source: { kind: 'staged' },
            sourceKey: 'git:staged',
            generatedAt: '2026-02-09T00:00:01.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'src/staged-only.ts', additions: 1, deletions: 0 }],
          }}
          onRefreshDiff={onRefreshDiff}
        />
      </I18nProvider>,
    )
    expect(screen.getByRole('button', { name: /Staged/ }).textContent).toContain('1')

    openDropdown(screen.getByRole('button', { name: /Staged/ }))
    expect(screen.getByText('Commit').closest('[data-slot="dropdown-menu-sub-trigger"]')).not.toHaveAttribute('data-disabled')
    expect(screen.getByText('Branch').closest('[data-slot="dropdown-menu-item"]')).toHaveAttribute('data-disabled')
    expect(screen.getByText('Previous conversation').closest('[data-slot="dropdown-menu-item"]')).toHaveAttribute('data-disabled')
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })

    view.rerender(
      <I18nProvider language="en-US">
        <WorktreeDiffPane
          diffSnapshot={{
            cwd: '/repo-other',
            source: { kind: 'unstaged' },
            sourceKey: 'git:unstaged',
            generatedAt: '2026-02-09T00:00:02.000Z',
            hasChanges: false,
            truncated: false,
            files: [],
          }}
          onRefreshDiff={onRefreshDiff}
        />
      </I18nProvider>,
    )
    openDropdown(screen.getByRole('button', { name: /Unstaged/ }))
    expect(screen.getByText('Staged').closest('[data-slot="dropdown-menu-item"]')?.textContent).not.toContain('1')
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })

    openDropdown(screen.getByRole('button', { name: 'More review options' }))
    fireEvent.click(await screen.findByText('Refresh diff'))
    expect(onRefreshDiff).toHaveBeenLastCalledWith({ kind: 'unstaged' })
  }, TEST_TIMEOUT_MS)

  it('loads recent commits from the commit source submenu and selects a commit source', async () => {
    const sha = '0123456789abcdef'
    const onRefreshDiff = vi.fn()
    const onListCommits = vi.fn(async () => [
      {
        sha,
        shortSha: '0123456',
        subject: 'feat(web): add source-aware git review controls',
        committedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
        committedAtUnixSeconds: Math.floor((Date.now() - 25 * 60_000) / 1000),
      },
    ])
    const view = renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          source: { kind: 'unstaged' },
          sourceKey: 'git:unstaged',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{ path: 'src/example.ts', additions: 1, deletions: 0 }],
        }}
        onRefreshDiff={onRefreshDiff}
        onListCommits={onListCommits}
      />,
    )

    openDropdown(screen.getByRole('button', { name: /Unstaged/ }))
    const commitTrigger = screen.getByText('Commit').closest('[data-slot="dropdown-menu-sub-trigger"]') as HTMLElement
    fireEvent.pointerEnter(commitTrigger)
    fireEvent.pointerMove(commitTrigger)

    const commitRow = await screen.findByText('feat(web): add source-aware git review controls')
    expect(onListCommits).toHaveBeenCalledTimes(1)
    fireEvent.click(commitRow)
    expect(onRefreshDiff).toHaveBeenCalledWith({ kind: 'commit', sha })

    view.rerender(
      <I18nProvider language="en-US">
        <WorktreeDiffPane
          diffSnapshot={{
            cwd: '/repo',
            source: { kind: 'commit', sha },
            sourceKey: `git:commit:${sha}`,
            generatedAt: '2026-02-09T00:00:01.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'src/commit.ts', additions: 1246, deletions: 654 }],
          }}
          onRefreshDiff={onRefreshDiff}
          onListCommits={onListCommits}
        />
      </I18nProvider>,
    )

    expect(screen.getByRole('button', { name: /Commit/ })).toBeInTheDocument()
    expect(screen.getByText('feat(web): add source-aware git review controls')).toBeInTheDocument()
    expect(screen.getAllByText('+1246').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-654').length).toBeGreaterThan(0)

    openDropdown(screen.getByRole('button', { name: /Commit/ }))
    const reopenedCommitTrigger = screen
      .getAllByText('Commit')
      .map((node) => node.closest('[data-slot="dropdown-menu-sub-trigger"]'))
      .find(Boolean) as HTMLElement
    fireEvent.pointerEnter(reopenedCommitTrigger)
    fireEvent.pointerMove(reopenedCommitTrigger)
    await screen.findAllByText('feat(web): add source-aware git review controls')
    const selectedRow = screen
      .getAllByText('feat(web): add source-aware git review controls')
      .map((node) => node.closest('[data-slot="dropdown-menu-item"]'))
      .find(Boolean)
    expect(selectedRow?.querySelector('svg')).not.toBeNull()
    expect(onListCommits).toHaveBeenCalledTimes(1)
  }, TEST_TIMEOUT_MS)

  it('reloads commit menu entries when the diff cwd scope changes', async () => {
    const onListCommits = vi
      .fn()
      .mockResolvedValueOnce([
        {
          sha: 'repo-a-sha',
          shortSha: 'repo-a',
          subject: 'feat(repo-a): old commit',
          committedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
          committedAtUnixSeconds: Math.floor((Date.now() - 10 * 60_000) / 1000),
        },
      ])
      .mockResolvedValueOnce([
        {
          sha: 'repo-b-sha',
          shortSha: 'repo-b',
          subject: 'feat(repo-b): current commit',
          committedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          committedAtUnixSeconds: Math.floor((Date.now() - 5 * 60_000) / 1000),
        },
      ])

    const view = renderPane(
      <WorktreeDiffPane
        activeThreadId="thread-a"
        diffSnapshot={{
          cwd: '/repo-a',
          source: { kind: 'unstaged' },
          sourceKey: 'git:unstaged',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
        }}
        onListCommits={onListCommits}
      />,
    )

    openDropdown(screen.getByRole('button', { name: /Unstaged/ }))
    const repoACommitTrigger = screen.getByText('Commit').closest('[data-slot="dropdown-menu-sub-trigger"]') as HTMLElement
    fireEvent.pointerEnter(repoACommitTrigger)
    fireEvent.pointerMove(repoACommitTrigger)
    expect(await screen.findByText('feat(repo-a): old commit')).toBeInTheDocument()
    expect(onListCommits).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })

    view.rerender(
      <I18nProvider language="en-US">
        <WorktreeDiffPane
          activeThreadId="thread-b"
          diffSnapshot={{
            cwd: '/repo-b',
            source: { kind: 'unstaged' },
            sourceKey: 'git:unstaged',
            generatedAt: '2026-02-09T00:00:01.000Z',
            hasChanges: true,
            truncated: false,
            files: [{ path: 'src/b.ts', additions: 1, deletions: 0 }],
          }}
          onListCommits={onListCommits}
        />
      </I18nProvider>,
    )

    openDropdown(screen.getByRole('button', { name: /Unstaged/ }))
    const repoBCommitTrigger = screen.getByText('Commit').closest('[data-slot="dropdown-menu-sub-trigger"]') as HTMLElement
    fireEvent.pointerEnter(repoBCommitTrigger)
    fireEvent.pointerMove(repoBCommitTrigger)

    expect(await screen.findByText('feat(repo-b): current commit')).toBeInTheDocument()
    expect(screen.queryByText('feat(repo-a): old commit')).not.toBeInTheDocument()
    expect(onListCommits).toHaveBeenCalledTimes(2)
  }, TEST_TIMEOUT_MS)

  it('opens review more menu with refresh active and future options disabled', async () => {
    const onRefreshDiff = vi.fn()
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{ path: 'src/example.ts', additions: 1, deletions: 0 }],
        }}
        onRefreshDiff={onRefreshDiff}
      />,
    )

    openDropdown(screen.getByRole('button', { name: 'More review options' }))
    fireEvent.click(await screen.findByText('Refresh diff'))

    expect(onRefreshDiff).toHaveBeenCalledTimes(1)
    expect(onRefreshDiff).toHaveBeenCalledWith({ kind: 'unstaged' })

    openDropdown(screen.getByRole('button', { name: 'More review options' }))

    const wordWrapItem = await screen.findByRole('menuitemcheckbox', { name: 'Enable word wrap' })
    expect(wordWrapItem).toHaveAttribute('aria-checked', 'false')
    expect(wordWrapItem).not.toHaveAttribute('data-disabled')
    expect(screen.getByText('Do not load full file').closest('[data-slot="dropdown-menu-item"]')).toHaveAttribute('data-disabled')
    expect(screen.getByText('Enable rich text preview').closest('[data-slot="dropdown-menu-item"]')).toHaveAttribute('data-disabled')
    expect(screen.getByText('Enable word diff').closest('[data-slot="dropdown-menu-item"]')).toHaveAttribute('data-disabled')
    expect(screen.getByText('Hide whitespace').closest('[data-slot="dropdown-menu-item"]')).toHaveAttribute('data-disabled')
    expect(screen.getByText('Copy git apply command').closest('[data-slot="dropdown-menu-item"]')).toHaveAttribute('data-disabled')
  }, TEST_TIMEOUT_MS)

  it('disables menu refresh when refresh is unavailable', async () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{ path: 'src/example.ts', additions: 1, deletions: 0 }],
        }}
      />,
    )

    openDropdown(screen.getByRole('button', { name: 'More review options' }))

    expect((await screen.findByText('Refresh diff')).closest('[data-slot="dropdown-menu-item"]')).toHaveAttribute('data-disabled')
  }, TEST_TIMEOUT_MS)

  it('toggles word wrap as a local review display option', async () => {
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{
            path: 'src/example.ts',
            additions: 1,
            deletions: 0,
            patch: `diff --git a/src/example.ts b/src/example.ts\n@@ -0,0 +1 @@\n+${'long '.repeat(40)}`,
          }],
        }}
      />,
    )

    await clickFileToggle()
    await findDiffShadowRoot()
    expect(screen.getByTestId('pierre-diff-view')).toHaveAttribute('data-word-wrap', 'false')

    openDropdown(screen.getByRole('button', { name: 'More review options' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Enable word wrap' }))

    await waitFor(() => {
      expect(screen.getByTestId('pierre-diff-view')).toHaveAttribute('data-word-wrap', 'true')
    })
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

    expect(screen.getByText('未暂存')).toBeInTheDocument()
    expect(screen.getByText('变更数：0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '切换到分栏差异视图' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('没有未暂存的变更')).toBeInTheDocument()
  }, TEST_TIMEOUT_MS)
})
