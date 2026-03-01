import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from './theme.js'
import { LoadingStatusLine } from '../components/ui/LoadingStatusLine.js'
import { SelectList } from '../components/ui/SelectList.js'
import TextInput from '../components/ui/TextInput.js'
import { useScopeActivation, useScopedInput } from '../features/repl/inputScopeContext.js'
import { getInputToken, isCtrlChord } from '../features/repl/keys/keyTokens.js'
import { createSetupSession } from '../core/setup/session.js'
import type { ConnectionTester, SetupSession } from '../core/setup/session.js'
import { getConnectionTestHint } from '../core/setup/hints.js'
import type { SetupAnthropicVendor, SetupDraft, SetupProviderOption } from '../core/setup/types.js'
import type { ModelTier, ProviderId } from '../config/settings/schema.js'
import type { ErrorCode as ErrorCodeValue } from '../core/errors/codes.js'

type ChoiceOption = {
  label: string
  description?: string
  value: string
  disabled?: boolean
}

function resolveBaseUrlPlaceholder(args: { provider: ProviderId | null; anthropicVendor: SetupAnthropicVendor | null }): string {
  if (args.provider === 'anthropic') {
    if (args.anthropicVendor === 'custom') return 'https://your-provider.example.com/anthropic'
    if (args.anthropicVendor === 'glm') return 'https://open.bigmodel.cn/api/anthropic'
    if (args.anthropicVendor === 'kimi') return 'https://api.moonshot.cn/anthropic'
    if (args.anthropicVendor === 'minimax') return 'https://api.minimax.io/anthropic'
    return 'https://api.anthropic.com/v1'
  }
  if (args.provider === 'openai') return 'https://api.openai.com/v1'
  if (args.provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta'
  return 'https://api.anthropic.com/v1'
}

function firstEnabledIndex(options: ChoiceOption[]): number {
  const idx = options.findIndex((o) => !o.disabled)
  return idx >= 0 ? idx : 0
}

function nextIndex(options: ChoiceOption[], from: number, dir: 1 | -1): number {
  if (options.length === 0) return 0
  return (from + dir + options.length) % options.length
}

function computeWindowTop(cursor: number, total: number, maxVisible: number): number {
  if (total <= maxVisible) return 0
  const maxTop = Math.max(0, total - maxVisible)
  let top = 0
  if (cursor > maxVisible - 1) top = cursor - (maxVisible - 1)
  if (cursor < top) top = cursor
  if (cursor > top + maxVisible - 1) top = cursor - (maxVisible - 1)
  return Math.max(0, Math.min(top, maxTop))
}

function ChoiceListView({
  options,
  focusedIndex,
  selectedValue,
  maxVisibleRows,
}: {
  options: ChoiceOption[]
  focusedIndex: number
  selectedValue?: string
  maxVisibleRows?: number
}): React.ReactNode {
  const theme = getTheme()

  const items = options.map((opt) => {
    const selected = selectedValue === opt.value
    const suffix = opt.disabled ? 'coming soon' : opt.description
    const right = selected ? (suffix ? `✓ ${suffix}` : '✓') : suffix
    return { key: opt.value, label: opt.label, right, disabled: opt.disabled }
  })

  const cursor = Math.max(0, Math.min(focusedIndex, Math.max(0, items.length - 1)))
  const maxVisible = Math.max(1, maxVisibleRows ?? items.length)
  const top = computeWindowTop(cursor, items.length, maxVisible)
  const visible = items.slice(top, top + maxVisible)
  const hasMoreAbove = top > 0
  const hasMoreBelow = top + maxVisible < items.length

  if (maxVisibleRows) {
    const numberWidth = String(top + visible.length).length
    return (
      <Box flexDirection="column">
        {visible.map((item, i) => {
          const absIndex = top + i
          const active = absIndex === cursor
          const prefix = active ? '❯ ' : i === 0 && hasMoreAbove ? '↑ ' : i === visible.length - 1 && hasMoreBelow ? '↓ ' : '  '
          const number = `${String(absIndex + 1).padStart(numberWidth, ' ')}. `
          const color = item.disabled ? theme.secondaryText : active ? theme.permission : theme.text
          return (
            <Text key={item.key} color={color}>
              {prefix}
              <Text color={theme.secondaryText}>{number}</Text>
              {item.label}
              {item.right ? <Text color={theme.secondaryText}>{`  ${item.right}`}</Text> : null}
            </Text>
          )
        })}
      </Box>
    )
  }

  return (
    <SelectList
      items={items}
      cursor={cursor}
      accentColor={theme.permission}
      mutedColor={theme.text}
      disabledColor={theme.secondaryText}
      activePrefix="❯ "
      inactivePrefix="  "
      showNumbers={false}
      leftWidth={24}
      rightColor={theme.secondaryText}
    />
  )
}

export type SetupWizardProps = {
  providers: SetupProviderOption[]
  testConnection: ConnectionTester
  onWrite: (draft: SetupDraft) => Promise<void>
  onDone: () => void
  onCancel: () => void
}

export function SetupWizard({ providers, testConnection, onWrite, onDone, onCancel }: SetupWizardProps): React.ReactNode {
  useScopeActivation('wizard:setup')

  const sessionRef = useRef<SetupSession | null>(null)
  if (!sessionRef.current) {
    sessionRef.current = createSetupSession({ providers, testConnection })
  }
  const session = sessionRef.current

  const mountedRef = useRef(true)
  const escapeFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      const t = escapeFallbackTimerRef.current
      if (t) clearTimeout(t)
      escapeFallbackTimerRef.current = null
      mountedRef.current = false
    }
  }, [])

  const [sessionState, setSessionState] = useState(() => session.getState())
  const [providerFocus, setProviderFocus] = useState(0)
  const [anthropicVendorFocus, setAnthropicVendorFocus] = useState(0)
  const [modelModeFocus, setModelModeFocus] = useState(0)
  const [modelFocus, setModelFocus] = useState(0)
  const [confirmFocus, setConfirmFocus] = useState(0)
  const [writing, setWriting] = useState<{ status: 'idle' | 'running' | 'error'; error: string | null }>({ status: 'idle', error: null })

  const refresh = useCallback(() => {
    if (!mountedRef.current) return
    setSessionState(session.getState())
  }, [session])

  const goBack = useCallback(() => {
    session.back()
    refresh()
  }, [refresh, session])

  const runNext = useCallback(async () => {
    const p = session.next()
    refresh()
    await p
    refresh()
  }, [refresh, session])

  const providerOptions = useMemo(() => toProviderOptions(providers), [providers])
  const anthropicVendorOptions = useMemo<ChoiceOption[]>(
    () => [
      { value: 'anthropic', label: 'Anthropic', description: 'Official Anthropic endpoint' },
      { value: 'glm', label: 'GLM', description: 'Zhipu GLM Anthropic-compatible endpoint' },
      { value: 'kimi', label: 'Kimi', description: 'Moonshot Kimi Anthropic-compatible endpoint' },
      { value: 'minimax', label: 'MiniMax', description: 'MiniMax Anthropic-compatible endpoint' },
      { value: 'custom', label: 'Custom', description: 'Provide your own Anthropic-compatible base URL' },
    ],
    [],
  )
  const modelModeOptions = useMemo<ChoiceOption[]>(
    () => [
      {
        value: 'quick',
        label: 'Quick (recommended)',
        description: 'Use one model for haiku/sonnet/opus',
      },
      {
        value: 'advanced',
        label: 'Advanced',
        description: 'Pick separate models for each tier',
      },
    ],
    [],
  )
  const modelOptions = useMemo<ChoiceOption[]>(() => {
    const models = sessionState.availableModels || []
    return models.map((m) => ({ value: m, label: m }))
  }, [sessionState.availableModels])
  const selectedModelValue = useMemo(() => {
    if (sessionState.draft.modelMode === 'advanced' && sessionState.modelTier) {
      return sessionState.draft.tierModels[sessionState.modelTier] || undefined
    }
    return sessionState.draft.model || undefined
  }, [sessionState.draft.model, sessionState.draft.modelMode, sessionState.draft.tierModels, sessionState.modelTier])

  useEffect(() => {
    setProviderFocus((prev) => {
      const next = firstEnabledIndex(providerOptions)
      return Number.isFinite(prev) && prev >= 0 && prev < providerOptions.length ? prev : next
    })
  }, [providerOptions])

  useEffect(() => {
    setModelModeFocus((prev) => {
      const next = firstEnabledIndex(modelModeOptions)
      return Number.isFinite(prev) && prev >= 0 && prev < modelModeOptions.length ? prev : next
    })
  }, [modelModeOptions])

  useEffect(() => {
    setAnthropicVendorFocus((prev) => {
      const next = firstEnabledIndex(anthropicVendorOptions)
      return Number.isFinite(prev) && prev >= 0 && prev < anthropicVendorOptions.length ? prev : next
    })
  }, [anthropicVendorOptions])

  useEffect(() => {
    if (sessionState.step !== 'welcome') return
    void runNext()
  }, [runNext, sessionState.step])

  const onProviderSelect = useCallback(
    (value: string) => {
      session.setProvider(value as ProviderId)
      refresh()
      void runNext()
    },
    [refresh, runNext, session],
  )

  const onModelSelect = useCallback(
    (value: string) => {
      session.setModel(value)
      refresh()
      void runNext()
    },
    [refresh, runNext, session],
  )

  const onModelModeSelect = useCallback(
    (value: string) => {
      session.setModelMode(value === 'advanced' ? 'advanced' : 'quick')
      refresh()
      void runNext()
    },
    [refresh, runNext, session],
  )

  const onAnthropicVendorSelect = useCallback(
    (value: string) => {
      session.setAnthropicVendor(value as SetupAnthropicVendor)
      refresh()
      void runNext()
    },
    [refresh, runNext, session],
  )

  const startWrite = useCallback(() => {
    if (writing.status === 'running') return
    setWriting({ status: 'running', error: null })
    void (async () => {
      try {
        await onWrite(session.getState().draft)
        void session.next()
        void session.next()
        onDone()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!mountedRef.current) return
        setWriting({ status: 'error', error: msg })
        refresh()
      }
    })()
  }, [onDone, onWrite, refresh, session, writing.status])

  const step = sessionState.step
  const draft = sessionState.draft
  const stepRef = useRef(step)
  const testStatusRef = useRef(sessionState.test.status)
  const writingStatusRef = useRef(writing.status)
  stepRef.current = step
  testStatusRef.current = sessionState.test.status
  writingStatusRef.current = writing.status

  const handleProviderInput = useCallback(
    (input: string, key: any) => {
      if (providerOptions.length === 0) return
      if (key.downArrow) {
        setProviderFocus((idx) => nextIndex(providerOptions, idx, 1))
        return
      }
      if (key.upArrow) {
        setProviderFocus((idx) => nextIndex(providerOptions, idx, -1))
        return
      }
      if (input && /^[1-9]$/.test(input)) {
        const idx = Number.parseInt(input, 10) - 1
        if (idx >= 0 && idx < providerOptions.length) setProviderFocus(idx)
        return
      }
      if (key.return) {
        const opt = providerOptions[providerFocus]
        if (!opt || opt.disabled) return
        onProviderSelect(opt.value)
      }
    },
    [onProviderSelect, providerFocus, providerOptions],
  )

  const handleModelInput = useCallback(
    (input: string, key: any) => {
      if (modelOptions.length === 0) return
      if (key.downArrow) {
        setModelFocus((idx) => nextIndex(modelOptions, idx, 1))
        return
      }
      if (key.upArrow) {
        setModelFocus((idx) => nextIndex(modelOptions, idx, -1))
        return
      }
      if (input && /^[1-9]$/.test(input)) {
        const idx = Number.parseInt(input, 10) - 1
        if (idx >= 0 && idx < modelOptions.length) setModelFocus(idx)
        return
      }
      if (key.return) {
        const opt = modelOptions[modelFocus]
        if (!opt || opt.disabled) return
        onModelSelect(opt.value)
      }
    },
    [modelFocus, modelOptions, onModelSelect],
  )

  const handleAnthropicVendorInput = useCallback(
    (input: string, key: any) => {
      if (anthropicVendorOptions.length === 0) return
      if (key.downArrow) {
        setAnthropicVendorFocus((idx) => nextIndex(anthropicVendorOptions, idx, 1))
        return
      }
      if (key.upArrow) {
        setAnthropicVendorFocus((idx) => nextIndex(anthropicVendorOptions, idx, -1))
        return
      }
      if (input && /^[1-9]$/.test(input)) {
        const idx = Number.parseInt(input, 10) - 1
        if (idx >= 0 && idx < anthropicVendorOptions.length) setAnthropicVendorFocus(idx)
        return
      }
      if (key.return) {
        const opt = anthropicVendorOptions[anthropicVendorFocus]
        if (!opt || opt.disabled) return
        onAnthropicVendorSelect(opt.value)
      }
    },
    [anthropicVendorFocus, anthropicVendorOptions, onAnthropicVendorSelect],
  )

  const handleModelModeInput = useCallback(
    (input: string, key: any) => {
      if (modelModeOptions.length === 0) return
      if (key.downArrow) {
        setModelModeFocus((idx) => nextIndex(modelModeOptions, idx, 1))
        return
      }
      if (key.upArrow) {
        setModelModeFocus((idx) => nextIndex(modelModeOptions, idx, -1))
        return
      }
      if (input && /^[1-9]$/.test(input)) {
        const idx = Number.parseInt(input, 10) - 1
        if (idx >= 0 && idx < modelModeOptions.length) setModelModeFocus(idx)
        return
      }
      if (key.return) {
        const opt = modelModeOptions[modelModeFocus]
        if (!opt || opt.disabled) return
        onModelModeSelect(opt.value)
      }
    },
    [modelModeFocus, modelModeOptions, onModelModeSelect],
  )

  const handleConfirmInput = useCallback(
    (input: string, key: any) => {
      if (writing.status === 'running') return
      if (key.downArrow) setConfirmFocus((idx) => Math.min(1, idx + 1))
      if (key.upArrow) setConfirmFocus((idx) => Math.max(0, idx - 1))
      if (input === '1') setConfirmFocus(0)
      if (input === '2') setConfirmFocus(1)
      if (key.return) {
        if (confirmFocus === 0) startWrite()
        else goBack()
      }
    },
    [confirmFocus, goBack, startWrite, writing.status],
  )

  const handleTestInput = useCallback(
    (_input: string, key: any) => {
      if (sessionState.test.status === 'running') return
      if (key.return) void runNext()
    },
    [runNext, sessionState.test.status],
  )

  const handleBaseUrlInput = useCallback(
    (_input: string, _key: any) => {},
    [],
  )

  const handleApiKeyInput = useCallback(
    (_input: string, _key: any) => {},
    [],
  )

  useScopedInput(
    'wizard:setup',
    (input, key) => {
      const token = getInputToken({ input, key })

      const pendingEscapeTimer = escapeFallbackTimerRef.current
      if (pendingEscapeTimer && token) {
        clearTimeout(pendingEscapeTimer)
        escapeFallbackTimerRef.current = null
      }

      if (isCtrlChord({ input, key, chord: 'c' })) {
        onCancel()
        return
      }

      // Treat only a real/bare Esc keypress as cancel/back. Escape-prefixed
      // sequences (e.g. Shift+Tab in some terminals) must not trigger this.
      if (key.escape && !token) {
        const existing = escapeFallbackTimerRef.current
        if (existing) clearTimeout(existing)
        escapeFallbackTimerRef.current = setTimeout(() => {
          escapeFallbackTimerRef.current = null
          if (writingStatusRef.current === 'running') return
          if (stepRef.current === 'test' && testStatusRef.current === 'running') return
          if (stepRef.current === 'welcome' || stepRef.current === 'provider') onCancel()
          else goBack()
        }, 25)
        return
      }

      if (step === 'welcome') {
        return
      }

      if (step === 'provider') {
        handleProviderInput(input, key)
        return
      }

      if (step === 'anthropicVendor') {
        handleAnthropicVendorInput(input, key)
        return
      }

      if (step === 'baseUrl') {
        handleBaseUrlInput(input, key)
        return
      }

      if (step === 'apiKey') {
        handleApiKeyInput(input, key)
        return
      }

      if (step === 'test') {
        handleTestInput(input, key)
        return
      }

      if (step === 'modelMode') {
        handleModelModeInput(input, key)
        return
      }

      if (step === 'model') {
        handleModelInput(input, key)
        return
      }

      if (step === 'confirm') {
        handleConfirmInput(input, key)
      }
    },
  )

  useEffect(() => {
    if (step !== 'confirm') {
      setWriting({ status: 'idle', error: null })
      setConfirmFocus(0)
    }
  }, [step])

  return (
    <Box flexDirection="column">
      {step === 'welcome' ? (
        <WelcomeStep />
      ) : step === 'provider' ? (
        <ProviderStep
          options={providerOptions}
          focusedIndex={providerFocus}
          selectedValue={draft.provider || undefined}
          error={sessionState.error}
        />
      ) : step === 'anthropicVendor' ? (
        <AnthropicVendorStep
          options={anthropicVendorOptions}
          focusedIndex={anthropicVendorFocus}
          selectedValue={draft.anthropicVendor || undefined}
          error={sessionState.error}
        />
      ) : step === 'baseUrl' ? (
        <BaseUrlStep
          value={draft.baseUrl}
          placeholder={resolveBaseUrlPlaceholder({ provider: draft.provider, anthropicVendor: draft.anthropicVendor })}
          error={sessionState.error}
          onBack={goBack}
          onChange={(v) => {
            session.setBaseUrl(v)
            refresh()
          }}
          onSubmit={() => void runNext()}
        />
      ) : step === 'apiKey' ? (
        <ApiKeyStep
          value={draft.apiKey}
          error={sessionState.error}
          onBack={goBack}
          onChange={(v) => {
            session.setApiKey(v)
            refresh()
          }}
          onSubmit={() => void runNext()}
        />
      ) : step === 'test' ? (
        <TestStep
          provider={draft.provider}
          baseUrl={draft.baseUrl}
          status={sessionState.test.status}
          lastError={sessionState.test.lastError}
          onBack={goBack}
          onRetry={runNext}
        />
      ) : step === 'modelMode' ? (
        <ModelModeStep
          options={modelModeOptions}
          focusedIndex={modelModeFocus}
          selectedValue={draft.modelMode}
          error={sessionState.error}
        />
      ) : step === 'model' ? (
        <ModelStep
          options={modelOptions}
          focusedIndex={modelFocus}
          mode={draft.modelMode}
          tier={sessionState.modelTier}
          selectedValue={selectedModelValue}
          error={sessionState.error}
          onBack={goBack}
          onEnsureSelected={(value) => {
            session.setModel(value)
            refresh()
          }}
        />
      ) : step === 'confirm' ? (
        <ConfirmStep
          draft={draft}
          currentTier={sessionState.modelTier}
          focusIndex={confirmFocus}
          writing={writing}
          onBack={goBack}
          onConfirm={startWrite}
        />
      ) : (
        <FallbackStep />
      )}
    </Box>
  )
}

