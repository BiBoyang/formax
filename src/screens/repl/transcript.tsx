import React, { useMemo } from 'react'
import { Box } from 'ink'
import { HeaderBanner } from '../../components/chat/HeaderBanner'
import type { Msg } from '../../components/tool/ToolMessage'

type TranscriptMessageRowProps = {
  message: Msg
  renderMessage: (msg: Msg) => React.ReactNode
}

const TranscriptMessageRow = React.memo(
  function TranscriptMessageRow({ message, renderMessage }: TranscriptMessageRowProps) {
    const jsx = renderMessage(message)
    return <Box>{jsx}</Box>
  },
  (prev, next) => prev.message === next.message && prev.renderMessage === next.renderMessage,
)

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

  const staticRows = useMemo(
    () =>
      staticMessages.map((message) => (
        <TranscriptMessageRow key={message.id} message={message} renderMessage={renderMessage} />
      )),
    [renderMessage, staticMessages],
  )

  const transientRows = useMemo(
    () =>
      transientMessages.map((message) => (
        <TranscriptMessageRow key={message.id} message={message} renderMessage={renderMessage} />
      )),
    [renderMessage, transientMessages],
  )

  return (
    <>
      <Box>
        <HeaderBanner version={version} modelLabel={modelLabel} cwd={cwd} />
      </Box>
      {staticRows}
      {transientRows}
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

  const rows = useMemo(
    () =>
      messages.map((message) => (
        <TranscriptMessageRow key={message.id} message={message} renderMessage={renderMessage} />
      )),
    [messages, renderMessage],
  )

  return (
    <>
      <Box>
        <HeaderBanner version={version} modelLabel={modelLabel} cwd={cwd} />
      </Box>
      {rows}
    </>
  )
}
