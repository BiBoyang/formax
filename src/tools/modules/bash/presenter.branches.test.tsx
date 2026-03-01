import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../shared/toolMessageTypes'

async function loadPresenterForNullInput() {
  vi.resetModules()
  vi.doMock('../../../shared/utils/toolFormatting', async () => {
    const actual = await vi.importActual<object>('../../../shared/utils/toolFormatting')
    return {
      ...actual,
      formatToolCallParts: () => ({ toolName: 'Bash', params: 'command: "echo hi"' }),
    }
  })
  return await import('./presenter')
}

describe('BashToolPresenter branch coverage', () => {
  it('handles null input via parseBashInput object guard', async () => {
    const { BashToolPresenter } = await loadPresenterForNullInput()
    const message: Msg = {
      id: 'plain-null-input',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Bash',
        status: 'running',
        input: null as any,
      },
    }
    const blocks = BashToolPresenter({ message }).blocks as any[]
    expect(blocks[1].kind).toBe('custom')
    expect(blocks[1].node.props.command).toBe('')
    expect(blocks[1].node.props.cwd).toBe(process.cwd())
  })
})
