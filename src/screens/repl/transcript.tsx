import React, { useMemo } from 'react'
import { Box, Static } from 'ink'
import { HeaderBanner } from '../../components/chat/HeaderBanner'
import type { Msg } from '../../components/tool/ToolMessage'

function shouldEnableInkStatic(): boolean {
  if (process.env.FORMAX_FORCE_INK_STATIC === '1') return true
  return process.env.NODE_ENV !== 'test' && !process.env.VITEST
}

type TranscriptMessageRowProps = {
  message: Msg
  renderMessage: (msg: Msg) => React.ReactNode
}

type StaticTranscriptItem =
  | { kind: 'header' }
  | {
      kind: 'message'
      message: Msg
    }

const TranscriptMessageRow = React.memo(
  function TranscriptMessageRow({ message, renderMessage }: TranscriptMessageRowProps) {
    return <Box>{renderMessage(message)}</Box>
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
  const { transcriptSeq, version, modelLabel, cwd, staticMessages, transientMessages, renderMessage } = props

  const enableInkStatic = shouldEnableInkStatic()

  const staticItems = useMemo<StaticTranscriptItem[]>(
    () => [
      { kind: 'header' as const },
      ...staticMessages.map((message) => ({ kind: 'message' as const, message })),
    ],
    [staticMessages],
  )

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

  if (!enableInkStatic) {
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

  return (
    <>
      {/* Ink <Static> is append-only; we remount it via transcriptSeq when we need a fresh render surface. */}
      <Static key={transcriptSeq} items={staticItems}>
        {(item) => {
          if (item.kind === 'header') {
            return (
              <Box key="header">
                <HeaderBanner version={version} modelLabel={modelLabel} cwd={cwd} />
              </Box>
            )
          }

          return <TranscriptMessageRow key={item.message.id} message={item.message} renderMessage={renderMessage} />
        }}
      </Static>
      {transientRows}
    </>
  )
}

export function ExpandedReplTranscript(props: {
  transcriptSeq: number
  version: string
  modelLabel: string
  cwd: string
  messages: Msg[]
  renderMessage: (msg: Msg) => React.ReactNode
}): React.ReactNode {
  const { transcriptSeq, version, modelLabel, cwd, messages, renderMessage } = props

  const enableInkStatic = shouldEnableInkStatic()

  const staticItems = useMemo<StaticTranscriptItem[]>(
    () => [
      { kind: 'header' as const },
      ...messages.map((message) => ({ kind: 'message' as const, message })),
    ],
    [messages],
  )

  const rows = useMemo(
    () =>
      messages.map((message) => (
        <TranscriptMessageRow key={message.id} message={message} renderMessage={renderMessage} />
      )),
    [messages, renderMessage],
  )

  if (!enableInkStatic) {
    return (
      <>
        <Box>
          <HeaderBanner version={version} modelLabel={modelLabel} cwd={cwd} />
        </Box>
        {rows}
      </>
    )
  }

  return (
    <>
      <Static key={transcriptSeq} items={staticItems}>
        {(item) => {
          if (item.kind === 'header') {
            return (
              <Box key="header">
                <HeaderBanner version={version} modelLabel={modelLabel} cwd={cwd} />
              </Box>
            )
          }

          return <TranscriptMessageRow key={item.message.id} message={item.message} renderMessage={renderMessage} />
        }}
      </Static>
    </>
  )
}
