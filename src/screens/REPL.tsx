import React, { useState, useCallback, useMemo } from 'react'
import { Box, Text, useInput, Static } from 'ink'
import type { ChatEngine } from '../chat/engine'
import type { RuntimeConfig } from '../env/config'
import type { ToolDefinition } from '../tools/types'
import { useReplController } from '../features/repl/useReplController'
import { ToolMessage, Msg } from '../components/tool/ToolMessage'
import { HeaderBanner } from '../components/chat/HeaderBanner'
import pkg from '../../package.json'
import { InputBar } from '../components/chat/InputBar'

type Props = {
  onExit?: () => void
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  allowedSubagents?: Array<{ name: string; description: string }>
}

export function REPL({ onExit, engine, tools, cfg, allowedSubagents }: Props): React.ReactNode {
  const [input, setInput] = useState('')
  const { state, actions } = useReplController({
    engine,
    tools,
    cfg,
    allowedSubagents,
  })

  useInput((key, meta) => {
    if (meta.ctrl && key === 'c') {
      actions.abort()
      onExit ? onExit() : process.exit(0)
    }
    if (meta.escape) {
      actions.abort()
    }
  })

  const handleSend = useCallback(
    async (value: string) => {
      const text = value.trim()
      if (!text || state.isLoading) return
      setInput('')
      await actions.send(text)
    },
    [actions, state.isLoading],
  )

  const renderMessage = useCallback((msg: Msg) => {
    if (msg.role === 'tool') {
      return (
        <Box flexDirection="column">
          <ToolMessage message={msg} />
        </Box>
      )
    }

    if (msg.role === 'assistant') {
      if (!msg.content) return null
      return (
        <Box flexDirection="column" marginTop={1} marginBottom={0}>
          <Box>
            <Text>⏺</Text>
            <Text>{msg.content}</Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" marginTop={1} marginBottom={0}>
        <Box>
          <Text bold>&gt; </Text>
          <Text>{msg.content}</Text>
        </Box>
      </Box>
    )
  }, [])

  const modelLabel = useMemo(() => {
    const model = cfg.llm.model || process.env.ANTHROPIC_MODEL || 'Model not set'
    return `Model: ${model}`
  }, [cfg.llm.model])

  // Header 作为 Static 列表的第一项
  const staticItems = useMemo(() => {
    const header = {
      key: 'header',
      jsx: (
        <HeaderBanner
          version={(pkg as any).version || '0.0.0'}
          modelLabel={modelLabel}
          cwd={process.cwd()}
        />
      ),
    }
    const items = state.staticMessages.map((m) => ({ key: m.id, jsx: renderMessage(m) }))
    return [header, ...items]
  }, [modelLabel, renderMessage, state.staticMessages])

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {/* Header + 消息 Static */}
        <Static items={staticItems}>
          {(item) => <Box key={item.key}>{item.jsx}</Box>}
        </Static>

        {state.transientMessages.map((msg) => (
          <Box key={msg.id}>{renderMessage(msg)}</Box>
        ))}

        {state.isLoading && (
          <Box marginTop={1}>
            <Text color="yellow">⏺</Text>
            <Text color="yellow">{state.loadingText}.</Text>
            <Text dimColor> (esc to interrupt)</Text>
          </Box>
        )}

        {state.error && !state.isLoading && (
          <Box marginTop={1}>
            <Text color="red">⏺</Text>
            <Text color="red">Error: {state.error}</Text>
          </Box>
        )}
      </Box>

      <Box flexDirection="column" flexShrink={0} marginTop={1}>
        <InputBar
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          placeholder={`Try \"fix typecheck errors\"`}
          disabled={state.isLoading}
        />
        <Box marginTop={1}>
          <Text dimColor>? for shortcuts</Text>
        </Box>
      </Box>
    </Box>
  )
}