function toProviderOptions(providers: SetupProviderOption[]): ChoiceOption[] {
  return providers.map((p) => ({
    value: p.id,
    label: p.label,
    description: p.description,
    disabled: Boolean(p.disabled),
  }))
}

function WelcomeStep(): React.ReactNode {
  const theme = getTheme()
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold color={theme.text}>
        Formax Setup
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.secondaryText}>This wizard will help you configure your LLM provider and save credentials.</Text>
        <Text color={theme.secondaryText}>Nothing is sent until you confirm and the connection test runs.</Text>
      </Box>
      <Box marginTop={2}>
        <Text color={theme.secondaryText}>Press </Text>
        <Text bold>Enter</Text>
        <Text color={theme.secondaryText}> to begin · </Text>
        <Text bold>Esc</Text>
        <Text color={theme.secondaryText}> to cancel</Text>
      </Box>
    </Box>
  )
}

function ProviderStep({
  options,
  focusedIndex,
  selectedValue,
  error,
}: {
  options: ChoiceOption[]
  focusedIndex: number
  selectedValue?: string
  error: string | null
}): React.ReactNode {
  const theme = getTheme()
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Box marginTop={1}>
        <Text bold>Select provider protocol</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Nothing is sent until connection test runs.</Text>
      </Box>
      <Box marginTop={1}>
        <Text bold>Select a provider</Text>
      </Box>
      <Box marginTop={1}>
        <ChoiceListView options={options} focusedIndex={focusedIndex} selectedValue={selectedValue} />
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error}>Error: {error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>↑↓ to navigate · Enter to select · Esc to cancel</Text>
      </Box>
    </Box>
  )
}

