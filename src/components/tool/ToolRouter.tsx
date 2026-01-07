import React from 'react'
import type { Msg } from './ToolMessage'
import type { ToolRegistry } from '../../tools/registry'
import { FallbackToolPresenter } from '../../tools/presenters/fallback'

type Props = {
  message: Msg
  registry?: ToolRegistry
}

export function ToolRouter({ message, registry }: Props): React.ReactNode {
  if (message.role !== 'tool') return null

  const toolName = message.toolInfo?.name
  const Presenter = toolName && registry ? registry.getPresenter(toolName) : undefined

  if (Presenter) return <Presenter message={message} />
  return <FallbackToolPresenter message={message} />
}

