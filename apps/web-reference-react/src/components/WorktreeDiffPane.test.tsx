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
  })
})
