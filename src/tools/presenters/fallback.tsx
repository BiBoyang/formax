import React from 'react'
import { ToolMessage, type Msg } from '../../components/tool/ToolMessage'
import type { ToolPresenter } from './types'

export const FallbackToolPresenter: ToolPresenter = ({ message }: { message: Msg }) => {
  return <ToolMessage message={message} />
}

