import React, { useRef } from 'react'
import { Box, Text } from 'ink'
import type { Theme } from '../theme.js'
import type { ConfigRow, ConfigTab, OutputStyleOption } from './constants.js'
import { TABS } from './constants.js'

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

function terminalColumns(min = 40): number {
  return Math.max(process.stdout.columns || 80, min)
}

export function ConfigDialogFrame({
  theme,
  children,
}: {
  theme: Theme
  children: React.ReactNode
}): React.ReactNode {
  return (
    <Box flexDirection="column" width="100%">
      <Text color={theme.permission} dimColor>
        {'─'.repeat(terminalColumns())}
      </Text>
      <Box flexDirection="column" width="100%" marginLeft={1}>
        {children}
      </Box>
    </Box>
  )
}

export function FooterHint({ theme, text }: { theme: Theme; text: string }): React.ReactNode {
  return (
    <Box marginTop={1}>
      <Text color={theme.secondaryText}>{text}</Text>
    </Box>
  )
}

export function ConfigTabsBar({
  theme,
  activeTab,
}: {
  theme: Theme
  activeTab: ConfigTab
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color={theme.permission}>
          Settings:{' '}
        </Text>
        {TABS.map((tab) => {
          const label = tab.charAt(0).toUpperCase() + tab.slice(1)
          const active = tab === activeTab

          if (active) {
            return (
              <Text key={tab} backgroundColor={theme.permission} color="black" bold>
                {' '}
                {label}{' '}
              </Text>
            )
          }

          return (
            <Text key={tab}>
              {' '}
              {label}{' '}
            </Text>
          )
        })}
        <Text color={theme.secondaryText}> (tab to cycle)</Text>
      </Text>
      <Box height={1} />
    </Box>
  )
}

export function SettingsListView({
  theme,
  rows,
  cursor,
}: {
  theme: Theme
  rows: Array<{ row: ConfigRow; value: string | boolean; sourceLabel: string }>
  cursor: number
}): React.ReactNode {
  const maxVisible = 15
  const fingerprint = `${rows.length}:${rows[0]?.row.id ?? ''}:${rows[rows.length - 1]?.row.id ?? ''}`
  const lastFingerprintRef = useRef(fingerprint)
  const scrollTopRef = useRef(0)

  if (lastFingerprintRef.current !== fingerprint) {
    lastFingerprintRef.current = fingerprint
    scrollTopRef.current = 0
  }

  const maxTop = Math.max(0, rows.length - maxVisible)
  let top = clamp(scrollTopRef.current, 0, maxTop)

  if (cursor <= 0) top = 0
  if (cursor < top) top = cursor
  if (cursor > top + maxVisible - 1) top = cursor - (maxVisible - 1)
  top = clamp(top, 0, maxTop)

  scrollTopRef.current = top
  const visibleRows = rows.slice(top, top + maxVisible)

  return (
    <Box flexDirection="column" width="100%">
      <Text>Configure Formax preferences</Text>
      <Box height={1} />
      {visibleRows.map((item, idx) => {
        const absIndex = top + idx
        const active = absIndex === cursor
        const prefix = active ? ' ❯ ' : '   '
        const color = active ? theme.permission : theme.text

        return (
          <Box key={item.row.id} flexDirection="row">
            <Box width={48} flexDirection="row">
              <Text color={color}>
                {prefix}
                {item.row.label}
              </Text>
            </Box>
            <Box flexGrow={1} flexDirection="row">
              <Text color={color}>{String(item.value)}</Text>
              <Text color={theme.secondaryText}> ({item.sourceLabel})</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

export function OutputStyleSelectionView({
  theme,
  options,
  cursor,
  currentStyleId,
}: {
  theme: Theme
  options: OutputStyleOption[]
  cursor: number
  currentStyleId: string
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text color={theme.permission} bold>
        Preferred output style
      </Text>
      <Box height={2} />
      <Text color={theme.secondaryText}>This changes how Formax communicates with you</Text>
      <Box height={1} />

      <Box flexDirection="column">
        {options.map((opt, idx) => {
          const active = idx === cursor
          const selected = opt.id === currentStyleId
          const arrow = active ? ' ❯ ' : '   '

          return (
            <Box key={opt.id} flexDirection="row">
              <Box width={19}>
                <Text>
                  <Text color={theme.permission}>{arrow}</Text>
                  <Text color={selected ? theme.success : active ? theme.permission : theme.text}>
                    {idx + 1}. {opt.label}
                  </Text>
                </Text>
              </Box>
              <Box flexGrow={1}>
                <Text color={theme.secondaryText}>{opt.description}</Text>
              </Box>
              <Text color={theme.success}>{selected ? '✔' : ''}</Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

export function StatusView({ theme }: { theme: Theme }): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text color={theme.permission} bold>
        Status
      </Text>
      <Box height={1} />
      <Text color={theme.secondaryText}>Not implemented yet.</Text>
    </Box>
  )
}

export function UsageView({ theme }: { theme: Theme }): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text color={theme.permission} bold>
        Usage
      </Text>
      <Box height={1} />
      <Text color={theme.secondaryText}>Not implemented yet.</Text>
    </Box>
  )
}

export const __configUiTestHooks = {
  clamp,
  terminalColumns,
}
