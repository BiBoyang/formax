import React from 'react'
import { ToolMessage } from '../../components/tool/ToolMessage'
import type { Msg } from '../../shared/toolMessageTypes'
import type { ToolPresenterComponent } from './types'

export const FallbackToolPresenter: ToolPresenterComponent = ({ message }: { message: Msg }) => {
  return <ToolMessage message={message} />
}
