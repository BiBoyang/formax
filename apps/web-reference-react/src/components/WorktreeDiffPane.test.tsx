import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorktreeDiffPane } from './WorktreeDiffPane'

describe('WorktreeDiffPane', () => {
  it('renders diff files and expands patch content', () => {
    render(
      <WorktreeDiffPane
        diffSnapshot={{
          cwd: '/repo',
          generatedAt: '2026-02-09T00:00:00.000Z',
          hasChanges: true,
          truncated: false,
          files: [
            {
              path: 'apps/web-reference-react/src/App.tsx',
              additions: 10,
              deletions: 2,
              patch: `diff --git a/apps/web-reference-react/src/App.tsx b/apps/web-reference-react/src/App.tsx
@@ -1 +1 @@
-old
+new`,
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Uncommitted worktree changes')).toBeInTheDocument()
    const fileRow = screen.getByTestId('diff-file-row-apps/web-reference-react/src/App.tsx')
    expect(fileRow.className).toContain('sticky')
    expect(fileRow.className).toContain('top-0')
    fireEvent.click(screen.getByRole('button', { name: /apps\/web-reference-react\/src\/App\.tsx/i }))
    expect(screen.getByText('new')).toBeInTheDocument()
  })

  it('refreshes diff from header control', () => {
    const onRefreshDiff = vi.fn()
    render(
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
    const longPath = 'apps/web-reference-react/src/some/really/deeply/nested/folder/with/a/very/long/file/path/example.ts'
    render(
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
    render(<WorktreeDiffPane diffSnapshot={null} />)
    expect(screen.queryByText('No unstaged changes')).not.toBeInTheDocument()
    expect(screen.queryByText('Code changes will appear here')).not.toBeInTheDocument()
  })

  it('does not show clean-state message when snapshot reports changes but files are empty', () => {
    render(
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
    expect(screen.getByText('Change set too large to preview')).toBeInTheDocument()
    expect(screen.getByText('Refine the scope to inspect file diffs here')).toBeInTheDocument()
  })

  it('shows large-change-set message when file count exceeds render limit', () => {
    render(
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
})
