import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../shared/toolMessageTypes'

async function loadPresenterWithBlankParams() {
  vi.resetModules()
  vi.doMock('../../../tui/toolFormatting', async () => {
    const actual = await vi.importActual<object>('../../../tui/toolFormatting')
    return {
      ...actual,
      formatToolCallParts: () => ({ toolName: 'Search', params: '   ' }),
    }
  })
  return await import('./presenter')
}

describe('GrepToolPresenter branch coverage', () => {
  it('sets header params to null when formatted params are blank', async () => {
    const { GrepToolPresenter } = await loadPresenterWithBlankParams()
    const message: Msg = {
      id: 'tool-empty-params',
      role: 'tool',
      content: 'ok',
      timestamp: new Date(),
      toolInfo: {
        name: 'Grep',
        status: 'completed',
        input: { pattern: 'x', path: 'src' },
      },
    }
    const blocks = GrepToolPresenter({ message }).blocks as any[]
    expect(blocks[0].kind).toBe('header')
    expect(blocks[0].params).toBeNull()
  })
})
