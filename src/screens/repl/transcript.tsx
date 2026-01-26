import React, { useMemo } from 'react'
import { Box, Static } from 'ink'
import { HeaderBanner } from '../../components/chat/HeaderBanner'
import type { Msg } from '../../components/tool/ToolMessage'

type MessageItem = { key: string; jsx: React.ReactNode }

function renderMessageItems(messages: Msg[], renderMessage: (msg: Msg) => React.ReactNode): MessageItem[] {
  return messages.map((message) => ({ key: message.id, jsx: renderMessage(message) }))
}

export function ReplTranscript(props: {
  transcriptSeq: number
  version: string
  modelLabel: string
  cwd: string
  staticMessages: Msg[]
  transientMessages: Msg[]
  renderMessage: (msg: Msg) => React.ReactNode
}): React.ReactNode {
  const { transcriptSeq, version, modelLabel, cwd, staticMessages, transientMessages, renderMessage } = props

  const staticItems = useMemo(() => {
    const header = {
      key: 'header',
      jsx: <HeaderBanner version={version} modelLabel={modelLabel} cwd={cwd} />,
    }
    const messages = renderMessageItems(staticMessages, renderMessage)
    return [header, ...messages]
  }, [cwd, modelLabel, renderMessage, staticMessages, version])

  return (
    <>
      {/* Header + 消息 Static */}
      <Static key={transcriptSeq} items={staticItems}>
        {(item) => <Box key={item.key}>{item.jsx}</Box>}
      </Static>

      {renderMessageItems(transientMessages, renderMessage).map((item) => (
        <Box key={item.key}>{item.jsx}</Box>
      ))}
    </>
  )
}

