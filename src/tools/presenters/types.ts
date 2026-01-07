import type React from 'react'
import type { Msg } from '../../components/tool/ToolMessage'

export type ToolPresenterProps = {
  message: Msg
}

export type ToolPresenter = (props: ToolPresenterProps) => React.ReactNode

