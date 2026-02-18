import React from 'react'
import type { Msg } from './ToolMessage'
import type { ToolRegistry } from '../../tools/registry'
import { FallbackToolPresenter } from '../../tools/presenters/fallback'
import { isToolBlocksPresenter } from '../../tools/presenters/types'
import { ToolUiBlocks } from './ToolUiBlocks'

type Props = {
  message: Msg
  registry?: ToolRegistry
}

function shouldShowSurfaceSuffix(): boolean {
  const raw = String(process.env.FORMAX_HOOKS_DEBUG ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export function ToolRouter({ message, registry }: Props): React.ReactNode {
  if (message.role !== 'tool') return null

  const showSurfaceSuffix = shouldShowSurfaceSuffix()
  const hint = message.surfaceHint ?? message.surfaceOwner
  const surface = hint === 'transient' ? 'trans' : hint === 'static' ? 'static' : null
  const toolUseId = String(message.toolInfo?.toolUseId || '').trim()
  const messageId = String(message.id || '').trim()
  const messageIdTail = messageId.slice(-4)
  const headerSuffix =
    showSurfaceSuffix && surface
      ? toolUseId
        ? `${surface}#${toolUseId.slice(-4)}${messageIdTail ? `@${messageIdTail}` : ''}${messageId ? `:${messageId}` : ''}`
        : `${surface}${messageIdTail ? `@${messageIdTail}` : ''}${messageId ? `:${messageId}` : ''}`
      : null
  const toolName = message.toolInfo?.name
  const Presenter = toolName && registry ? registry.getPresenter(toolName) : undefined

  if (Presenter) {
    if (isToolBlocksPresenter(Presenter)) {
      const out = Presenter({ message })
      return <ToolUiBlocks blocks={out.blocks} headerSuffix={headerSuffix} />
    }

    return <Presenter message={message} />
  }
  return <FallbackToolPresenter message={message} />
}
