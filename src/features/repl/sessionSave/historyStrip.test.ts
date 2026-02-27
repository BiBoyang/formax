import { describe, expect, it } from 'vitest'
import { stripEphemeralFromHistory } from './historyStrip'

describe('stripEphemeralFromHistory', () => {
  it('drops ephemeral blocks from message content arrays', () => {
    const out = stripEphemeralFromHistory([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'keep' },
          { type: 'text', text: 'drop', cache_control: { type: 'ephemeral' } },
        ],
      } as any,
    ] as any)

    expect((out[0] as any).content).toEqual([{ type: 'text', text: 'keep' }])
  })

  it('leaves non-object and non-array content entries unchanged', () => {
    const primitive = 'legacy-row' as any
    const nonArrayContent = { role: 'assistant', content: 'plain-text' } as any

    const out = stripEphemeralFromHistory([primitive, nonArrayContent] as any)
    expect(out[0]).toBe(primitive)
    expect(out[1]).toBe(nonArrayContent)
  })
})
