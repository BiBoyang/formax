import React from 'react'
import { ToolMessage, type Msg } from '../../components/tool/ToolMessage'
import type { ToolPresenterComponent } from './types'

export const FallbackToolPresenter: ToolPresenterComponent = ({ message }: { message: Msg }) => {
  return <ToolMessage message={message} />
}
