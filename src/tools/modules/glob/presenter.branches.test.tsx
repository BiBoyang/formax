import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../components/tool/ToolMessage'

async function loadPresenterWithEmptyParams() {
  vi.resetModules()
  vi.doMock('../../../shared/utils/toolFormatting', async () => {
    const actual = await vi.importActual<object>('../../../shared/utils/toolFormatting')
    return {
      ...actual,
      formatToolCallParts: () => ({ toolName: 'Search', params: '   ' }),
    }
  })
  return await import('./presenter')
}

describe('GlobToolPresenter branch coverage', () => {
  it('sets header params to null when formatted params are blank', async () => {
    const { GlobToolPresenter } = await loadPresenterWithEmptyParams()
    const message: Msg = {
      id: 'tool-empty-params',
      role: 'tool',
      content: 'ok',
      timestamp: new Date(),
      toolInfo: {
        name: 'Glob',
        status: 'completed',
        input: { pattern: '*.ts', path: 'src' },
      },
    }
    const blocks = GlobToolPresenter({ message }).blocks as any[]
    expect(blocks[0].kind).toBe('header')
    expect(blocks[0].params).toBeNull()
  })
})
