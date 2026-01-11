import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { getTheme } from '../utils/theme.js'
import { LoadingStatusLine } from '../components/ui/LoadingStatusLine.js'
import TextInput from '../components/ui/TextInput.js'
import { createSetupSession } from '../core/setup/session.js'
import type { ConnectionTester, SetupSession } from '../core/setup/session.js'
import type { SetupDraft, SetupProviderOption } from '../core/setup/types.js'
import type { ProviderId } from '../core/config/schema.js'

type ChoiceOption = {
  label: string
  description?: string
  value: string
  disabled?: boolean
}

function firstEnabledIndex(options: ChoiceOption[]): number {
  const idx = options.findIndex((o) => !o.disabled)
  return idx >= 0 ? idx : 0
}

function nextEnabledIndex(options: ChoiceOption[], from: number, dir: 1 | -1): number {
  if (options.length === 0) return 0
  let i = from
  for (let step = 0; step < options.length; step++) {
    i = (i + dir + options.length) % options.length
    if (!options[i]?.disabled) return i
  }
  return from
}

function ChoiceList({
  options,
  focusedIndex,
  selectedValue,
  onFocus,
  onSelect,
}: {
  options: ChoiceOption[]
  focusedIndex: number
  selectedValue?: string
  onFocus: (nextIndex: number) => void
  onSelect: (value: string) => void
}): React.ReactNode {
  const theme = getTheme()

  useInput((_input, key) => {
    if (options.length === 0) return
    if (key.downArrow) onFocus(nextEnabledIndex(options, focusedIndex, 1))
    if (key.upArrow) onFocus(nextEnabledIndex(options, focusedIndex, -1))
    if (key.return) {
      const opt = options[focusedIndex]
      if (!opt || opt.disabled) return
      onSelect(opt.value)
    }
  })

  return (
    <Box flexDirection="column">
      {options.map((opt, i) => {
        const focused = i === focusedIndex
        const selected = selectedValue === opt.value
        const prefix = focused ? '❯ ' : '  '
        const labelColor = opt.disabled ? theme.secondaryText : focused ? theme.text : selected ? theme.success : theme.text

        return (
          <Box key={opt.value} flexDirection="column" marginBottom={opt.description ? 1 : 0}>
            <Text>
              <Text color={theme.secondaryText}>{prefix}</Text>
              <Text color={labelColor} bold={focused || selected}>
                {opt.label}
              </Text>
              {selected ? <Text color={theme.success}> ✓</Text> : null}
              {opt.disabled ? <Text color={theme.secondaryText}> (coming soon)</Text> : null}
            </Text>
            {opt.description ? (
              <Box marginLeft={4}>
                <Text color={theme.secondaryText}>{opt.description}</Text>
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
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
  const sessionRef = useRef<SetupSession | null>(null)
  if (!sessionRef.current) {
    sessionRef.current = createSetupSession({ providers, testConnection })
  }
  const session = sessionRef.current

  const mountedRef = useRef(true)
  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const [sessionState, setSessionState] = useState(() => session.getState())
  const [providerFocus, setProviderFocus] = useState(0)
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

  useInput((_input, key) => {
    if (key.escape) onCancel()
  })

  const providerOptions = useMemo(() => toProviderOptions(providers), [providers])
  const modelOptions = useMemo<ChoiceOption[]>(() => {
    const models = sessionState.availableModels || []
    return models.map((m) => ({ value: m, label: m }))
  }, [sessionState.availableModels])

  useEffect(() => {
    setProviderFocus((prev) => {
      const next = firstEnabledIndex(providerOptions)
      return Number.isFinite(prev) && prev >= 0 && prev < providerOptions.length ? prev : next
    })
  }, [providerOptions])

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

  useEffect(() => {
    if (step !== 'confirm') {
      setWriting({ status: 'idle', error: null })
      setConfirmFocus(0)
    }
  }, [step])

  return (
    <Box flexDirection="column">
      {step === 'welcome' ? (
        <WelcomeStep onNext={runNext} />
      ) : step === 'provider' ? (
        <ProviderStep
          options={providerOptions}
          focusedIndex={providerFocus}
          selectedValue={draft.provider || undefined}
          error={sessionState.error}
          onFocus={setProviderFocus}
          onSelect={onProviderSelect}
        />
      ) : step === 'baseUrl' ? (
        <BaseUrlStep
          value={draft.baseUrl}
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
          status={sessionState.test.status}
          lastError={sessionState.test.lastError}
          onBack={goBack}
          onRetry={runNext}
        />
      ) : step === 'model' ? (
        <ModelStep
          options={modelOptions}
          focusedIndex={modelFocus}
          selectedValue={draft.model || undefined}
          error={sessionState.error}
          onFocus={setModelFocus}
          onSelect={onModelSelect}
          onBack={goBack}
          onEnsureSelected={(value) => {
            session.setModel(value)
            refresh()
          }}
        />
      ) : step === 'confirm' ? (
        <ConfirmStep
          draft={draft}
          focusIndex={confirmFocus}
          writing={writing}
          onFocus={setConfirmFocus}
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

function WelcomeStep({ onNext }: { onNext: () => Promise<void> }): React.ReactNode {
  const theme = getTheme()
  useInput((_input, key) => {
    if (key.return) void onNext()
  })

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
  onFocus,
  onSelect,
}: {
  options: ChoiceOption[]
  focusedIndex: number
  selectedValue?: string
  error: string | null
  onFocus: (idx: number) => void
  onSelect: (value: string) => void
}): React.ReactNode {
  const theme = getTheme()
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>Select a provider</Text>
      <Box marginTop={1}>
        <ChoiceList options={options} focusedIndex={focusedIndex} selectedValue={selectedValue} onFocus={onFocus} onSelect={onSelect} />
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error}>Error: {error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Up/Down to navigate · Enter to select · Esc to cancel</Text>
      </Box>
    </Box>
  )
}

function BaseUrlStep({
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
  useInput((_input, key) => {
    if (key.tab && key.shift) onBack()
  })

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>Base URL</Text>
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Enter the API base URL for your provider.</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>› </Text>
        <TextInput value={value} onChange={onChange} onSubmit={onSubmit} placeholder="https://api.anthropic.com/v1" focus />
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error}>Error: {error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Enter to continue · Shift+Tab to go back · Esc to cancel</Text>
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
  useInput((_input, key) => {
    if (key.tab && key.shift) onBack()
  })

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
        <TextInput value={value} onChange={onChange} onSubmit={onSubmit} placeholder="sk-…" mask="•" focus />
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error}>Error: {error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Enter to test connection · Shift+Tab to go back · Esc to cancel</Text>
      </Box>
    </Box>
  )
}

function TestStep({
  status,
  lastError,
  onRetry,
  onBack,
}: {
  status: 'idle' | 'running' | 'error'
  lastError: { ok: false; code: string; message: string } | { ok: true; models: string[] } | null
  onRetry: () => Promise<void>
  onBack: () => void
}): React.ReactNode {
  const theme = getTheme()
  useInput((_input, key) => {
    if (status === 'running') return
    if (key.tab && key.shift) onBack()
    if (key.return) void onRetry()
  })

  const err = lastError && 'code' in lastError ? lastError : null

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
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>
          {status === 'running' ? 'Running…' : 'Enter to retry · Shift+Tab to go back · Esc to cancel'}
        </Text>
      </Box>
    </Box>
  )
}

function ModelStep({
  options,
  focusedIndex,
  selectedValue,
  error,
  onFocus,
  onSelect,
  onBack,
  onEnsureSelected,
}: {
  options: ChoiceOption[]
  focusedIndex: number
  selectedValue?: string
  error: string | null
  onFocus: (idx: number) => void
  onSelect: (value: string) => void
  onBack: () => void
  onEnsureSelected: (value: string) => void
}): React.ReactNode {
  const theme = getTheme()

  useEffect(() => {
    if (selectedValue) return
    const first = options[0]?.value
    if (first) onEnsureSelected(first)
  }, [onEnsureSelected, options, selectedValue])

  useInput((_input, key) => {
    if (key.tab && key.shift) onBack()
  })

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>Select a model</Text>
      <Box marginTop={1}>
        {options.length ? (
          <ChoiceList options={options} focusedIndex={Math.min(focusedIndex, options.length - 1)} selectedValue={selectedValue} onFocus={onFocus} onSelect={onSelect} />
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
        <Text color={theme.secondaryText}>Up/Down to navigate · Enter to select · Shift+Tab to go back · Esc to cancel</Text>
      </Box>
    </Box>
  )
}

function ConfirmStep({
  draft,
  focusIndex,
  writing,
  onFocus,
  onBack,
  onConfirm,
}: {
  draft: SetupDraft
  focusIndex: number
  writing: { status: 'idle' | 'running' | 'error'; error: string | null }
  onFocus: (idx: number) => void
  onBack: () => void
  onConfirm: () => void
}): React.ReactNode {
  const theme = getTheme()

  useInput((_input, key) => {
    if (writing.status === 'running') return
    if (key.downArrow) onFocus(Math.min(1, focusIndex + 1))
    if (key.upArrow) onFocus(Math.max(0, focusIndex - 1))
    if (key.tab && key.shift) onBack()
    if (key.return) {
      if (focusIndex === 0) onConfirm()
      else onBack()
    }
  })

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
        <Text color={theme.secondaryText}>Up/Down to choose · Enter to confirm · Shift+Tab to go back · Esc to cancel</Text>
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