function AnthropicVendorStep({
  options,
  focusedIndex,
  selectedValue,
  error,
}: {
  options: ChoiceOption[]
  focusedIndex: number
  selectedValue?: string
  error: string | null
}): React.ReactNode {
  const theme = getTheme()
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>Select Anthropic-compatible provider</Text>
      <Box marginTop={1}>
        <ChoiceListView options={options} focusedIndex={focusedIndex} selectedValue={selectedValue} />
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error}>Error: {error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>↑↓ to navigate · Enter to select · Esc to go back</Text>
      </Box>
    </Box>
  )
}

function BaseUrlStep({
  value,
  placeholder,
  error,
  onBack,
  onChange,
  onSubmit,
}: {
  value: string
  placeholder: string
  error: string | null
  onBack: () => void
  onChange: (v: string) => void
  onSubmit: () => void
}): React.ReactNode {
  const theme = getTheme()
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>Base URL</Text>
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Enter the API base URL for your provider.</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>› </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          focus
          scope="wizard:setup"
        />
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error}>Error: {error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Enter to continue · Esc to go back</Text>
      </Box>
    </Box>
  )
}

function ApiKeyStep({
  value,
  error,
  onBack,
  onChange,
  onSubmit,
}: {
  value: string
  error: string | null
  onBack: () => void
  onChange: (v: string) => void
  onSubmit: () => void
}): React.ReactNode {
  const theme = getTheme()
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>API Key</Text>
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Paste your API key. It will be saved to </Text>
        <Text color={theme.secondaryText} bold>
          auth.json
        </Text>
        <Text color={theme.secondaryText}>.</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>› </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder="sk-…"
          mask="•"
          focus
          scope="wizard:setup"
        />
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error}>Error: {error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Enter to test connection · Esc to go back</Text>
      </Box>
    </Box>
  )
}

