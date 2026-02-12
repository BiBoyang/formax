import { describe, expect, it } from 'vitest'
import { formatToolInputAsParamsText, mapHistoryToolToTranscript } from './toolEventNormalizer'

describe('toolEventNormalizer', () => {
  it('maps history tool messages to transcript tool_call shape', () => {
    const out = mapHistoryToolToTranscript({
      id: 'history-1',
      tool: {
        id: 'tool-1',
        kind: 'tool',
        toolName: 'Bash',
        status: 'completed',
        summary: 'Ran command',
        detailLines: ['$ ls'],
      },
    })

    expect(out).toMatchObject({
      id: 'history-1',
      kind: 'tool_call',
      toolName: 'Bash',
      status: 'completed',
      summary: 'Ran command',
      detailLines: ['$ ls'],
    })
  })

  it('formats tool input as params text with truncation', () => {
    const out = formatToolInputAsParamsText({
      command: 'echo hello',
      long: 'x'.repeat(220),
    })

    expect(out).toContain('command=')
    expect(out?.length ?? 0).toBeLessThanOrEqual(163)
    expect(out?.endsWith('...')).toBe(true)
  })

  it('returns undefined for non-object inputs', () => {
    expect(formatToolInputAsParamsText(null)).toBeUndefined()
    expect(formatToolInputAsParamsText('echo')).toBeUndefined()
    expect(formatToolInputAsParamsText(42)).toBeUndefined()
  })
})
