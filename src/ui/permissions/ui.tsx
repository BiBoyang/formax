import React, { useRef } from 'react'
import { Box, Text } from 'ink'
import type { Theme } from '../../utils/theme.js'
import { KeyHintBar } from '../../components/ui/KeyHintBar.js'
import { OverlayFrame } from '../../components/ui/OverlayFrame.js'
import { SelectList } from '../../components/ui/SelectList.js'
import TextInput from '../../components/ui/TextInput.js'
import type { PermissionTab } from './constants.js'
import { PERMISSION_TABS } from './constants.js'

const MAX_LIST_ROWS = 10

const CONFIRM_CHOICES: Array<{ key: string; label: string }> = [
  { key: 'yes', label: 'Yes' },
  { key: 'no', label: 'No' },
]

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

export function DialogFrame({
  theme,
  children,
}: {
  theme: Theme
  children: React.ReactNode
}): React.ReactNode {
  return (
    <OverlayFrame borderStyle="round" borderColor={theme.permission} flexDirection="column" paddingX={1} width="100%">
      {children}
    </OverlayFrame>
  )
}

export function FooterHint({ theme, text }: { theme: Theme; text: string }): React.ReactNode {
  return <KeyHintBar text={text} color={theme.secondaryText} marginLeft={1} marginTop={0} />
}

export function TabsBar({
  theme,
  activeTab,
}: {
  theme: Theme
  activeTab: PermissionTab
}): React.ReactNode {
  const description = (() => {
    switch (activeTab) {
      case 'allow':
        return "Claude Code won't ask before using allowed tools."
      case 'ask':
        return 'Claude Code will always ask for confirmation before using these tools.'
      case 'deny':
        return 'Claude Code will always reject requests to use denied tools.'
      case 'workspace':
        return 'Claude Code can read files in the workspace, and make edits when auto-accept edits is on.'
      default:
        return ''
    }
  })()

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color={theme.permission}>Permissions: </Text>
        {PERMISSION_TABS.map((tab) => {
          const active = tab.key === activeTab
          if (active) {
            return (
              <Text key={tab.key} backgroundColor={theme.permission} color="black">
                {' '}
                {tab.label}{' '}
              </Text>
            )
          }

          return (
            <Text key={tab.key}>
              {' '}
              {tab.label}{' '}
            </Text>
          )
        })}
        <Text color={theme.secondaryText}> (tab to cycle)</Text>
      </Text>
      <Box>
        <Text>{description}</Text>
      </Box>
    </Box>
  )
}

export function SearchRow({
  query,
  onChange,
  scope,
}: {
  query: string
  onChange: (value: string) => void
  scope: any
}): React.ReactNode {
  return (
    <Box>
      <Text>Search: </Text>
      <TextInput value={query} onChange={onChange} cursorStyle="bar" reservedChars={['/']} scope={scope} />
    </Box>
  )
}

export function ListView({
  theme,
  items,
  cursor,
}: {
  theme: Theme
  items: Array<{ key: string; label: string }>
  cursor: number
}): React.ReactNode {
  const fingerprint = `${items.length}:${items[0]?.key ?? ''}:${items[items.length - 1]?.key ?? ''}`
  const lastFingerprintRef = useRef(fingerprint)
  const scrollTopRef = useRef(0)

  if (lastFingerprintRef.current !== fingerprint) {
    lastFingerprintRef.current = fingerprint
    scrollTopRef.current = 0
  }

  const maxVisible = MAX_LIST_ROWS
  const maxTop = Math.max(0, items.length - maxVisible)

  let top = clamp(scrollTopRef.current, 0, maxTop)

  if (cursor <= 0) top = 0
  if (cursor < top) top = cursor
  if (cursor > top + maxVisible - 1) top = cursor - (maxVisible - 1)
  top = clamp(top, 0, maxTop)

  scrollTopRef.current = top

  const visible = items.slice(top, top + maxVisible)
  const hasMoreAbove = top > 0
  const hasMoreBelow = top + maxVisible < items.length
  const numberWidth = String(top + visible.length).length

  return (
    <Box flexDirection="column">
      {visible.map((item, i) => {
        const absIndex = top + i
        const active = absIndex === cursor

        const prefix = active
          ? '❯ '
          : i === 0 && hasMoreAbove
            ? '↑ '
            : i === visible.length - 1 && hasMoreBelow
              ? '↓ '
              : '  '

        const number = `${String(absIndex + 1).padStart(numberWidth, ' ')}. `
        const color = active ? theme.permission : theme.text

        return (
          <Text key={item.key} color={color}>
            {prefix}
            <Text color={theme.secondaryText}>{number}</Text>
            {item.label}
          </Text>
        )
      })}
    </Box>
  )
}

export function ConfirmDeleteView({
  theme,
  title,
  details,
  prompt,
  cursor,
}: {
  theme: Theme
  title: string
  details?: React.ReactNode
  prompt: string
  cursor: 0 | 1
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text color={theme.error} bold>
        {title}
      </Text>
      {details ? <Box marginTop={1}>{details}</Box> : null}
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>{prompt}</Text>
      </Box>
      <Box marginTop={1}>
        <SelectList
          items={CONFIRM_CHOICES}
          cursor={cursor}
          accentColor={theme.error}
          mutedColor={theme.text}
          disabledColor={theme.secondaryText}
          activePrefix="❯ "
          inactivePrefix="  "
          showNumbers
        />
      </Box>
    </Box>
  )
}

export function SaveScopeView({
  theme,
  title,
  items,
  cursor,
}: {
  theme: Theme
  title: string
  items: Array<{ key: string; label: string }>
  cursor: number
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text>{title}</Text>
      <Box marginTop={1}>
        <SelectList
          items={items}
          cursor={cursor}
          accentColor={theme.permission}
          mutedColor={theme.text}
          disabledColor={theme.secondaryText}
          activePrefix="❯ "
          inactivePrefix="  "
          showNumbers
        />
      </Box>
    </Box>
  )
}

export function TextEntryView({
  theme,
  title,
  value,
  onChange,
  onSubmit,
  scope,
  placeholder,
}: {
  theme: Theme
  title: string
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  scope: any
  placeholder?: string
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text>{title}</Text>
      <Box marginTop={1}>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder ?? ''}
          cursorStyle="bar"
          scope={scope}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Enter to submit · Esc to go back</Text>
      </Box>
    </Box>
  )
}

export function WorkspaceRootsView({
  theme,
  roots,
}: {
  theme: Theme
  roots: Array<{ label: string }>
}): React.ReactNode {
  if (roots.length === 0) return null
  return (
    <Box flexDirection="column">
      {roots.map((r, idx) => (
        <Box key={`${r.label}-${idx}`} width="100%">
          <Text color={theme.secondaryText}>- </Text>
          <Text color={theme.secondaryText}>{r.label}</Text>
        </Box>
      ))}
    </Box>
  )
}

export const __permissionsUiTestHooks = {
  clamp,
}
