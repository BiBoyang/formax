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
import type { TaskManager } from '../tools/runtime/taskManager'
import { getSlashCommandSuggestions } from '../features/commands/registry'
import { ReplUiProvider } from '../features/repl/replUiContext'
import { PulsingDot } from '../components/ui/PulsingDot'
import { nextReplMode, type ReplMode } from '../features/repl/mode'
import { useUserInputManager } from '../tools/runtime/userInputContext'

type Props = {
  onExit?: () => void
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  allowedSubagents?: Array<{ name: string; description: string }>
  toolRegistry?: ToolRegistry
  taskManager?: TaskManager
}

export function REPL({
  onExit,
  engine,
  tools,
  cfg,
  allowedSubagents,
  toolRegistry,
  taskManager,
}: Props): React.ReactNode {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<ReplMode>('normal')
  const [slashIndex, setSlashIndex] = useState(0)
  const userInput = useUserInputManager()
  const { state, actions } = useReplController({
    engine,
    tools,
    cfg,
    allowedSubagents,
    taskManager,
    mode,
    onModeChange: (nextMode) => setMode(nextMode),
  })

  const isPromptMode = useMemo(() => {
    if (!userInput) return false
    const alwaysInteractive = new Set(['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'])
    return state.transientMessages.some((m) => {
      if (m.role !== 'tool' || m.toolInfo?.status !== 'running') return false
      const toolUseId = m.toolInfo.toolUseId || (m.id.startsWith('tool-') ? m.id.slice('tool-'.length) : m.id)
      return alwaysInteractive.has(m.toolInfo.name) || userInput.isPending(toolUseId)
    })
  }, [state.transientMessages, userInput])

  const slashSuggestions = useMemo(() => {
    if (isPromptMode) return []
    return getSlashCommandSuggestions(input).slice(0, 10)
  }, [input, isPromptMode])

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

    if (meta.shift && meta.tab) {
      setMode((m) => nextReplMode(m))
      return
    }

    if (isPromptMode) return

    if (meta.escape) {
      actions.abort()
    }

    if (slashSuggestions.length > 0) {
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
    [actions, selectedSlash, slashSuggestions.length, state.isLoading],
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
    <ReplUiProvider abort={actions.abort}>
      <Box flexDirection="column" height="100%">
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {/* Header + 消息 Static */}
          <Static items={staticItems}>
            {(item) => <Box key={item.key}>{item.jsx}</Box>}
          </Static>

          {state.transientMessages.map((msg) => (
            <Box key={msg.id}>{renderMessage(msg)}</Box>
          ))}

          {state.isLoading && !isPromptMode && (
            <Box marginTop={1}>
              <PulsingDot color="yellow" pulse />
              <Text color="yellow">{state.loadingText}.</Text>
              <Text dimColor> (esc to interrupt)</Text>
            </Box>
          )}

          {state.error && !state.isLoading && (
            <Box marginTop={1}>
              <PulsingDot color="red" />
              <Text color="red">Error: {state.error}</Text>
            </Box>
          )}
        </Box>

        {!isPromptMode && (
          <Box flexDirection="column" flexShrink={0} marginTop={1}>
            <InputBar
              value={input}
              onChange={handleInputChange}
              onSubmit={handleSend}
              placeholder={`Try \"fix typecheck errors\"`}
              disabled={state.isLoading}
              suggestions={slashSuggestions.map((s, i) => ({
                command: s.command,
                description: s.description,
                selected: i === slashIndex,
                dim: s.implemented === false,
              }))}
            />
            <Box marginTop={1}>
              {mode === 'normal' ? (
                <Text dimColor>? for shortcuts</Text>
              ) : mode === 'acceptEdits' ? (
                <Text dimColor>⏵⏵ accept edits on (shift+tab to cycle)</Text>
              ) : (
                <Text dimColor>⏸ plan mode on (shift+tab to cycle)</Text>
              )}
            </Box>
          </Box>
        )}
      </Box>
    </ReplUiProvider>
  )
}
