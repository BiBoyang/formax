import React, { useState, useCallback, useMemo } from 'react'
import { Box, Text, useInput, Static } from 'ink'
import type { ChatEngine } from '../chat/engine'
import type { RuntimeConfig } from '../env/config'
import type { ToolDefinition } from '../tools/types'
import type { ToolRegistry } from '../tools/registry'
import { useReplController } from '../features/repl/useReplController'
import { ToolRouter } from '../components/tool/ToolRouter'
import type { Msg } from '../components/tool/ToolMessage'
import { HeaderBanner } from '../components/chat/HeaderBanner'
import pkg from '../../package.json'
import { InputBar } from '../components/chat/InputBar'
import type { UserInputManager } from '../tools/runtime/userInputManager'
import type { TaskManager } from '../tools/runtime/taskManager'
import { getSlashCommandSuggestions } from '../features/commands/registry'

type Props = {
  onExit?: () => void
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  allowedSubagents?: Array<{ name: string; description: string }>
  toolRegistry?: ToolRegistry
  userInputManager?: UserInputManager
  taskManager?: TaskManager
}

export function REPL({
  onExit,
  engine,
  tools,
  cfg,
  allowedSubagents,
  toolRegistry,
  userInputManager,
  taskManager,
}: Props): React.ReactNode {
  const [input, setInput] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  const { state, actions } = useReplController({
    engine,
    tools,
    cfg,
    allowedSubagents,
    userInputManager,
    taskManager,
  })

  const slashSuggestions = useMemo(() => {
    if (state.pendingAsk) return []
    return getSlashCommandSuggestions(input).slice(0, 10)
  }, [input, state.pendingAsk])

  const selectedSlash = slashSuggestions[slashIndex]?.command

  const handleInputChange = useCallback((v: string) => {
    setInput(v)
    setSlashIndex(0)
  }, [])

  useInput((key, meta) => {
    if (meta.ctrl && key === 'c') {
      actions.abort()
      onExit ? onExit() : process.exit(0)
    }
    if (meta.escape) {
      actions.abort()
    }

    if (slashSuggestions.length > 0 && !state.pendingAsk) {
      if (meta.downArrow) {
        setSlashIndex((i) => Math.min(i + 1, slashSuggestions.length - 1))
      } else if (meta.upArrow) {
        setSlashIndex((i) => Math.max(i - 1, 0))
      } else if (meta.tab && selectedSlash) {
        setInput(selectedSlash)
        setSlashIndex(0)
      }
    }
  })

  const handleSend = useCallback(
    async (value: string) => {
      const text = value.trim()
      if (!text) return

      if (state.pendingAsk) {
        setInput('')
        actions.answerAskUserQuestion(text)
        return
      }
      if (slashSuggestions.length > 0 && selectedSlash) {
        const normalized = text.replace(/\s+$/, '')
        if (normalized !== selectedSlash && !normalized.startsWith(selectedSlash + ' ')) {
          setInput(selectedSlash)
          setSlashIndex(0)
          return
        }
      }

      setInput('')
      if (state.isLoading) return
      await actions.send(text)
    },
    [actions, selectedSlash, slashSuggestions.length, state.isLoading, state.pendingAsk],
  )

  const renderMessage = useCallback(
    (msg: Msg) => {
      if (msg.role === 'tool') {
        return (
          <Box flexDirection="column">
            <ToolRouter message={msg} registry={toolRegistry} />
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
    },
    [toolRegistry],
  )

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

        {state.isLoading && !state.pendingAsk && (
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
          onChange={handleInputChange}
          onSubmit={handleSend}
          placeholder={buildPlaceholder(state.pendingAsk)}
          disabled={state.isLoading && !state.pendingAsk}
          suggestions={slashSuggestions.map((s, i) => ({
            command: s.command,
            description: s.description,
            selected: i === slashIndex,
            dim: s.implemented === false,
          }))}
        />
        <Box marginTop={1}>
          <Text dimColor>? for shortcuts</Text>
        </Box>
      </Box>
    </Box>
  )
}

function buildPlaceholder(pendingAsk: any): string {
  if (!pendingAsk) return `Try \"fix typecheck errors\"`
  const q = pendingAsk.questions?.[pendingAsk.questionIndex]
  const header = typeof q?.header === 'string' && q.header.trim() ? q.header.trim() : 'Answer'
  const optionCount = Array.isArray(q?.options) ? q.options.length : 0
  const range = optionCount > 0 ? `1-${optionCount}` : 'text'
  const multi = q?.multiSelect ? ' (multi)' : ''
  return `${header}${multi}: choose ${range} or 0=Other`
}
