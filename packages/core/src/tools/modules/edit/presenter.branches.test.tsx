import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../shared/toolMessageTypes'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'

async function loadPresenterWithBlankParams() {
  vi.resetModules()
  vi.doMock('../../../shared/utils/toolFormatting', async () => {
    const actual = await vi.importActual<object>('../../../shared/utils/toolFormatting')
    return {
      ...actual,
      formatToolCallParts: () => ({ toolName: 'Edit', params: '   ' }),
    }
  })
  return await import('./presenter')
}

describe('EditToolPresenter branch coverage', () => {
  it('sets header params to null when formatted params are blank', async () => {
    const { EditToolPresenter } = await loadPresenterWithBlankParams()
    const message: Msg = {
      id: 'tool-edit-empty-params',
      role: 'tool',
      content: 'done',
      timestamp: new Date(),
      toolInfo: {
        name: 'Edit',
        status: 'completed',
        input: {
          file_path: 'a.ts',
          old_string: 'a',
          new_string: 'b',
        },
      },
    }
    const out = (EditToolPresenter as any)({ message })
    const frame = render(<ToolUiBlocks blocks={out.blocks} />).lastFrame()
    expect(frame).toContain('Edit')
    expect(frame).not.toContain('Edit(a.ts)')
  })
})
