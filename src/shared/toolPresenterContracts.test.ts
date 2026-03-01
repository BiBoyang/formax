import { describe, expect, it } from 'vitest'
import { createToolBlocksPresenter, isToolBlocksPresenter } from './toolPresenterContracts'
import type { Msg } from './toolMessageTypes'

function createMessage(): Msg {
  return {
    id: 'tool-1',
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: {
      name: 'read',
      input: {},
      status: 'running',
    },
  }
}

describe('toolPresenterContracts', () => {
  it('marks blocks presenter with __kind=blocks', () => {
    const presenter = createToolBlocksPresenter(() => ({ blocks: [] }))
    expect(presenter.__kind).toBe('blocks')
  })

  it('detects blocks presenters via type guard', () => {
    const blocksPresenter = createToolBlocksPresenter(() => ({ blocks: [] }))
    const componentPresenter = ({ message }: { message: Msg }) => message.content

    expect(isToolBlocksPresenter(blocksPresenter)).toBe(true)
    expect(isToolBlocksPresenter(componentPresenter)).toBe(false)
  })

  it('keeps message payload contract unchanged', () => {
    const message = createMessage()
    const presenter = createToolBlocksPresenter(({ message: currentMessage }) => ({
      blocks: [{ kind: 'header', status: currentMessage.toolInfo?.status ?? 'completed', label: 'Read' }],
    }))

    const out = presenter({ message })

    expect(out.blocks).toHaveLength(1)
    expect(out.blocks[0]).toEqual({ kind: 'header', status: 'running', label: 'Read' })
  })
})
