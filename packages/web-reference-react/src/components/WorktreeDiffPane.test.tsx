import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider, type I18nProviderProps } from '../app/i18n/I18nProvider'
import { WorktreeDiffPane } from './WorktreeDiffPane'

function renderPane(node: ReactElement, language: I18nProviderProps['language'] = 'en-US') {
  return render(<I18nProvider language={language}>{node}</I18nProvider>)
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
  })

  it('renders diff files and expands patch content', () => {
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
    const fileRow = screen.getByTestId('diff-file-row-packages/web-reference-react/src/App.tsx')
    expect(fileRow.className).not.toContain('sticky')
    expect(fileRow.className).not.toContain('top-0')
    fireEvent.click(fileRow)
    expect(screen.getByText('new')).toBeInTheDocument()
  })

  it('loads file patch on demand when summary row has no patch body', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /src\/lazy\.ts/i }))
    expect(await screen.findByText('new')).toBeInTheDocument()
    expect(onRequestPatch).toHaveBeenCalledWith('src/lazy.ts')
  })

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

    const row = screen.getByTestId('diff-file-row-src/counts.ts')
    expect(within(row).getByText('+0')).toBeInTheDocument()
    expect(within(row).getByText('-0')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /src\/counts\.ts/i }))
    expect(await screen.findByText('three')).toBeInTheDocument()

    await waitFor(() => {
      expect(within(row).getByText('+3')).toBeInTheDocument()
      expect(within(row).getByText('-1')).toBeInTheDocument()
    })
  })

  it('re-requests patch for expanded rows after snapshot refresh', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /src\/reload\.ts/i }))
    expect(await screen.findByText('new-v1')).toBeInTheDocument()

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

    await waitFor(() => {
      expect(onRequestPatch).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText('new-v2')).toBeInTheDocument()
    expect(screen.queryByText('Patch unavailable for this file')).not.toBeInTheDocument()
  })

  it('does not auto-retry patch requests after an unavailable result until user retries', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /src\/unavailable\.ts/i }))
    expect(await screen.findByText('Patch unavailable for this file')).toBeInTheDocument()

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(onRequestPatch).toHaveBeenCalledTimes(1)
  })

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

    fireEvent.click(screen.getByRole('button', { name: /src\/unavailable\.ts/i }))
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
  })

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

    fireEvent.click(screen.getByRole('button', { name: /src\/race\.ts/i }))
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

    await waitFor(() => {
      expect(onRequestPatch).toHaveBeenCalledTimes(2)
    })

    resolveFirst({
      path: 'src/race.ts',
      found: true,
      truncated: false,
      patch: `diff --git a/src/race.ts b/src/race.ts\n@@ -1 +1 @@\n-old\n+stale`,
      additions: 1,
      deletions: 1,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText('stale')).not.toBeInTheDocument()

    resolveSecond({
      path: 'src/race.ts',
      found: true,
      truncated: false,
      patch: `diff --git a/src/race.ts b/src/race.ts\n@@ -1 +1 @@\n-old\n+fresh`,
      additions: 2,
      deletions: 1,
    })
    expect(await screen.findByText('fresh')).toBeInTheDocument()
    expect(screen.queryByText('stale')).not.toBeInTheDocument()
  })

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
  })

  it('left-truncates long file path but keeps full path as title', () => {
    const longPath = 'packages/web-reference-react/src/some/really/deeply/nested/folder/with/a/very/long/file/path/example.ts'
    renderPane(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [{ path: longPath, additions: 1, deletions: 0, patch: '' }],
        }}
      />,
    )

    const row = screen.getByTestId(`diff-file-row-${longPath}`)
    const pathLabel = row.querySelector('span[title]') as HTMLSpanElement | null
    expect(pathLabel).not.toBeNull()
    expect(pathLabel?.title).toBe(longPath)
    expect(pathLabel?.textContent?.startsWith('…')).toBe(true)
  })

  it('does not show clean-state message before diff snapshot is loaded', () => {
    renderPane(<WorktreeDiffPane diffSnapshot={null} />)
    expect(screen.queryByText('No unstaged changes')).not.toBeInTheDocument()
    expect(screen.queryByText('Code changes will appear here')).not.toBeInTheDocument()
  })

  it('shows budget message when snapshot is truncated and no files are available', () => {
    renderPane(
      <WorktreeDiffPane
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
  })

  it('shows large-change-set message when file count exceeds render limit', () => {
    renderPane(
      <WorktreeDiffPane
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
    expect(screen.queryByTestId('diff-file-row-src/file-0.ts')).not.toBeInTheDocument()
  })

  it('shows partial preview banner and keeps renderable files when diff is truncated', () => {
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
    expect(screen.getByTestId('diff-file-row-src/partial.ts')).toBeInTheDocument()
    expect(screen.queryByText('Change set too large to preview')).not.toBeInTheDocument()
  })

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
    expect(screen.getByText('没有未暂存的变更')).toBeInTheDocument()
  })
})
