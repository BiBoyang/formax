import { describe, expect, it } from 'vitest'
import { displayThreadTitle, summarizeToolEvent, toToolUseId, toTurnFooterStatus } from './threadTransforms'

describe('threadTransforms', () => {
  it('picks thread title from label, then prompt, then fallback', () => {
    expect(displayThreadTitle({ id: 't1', label: '  Label  ' } as any)).toBe('Label')
    expect(displayThreadTitle({ id: 't1', label: '  ', lastUserPrompt: 'Prompt' } as any)).toBe('Prompt')
    expect(displayThreadTitle(undefined)).toBe('New Thread')
  })

  it('extracts summary text from tool events', () => {
    expect(summarizeToolEvent({ type: 'tool_start' })).toBe('')
    expect(summarizeToolEvent({ type: 'tool_end', result: { content: ' done ' } })).toBe('done')
    expect(summarizeToolEvent({ type: 'tool_update', transcriptLines: ['x', 'final line'] })).toBe('final line')
  })

  it('maps error text to turn footer status and normalizes tool use id', () => {
    expect(toTurnFooterStatus('operation interrupted')).toBe('interrupted')
    expect(toTurnFooterStatus('something failed')).toBe('failed')
    expect(toToolUseId('  tool-1  ')).toBe('tool-1')
    expect(toToolUseId('  ')).toBeUndefined()
  })
})
