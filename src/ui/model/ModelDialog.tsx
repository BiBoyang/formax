import React, { useMemo, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { ApprovalHeader } from '../../components/ui/ApprovalHeader.js'
import { LoadingStatusLine } from '../../components/ui/LoadingStatusLine.js'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext.js'
import { consumeBufferedArrow } from '../../features/repl/keys/escapeSequences.js'
import { getInputToken, getVerticalArrowKeyDelta, isReturnKeyToken } from '../../features/repl/keys/keyTokens.js'
import { getTheme } from '../../utils/theme.js'
import type { ModelTier } from '../../env/modelTier.js'

const MODEL_SCOPE = 'overlay:model' as const

type ModelOption = {
  id: 'default' | 'opus' | 'haiku'
  tier: ModelTier
  title: string
  subtitle: string
}

type ModelByTier = Record<ModelTier, string>

export type ModelDialogApplyResult = {
  effectiveTier: ModelTier
}

export type ModelDialogExit =
  | { kind: 'dismissed' }
  | { kind: 'changed'; message: string }

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

function currentOptionId(tier: ModelTier): ModelOption['id'] {
  if (tier === 'sonnet') return 'default'
  return tier
}

function formatChangedMessage(args: {
  selectedOption: ModelOption
  result: ModelDialogApplyResult
}): string {
  const selectedLabel = args.selectedOption.id === 'default' ? 'Default' : args.selectedOption.id
  if (args.result.effectiveTier !== args.selectedOption.tier) {
    return [
      `Saved global model selection: ${selectedLabel}`,
      `Current effective tier: ${args.result.effectiveTier}`,
      'Hint: project-level .formax/config.json is overriding global tier.',
    ].join('\n')
  }
  return `Set model to ${selectedLabel}`
}

export function ModelDialog(args: {
  currentTier: ModelTier
  modelByTier: ModelByTier
  onApplyTier: (next: ModelTier) => Promise<ModelDialogApplyResult>
  onExit: (exit: ModelDialogExit) => void
}): React.ReactNode {
  useScopeActivation(MODEL_SCOPE)
  const theme = useMemo(() => getTheme(), [])
  const options = useMemo<ModelOption[]>(
    () => [
      {
        id: 'default',
        tier: 'sonnet',
        title: 'Default (recommended)',
        subtitle: `Use the default model (currently ${args.modelByTier.sonnet})`,
      },
      {
        id: 'opus',
        tier: 'opus',
        title: 'Opus',
        subtitle: `${args.modelByTier.opus} · Most capable for complex work`,
      },
      {
        id: 'haiku',
        tier: 'haiku',
        title: 'Haiku',
        subtitle: `${args.modelByTier.haiku} · Fastest for quick answers`,
      },
    ],
    [args.modelByTier.haiku, args.modelByTier.opus, args.modelByTier.sonnet],
  )
  const initialSelectedId = currentOptionId(args.currentTier)
  const initialIndex = Math.max(
    0,
    options.findIndex((o) => o.id === initialSelectedId),
  )
  const [cursor, setCursor] = useState(initialIndex)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const escapeBufferRef = useRef('')
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor

  useScopedInput(MODEL_SCOPE, (input, key) => {
    const token = getInputToken({ input, key })
    const keyDelta = getVerticalArrowKeyDelta(key)
    const hasArrowKeyDelta = keyDelta !== 0

    let bufferedDelta = 0
    if (!hasArrowKeyDelta && token) {
      const res = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
      escapeBufferRef.current = res.nextBuffer
      bufferedDelta = res.delta
    }

    const delta = keyDelta !== 0 ? keyDelta : bufferedDelta

    if (key.escape && !token) {
      escapeBufferRef.current = ''
      if (!saving) args.onExit({ kind: 'dismissed' })
      return
    }

    if (saving) return

    if (delta !== 0) {
      const next = clamp(cursorRef.current + delta, 0, options.length - 1)
      cursorRef.current = next
      setCursor(next)
      return
    }

    if (!isReturnKeyToken({ token, key })) return
    const option = options[cursorRef.current]!
    setSaving(true)
    setError(null)
    void args
      .onApplyTier(option.tier)
      .then((result) => {
        args.onExit({ kind: 'changed', message: formatChangedMessage({ selectedOption: option, result }) })
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        setSaving(false)
      })
  })

  const selectedId = currentOptionId(args.currentTier)

  return (
    <Box flexDirection="column">
      <ApprovalHeader title="Select model" />
      <Text>Switch between model tiers. Applies to this session and future Formax sessions.</Text>
      <Text color={theme.secondaryText}>For custom model IDs, configure tier mapping in settings.</Text>
      <Box marginTop={1} flexDirection="column">
        {options.map((option, idx) => {
          const focused = idx === cursor
          const checked = option.id === selectedId
          const rowColor = focused ? theme.permission : checked ? theme.success : theme.text
          return (
            <Text key={option.id}>
              <Text color={focused ? theme.permission : theme.secondaryText}>{focused ? '❯ ' : '  '}</Text>
              <Text color={rowColor} dimColor>
                {`${idx + 1}. `}
              </Text>
              <Text color={rowColor}>{option.title}</Text>
              <Text color={theme.secondaryText}>  {option.subtitle}</Text>
              {checked ? <Text color={theme.success}> ✔</Text> : null}
            </Text>
          )
        })}
      </Box>
      {saving ? (
        <Box marginTop={1}>
          <LoadingStatusLine text="Updating model" />
        </Box>
      ) : null}
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error}>Error: {error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>
          <Text italic>{saving ? 'Applying selection…' : 'Enter to confirm · Esc to exit'}</Text>
        </Text>
      </Box>
    </Box>
  )
}

export const __modelDialogTestHooks = {
  clamp,
  currentOptionId,
  formatChangedMessage,
}
