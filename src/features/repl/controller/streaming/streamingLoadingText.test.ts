import { describe, expect, it } from 'vitest'
import { resolveLoadingTextForToolInput, resolveLoadingTextForToolStart } from './streamingLoadingText'

describe('streamingLoadingText', () => {
  it('maps tool_start names to loading labels', () => {
    expect(resolveLoadingTextForToolStart('AskUserQuestion')).toBe('Waiting')
    expect(resolveLoadingTextForToolStart('Write')).toBe('Preparing write')
    expect(resolveLoadingTextForToolStart('Edit')).toBe('Preparing edit')
    expect(resolveLoadingTextForToolStart('Bash')).toBe('Working')
  })

  it('builds write/edit loading labels from tool input paths', () => {
    expect(
      resolveLoadingTextForToolInput({
        toolName: 'Write',
        input: { file_path: '/tmp/project/very-long-file-name-that-needs-truncation.txt' },
      }),
    ).toContain('Writing')
    expect(
      resolveLoadingTextForToolInput({
        toolName: 'Edit',
        input: { path: 'C:\\tmp\\demo\\notes.md' },
      }),
    ).toBe('Editing notes.md')
    expect(
      resolveLoadingTextForToolInput({
        toolName: 'Bash',
        input: { path: '/tmp/demo' },
      }),
    ).toBeNull()
    expect(
      resolveLoadingTextForToolInput({
        toolName: 'Write',
        input: {},
      }),
    ).toBeNull()
  })
})
