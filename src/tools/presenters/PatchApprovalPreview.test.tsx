import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import path from 'node:path'
import { render } from 'ink-testing-library'
import * as snippetLineHook from '../../components/tool/useSnippetStartLineNumber'
import { PatchApprovalPreview } from '../../components/tool/PatchApprovalPreview'

const mocks = vi.hoisted(() => ({
  columns: 100 as number | undefined,
}))

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>()
  return {
    ...actual,
    useStdout: () => ({ stdout: { columns: mocks.columns } }),
  }
})

describe('PatchApprovalPreview', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.columns = 100
  })

  it('resolves relative paths and uses fallback width when stdout columns are unavailable', () => {
    mocks.columns = undefined
    const snippetSpy = vi.spyOn(snippetLineHook, 'useSnippetStartLineNumber').mockReturnValue(7)

    const { lastFrame } = render(
      <PatchApprovalPreview filePath="src/demo.ts" oldText="old" newText="new" />,
    )

    expect(snippetSpy).toHaveBeenCalledWith({
      filePath: path.resolve(process.cwd(), 'src/demo.ts'),
      snippet: 'old',
    })
    expect(lastFrame() || '').toContain('╌'.repeat(20))
  })

  it('passes empty file paths to snippet lookup as empty string', () => {
    const snippetSpy = vi.spyOn(snippetLineHook, 'useSnippetStartLineNumber').mockReturnValue(1)
    render(<PatchApprovalPreview filePath="" oldText="old" newText="new" />)

    expect(snippetSpy).toHaveBeenCalledWith({
      filePath: '',
      snippet: 'old',
    })
  })

  it('keeps absolute file paths unchanged', () => {
    const snippetSpy = vi.spyOn(snippetLineHook, 'useSnippetStartLineNumber').mockReturnValue(1)
    const absPath = path.resolve(process.cwd(), 'src/absolute.ts')
    render(<PatchApprovalPreview filePath={absPath} oldText="before" newText="after" />)

    expect(snippetSpy).toHaveBeenCalledWith({
      filePath: absPath,
      snippet: 'before',
    })
  })
})
