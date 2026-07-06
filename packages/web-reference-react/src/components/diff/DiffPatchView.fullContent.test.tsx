import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../app/i18n/I18nProvider'
import { DiffPatchView } from './DiffPatchView'

const parsePatchFiles = vi.fn(() => [
  {
    files: [
      {
        name: 'src/example.ts',
        type: 'change',
        isPartial: true,
        hunks: [
          {
            collapsedBefore: 0,
            splitLineStart: 0,
            splitLineCount: 2,
            unifiedLineStart: 0,
            unifiedLineCount: 2,
            additionStart: 2,
            additionCount: 2,
            additionLines: 1,
            additionLineIndex: 0,
            deletionStart: 2,
            deletionCount: 1,
            deletionLines: 0,
            deletionLineIndex: 0,
            hunkContent: [
              {
                type: 'context',
                lines: 1,
                additionLineIndex: 0,
                deletionLineIndex: 0,
              },
              {
                type: 'change',
                additions: 1,
                deletions: 0,
                additionLineIndex: 1,
                deletionLineIndex: 1,
              },
            ],
            noEOFCRAdditions: false,
            noEOFCRDeletions: false,
          },
        ],
        deletionLines: ['old\n'],
        additionLines: ['old\n', 'new\n'],
        splitLineCount: 3,
        unifiedLineCount: 3,
      },
    ],
  },
])

vi.mock('@pierre/diffs', () => ({
  parsePatchFiles,
  setLanguageOverride: (file: unknown) => file,
}))

vi.mock('@pierre/diffs/react', () => ({
  FileDiff: (props: {
    fileDiff: {
      isPartial: boolean
      deletionLines: string[]
      additionLines: string[]
      hunks: Array<{ collapsedBefore: number; additionLineIndex: number; deletionLineIndex: number }>
    }
    options: { hunkSeparators?: string; expansionLineCount?: number }
  }) => (
    <div
      data-testid="mock-file-diff"
      data-is-partial={String(props.fileDiff.isPartial)}
      data-deletion-lines={String(props.fileDiff.deletionLines.length)}
      data-addition-lines={String(props.fileDiff.additionLines.length)}
      data-collapsed-before={String(props.fileDiff.hunks[0]?.collapsedBefore)}
      data-addition-line-index={String(props.fileDiff.hunks[0]?.additionLineIndex)}
      data-deletion-line-index={String(props.fileDiff.hunks[0]?.deletionLineIndex)}
      data-hunk-separators={props.options.hunkSeparators}
      data-expansion-line-count={String(props.options.expansionLineCount)}
    />
  ),
}))

function renderDiff(fullContent?: { before: string; after: string }) {
  return render(
    <I18nProvider language="en-US">
      <DiffPatchView
        path="src/example.ts"
        patch={'diff --git a/src/example.ts b/src/example.ts\n@@ -1 +1 @@\n-old\n+new'}
        additions={1}
        deletions={1}
        fullContent={fullContent}
      />
    </I18nProvider>,
  )
}

describe('DiffPatchView full-content mode', () => {
  it('builds full-file metadata from the parsed patch without recomputing the diff', async () => {
    renderDiff({ before: 'intro\nold\n', after: 'intro\nold\nnew\n' })

    await waitFor(() => {
      expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-is-partial', 'false')
    })
    expect(parsePatchFiles).toHaveBeenCalled()
    expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-hunk-separators', 'line-info')
    expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-deletion-lines', '2')
    expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-addition-lines', '3')
    expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-collapsed-before', '1')
    expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-addition-line-index', '1')
    expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-deletion-line-index', '1')
    expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-expansion-line-count', '20')
  })

  it('keeps patch parsing and compact separators without full content', async () => {
    renderDiff()

    await waitFor(() => {
      expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-is-partial', 'true')
    })
    expect(parsePatchFiles).toHaveBeenCalled()
    expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-hunk-separators', 'line-info-basic')
  })

  it('keeps partial metadata when full content cannot be reconciled with the patch', async () => {
    renderDiff({ before: 'different\n', after: 'different\nnew\n' })

    await waitFor(() => {
      expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-is-partial', 'true')
    })
    expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-hunk-separators', 'line-info-basic')
  })

  it('keeps patch-only rendering when full content exceeds the render budget', async () => {
    const trailingContext = 'tail\n'.repeat(4_001)

    renderDiff({
      before: `intro\nold\n${trailingContext}`,
      after: `intro\nold\nnew\n${trailingContext}`,
    })

    await waitFor(() => {
      expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-is-partial', 'true')
    })
    expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-hunk-separators', 'line-info-basic')
    expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-deletion-lines', '1')
    expect(screen.getByTestId('mock-file-diff')).toHaveAttribute('data-addition-lines', '2')
  })
})
