import type React from 'react'
import type { Msg } from '../../shared/toolMessageTypes'
import type { ToolBlocksOutput, ToolUiBlock } from '../../shared/toolMessageTypes'

export type ToolPresenterProps = {
  message: Msg
}

export type ToolPresenterComponent = (props: ToolPresenterProps) => React.ReactNode

export type ToolBlocksPresenter = ((props: ToolPresenterProps) => ToolBlocksOutput) & {
  __kind: 'blocks'
}

export type ToolPresenter = ToolPresenterComponent | ToolBlocksPresenter

export function createToolBlocksPresenter(
  fn: (props: ToolPresenterProps) => { blocks: ToolUiBlock[] },
): ToolBlocksPresenter {
  return Object.assign(fn, { __kind: 'blocks' as const })
}

export function isToolBlocksPresenter(presenter: ToolPresenter): presenter is ToolBlocksPresenter {
  return typeof presenter === 'function' && (presenter as any).__kind === 'blocks'
}