function TestStep({
  provider,
  baseUrl,
  status,
  lastError,
  onRetry,
  onBack,
}: {
  provider: ProviderId | null
  baseUrl: string
  status: 'idle' | 'running' | 'error'
  lastError: { ok: false; code: ErrorCodeValue; message: string } | { ok: true; models: string[] } | null
  onRetry: () => Promise<void>
  onBack: () => void
}): React.ReactNode {
  const theme = getTheme()
  const err = lastError && 'code' in lastError ? lastError : null
  const hint =
    err && provider
      ? getConnectionTestHint({
          provider,
          baseUrl,
          error: { ok: false, code: err.code, message: err.message },
        })
      : null

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>Testing connection</Text>
      <Box marginTop={1}>
        {status === 'running' ? (
          <LoadingStatusLine text="Testing" />
        ) : err ? (
          <Text color={theme.error}>Failed: {err.message}</Text>
        ) : (
          <Text color={theme.secondaryText}>Press Enter to run the connection test.</Text>
        )}
      </Box>

      {status !== 'running' && hint ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.secondaryText}>{hint.title}:</Text>
          {hint.lines.map((line) => (
            <Text key={line} color={theme.secondaryText}>
              - {line}
            </Text>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>
          {status === 'running' ? 'Running…' : 'Enter to retry · Esc to go back'}
        </Text>
      </Box>
    </Box>
  )
}

function ModelModeStep({
  options,
  focusedIndex,
  selectedValue,
  error,
}: {
  options: ChoiceOption[]
  focusedIndex: number
  selectedValue?: string
  error: string | null
}): React.ReactNode {
  const theme = getTheme()
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>Choose model setup mode</Text>
      <Box marginTop={1}>
        <ChoiceListView options={options} focusedIndex={focusedIndex} selectedValue={selectedValue} />
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error}>Error: {error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>↑↓ to navigate · Enter to select · Esc to go back</Text>
      </Box>
    </Box>
  )
}

function ModelStep({
  options,
  focusedIndex,
  mode,
  tier,
  selectedValue,
  error,
  onBack,
  onEnsureSelected,
}: {
  options: ChoiceOption[]
  focusedIndex: number
  mode: 'quick' | 'advanced'
  tier: ModelTier | null
  selectedValue?: string
  error: string | null
  onBack: () => void
  onEnsureSelected: (value: string) => void
}): React.ReactNode {
  const theme = getTheme()

  useEffect(() => {
    if (selectedValue) return
    const first = options[0]?.value
    if (first) onEnsureSelected(first)
  }, [onEnsureSelected, options, selectedValue])

  const title =
    mode === 'quick'
      ? 'Select model for quick mode'
      : `Select model for ${tier || 'current tier'}`

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>{title}</Text>
      {mode === 'quick' ? (
        <Box marginTop={1}>
          <Text color={theme.secondaryText}>This selection will be used for haiku, sonnet, and opus.</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        {options.length ? (
          <ChoiceListView
            options={options}
            focusedIndex={Math.min(focusedIndex, options.length - 1)}
            selectedValue={selectedValue}
            maxVisibleRows={20}
          />
        ) : (
          <Text color={theme.secondaryText}>No models found.</Text>
        )}
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error}>Error: {error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>↑↓ to navigate · Enter to select · Esc to go back</Text>
      </Box>
    </Box>
  )
}

function ConfirmStep({
  draft,
  currentTier,
  focusIndex,
  writing,
  onBack,
  onConfirm,
}: {
  draft: SetupDraft
  currentTier: ModelTier | null
  focusIndex: number
  writing: { status: 'idle' | 'running' | 'error'; error: string | null }
  onBack: () => void
  onConfirm: () => void
}): React.ReactNode {
  const theme = getTheme()

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>Review your settings</Text>

      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color={theme.secondaryText}>Provider: </Text>
          {draft.provider || ''}
        </Text>
        <Text>
          <Text color={theme.secondaryText}>Base URL: </Text>
          {draft.baseUrl}
        </Text>
        <Text>
          <Text color={theme.secondaryText}>Model: </Text>
          {draft.model}
        </Text>
        <Text>
          <Text color={theme.secondaryText}>Mode: </Text>
          {draft.modelMode === 'quick' ? 'Quick (recommended)' : 'Advanced'}
        </Text>
        <Text>
          <Text color={theme.secondaryText}>Haiku: </Text>
          {draft.tierModels.haiku}
        </Text>
        <Text>
          <Text color={theme.secondaryText}>Sonnet: </Text>
          {draft.tierModels.sonnet}
        </Text>
        <Text>
          <Text color={theme.secondaryText}>Opus: </Text>
          {draft.tierModels.opus}
        </Text>
        {currentTier ? (
          <Text>
            <Text color={theme.secondaryText}>Editing tier: </Text>
            {currentTier}
          </Text>
        ) : null}
      </Box>

      <Box marginTop={2} flexDirection="column">
        <Text>
          <Text color={theme.secondaryText}>{focusIndex === 0 ? '❯ ' : '  '}</Text>
          <Text color={focusIndex === 0 ? theme.text : theme.secondaryText} bold={focusIndex === 0}>
            Save and start REPL
          </Text>
        </Text>
        <Text>
          <Text color={theme.secondaryText}>{focusIndex === 1 ? '❯ ' : '  '}</Text>
          <Text color={focusIndex === 1 ? theme.text : theme.secondaryText} bold={focusIndex === 1}>
            Back
          </Text>
        </Text>
      </Box>

      {writing.status === 'running' ? (
        <Box marginTop={1}>
          <LoadingStatusLine text="Writing" />
        </Box>
      ) : null}

      {writing.status === 'error' && writing.error ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.error}>Write failed: {writing.error}</Text>
          <Text color={theme.secondaryText}>Fix the issue and press Enter to retry.</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>↑↓ to choose · Enter to confirm · Esc to go back</Text>
      </Box>
    </Box>
  )
}

function FallbackStep(): React.ReactNode {
  const theme = getTheme()
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text color={theme.secondaryText}>Preparing…</Text>
    </Box>
  )
}
