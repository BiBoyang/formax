import React, { useMemo } from 'react'
import { Box } from 'ink'
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
  const { version, modelLabel, cwd, staticMessages, transientMessages, renderMessage } = props

  const items = useMemo(() => {
    const header = {
      key: 'header',
      jsx: <HeaderBanner version={version} modelLabel={modelLabel} cwd={cwd} />,
    }
    const messages = renderMessageItems(staticMessages, renderMessage)
    const transient = renderMessageItems(transientMessages, renderMessage)
    return [header, ...messages, ...transient]
  }, [cwd, modelLabel, renderMessage, staticMessages, transientMessages, version])

  return (
    <>
      {items.map((item) => (
        <Box key={item.key}>{item.jsx}</Box>
      ))}
    </>
  )
}

export function ExpandedReplTranscript(props: {
  version: string
  modelLabel: string
  cwd: string
  messages: Msg[]
  renderMessage: (msg: Msg) => React.ReactNode
}): React.ReactNode {
  const { version, modelLabel, cwd, messages, renderMessage } = props

  const items = useMemo(() => {
    const header = {
      key: 'header',
      jsx: <HeaderBanner version={version} modelLabel={modelLabel} cwd={cwd} />,
    }
    const rendered = renderMessageItems(messages, renderMessage)
    return [header, ...rendered]
  }, [cwd, messages, modelLabel, renderMessage, version])

  return (
    <>
      {items.map((item) => (
        <Box key={item.key}>{item.jsx}</Box>
      ))}
    </>
  )
}
