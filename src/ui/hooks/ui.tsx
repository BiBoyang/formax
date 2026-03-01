import React from 'react'
import { Box, Text } from 'ink'
import type { Theme } from '../../shared/utils/theme.js'
import { OverlayFrame } from '../../components/ui/OverlayFrame.js'
import TextInput from '../../components/ui/TextInput.js'
import type { InputScopeId } from '../../features/repl/inputScopeContext.js'
import type { HooksEventListItem, SaveScope } from './constants.js'
import { HOOK_EVENTS, SAVE_SCOPE_OPTIONS } from './constants.js'
import { clamp, formatMatcherLabel, formatSourceLabel } from './utils.js'
import type { HookRuleEntry } from '../../hooks/types.js'
import type { HookSource } from '../../hooks/types.js'

const DIM_GRAY = '#555555'
const MAX_VISIBLE_ROWS = 5

export function DialogFrame({
  theme,
  borderColor,
  children,
}: {
  theme: Theme
  borderColor: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <OverlayFrame borderStyle="round" borderColor={borderColor} flexDirection="column" paddingX={1} width="100%">
      {children}
    </OverlayFrame>
  )
}

export function FooterHint({ theme, text }: { theme: Theme; text: string }): React.ReactNode {
  return (
    <Box marginLeft={3}>
      <Text color={theme.secondaryText}>{text}</Text>
    </Box>
  )
}

function ToolExecutionInfo({
  theme,
  eventName,
  compact,
}: {
  theme: Theme
  eventName: string
  compact?: boolean
}): React.ReactNode {
  const exit2 = (() => {
    if (eventName === 'PostToolUse') return 'Exit code 2 - show stderr to model (tool already ran)'
    return 'Exit code 2 - show stderr to model and block tool call'
  })()

  return (
    <Box marginTop={1} marginBottom={compact ? 0 : 1} flexDirection="column">
      <Text color={theme.secondaryText}>Input to command is JSON of tool call arguments.</Text>
      <Text color={theme.secondaryText}>Exit code 0 - stdout/stderr not shown</Text>
      <Text color={theme.secondaryText}>{exit2}</Text>
      <Text color={theme.secondaryText}>Other exit codes - show stderr to user only but continue with tool call</Text>
    </Box>
  )
}

function formatEventDetailLabel(eventName: string): string {
  const found = HOOK_EVENTS.find((e) => e.id === eventName)?.label
  if (!found) return eventName
  // Labels are formatted like "PreToolUse - Before tool execution"
  return found
}

function eventDescriptionFromLabel(eventName: string, fullLabel: string): string {
  const prefix = `${eventName} - `
  if (!fullLabel.startsWith(prefix)) return ''
  return fullLabel.slice(prefix.length)
}

function computeWindowTop(cursor: number, total: number, maxVisible: number): number {
  const maxTop = Math.max(0, total - maxVisible)
  let top = clamp(cursor - (maxVisible - 1), 0, maxTop)
  if (cursor < top) top = cursor
  if (cursor > top + maxVisible - 1) top = cursor - (maxVisible - 1)
  return clamp(top, 0, maxTop)
}

export function EventListView({
  theme,
  events,
  cursor,
  banner,
}: {
  theme: Theme
  events: HooksEventListItem[]
  cursor: number
  banner?: string | null
}): React.ReactNode {
  const top = computeWindowTop(cursor, events.length, MAX_VISIBLE_ROWS)
  const visible = events.slice(top, top + MAX_VISIBLE_ROWS)
  const hasMoreAbove = top > 0
  const hasMoreBelow = top + MAX_VISIBLE_ROWS < events.length

  return (
    <Box flexDirection="column">
      <DialogFrame theme={theme} borderColor={theme.warning}>
        <Text color={theme.warning} bold>
          Hook Configuration
        </Text>
        <Box marginY={1}>
          <Text>
            <Text bold>Hooks</Text> are shell commands you can register to run during Formax processing.{' '}
            <Text underline>Docs</Text>
          </Text>
        </Box>
        <Box flexDirection="column" marginBottom={1}>
          <Text>• Each hook event has its own input and output behavior</Text>
          <Text>• Multiple hooks can be registered per event, executed in parallel</Text>
          <Text>• Changes saved here apply immediately</Text>
          <Text>• Timeout: 60 seconds</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            ⚠ Hooks execute shell commands with your full user permissions. This can pose security risks, so only use
            hooks from trusted sources.
          </Text>
        </Box>
        <Text color={theme.secondaryText}>
          Learn more: <Text underline>https://code.claude.com/docs/en/hooks</Text>
        </Text>

        {banner ? (
          <Box marginTop={1}>
            <Text color={theme.secondaryText}>{banner}</Text>
          </Box>
        ) : null}

        <Box marginY={1}>
          <Text bold>Select hook event:</Text>
        </Box>

        {visible.map((ev, i) => {
          const realIndex = top + i
          const selected = realIndex === cursor
          const prefix = selected
            ? '❯ '
            : i === 0 && hasMoreAbove
              ? '↑ '
              : i === visible.length - 1 && hasMoreBelow
                ? '↓ '
                : '  '
          const indexText = `${realIndex + 1}.`
          const color = selected ? theme.permission : ev.enabled ? theme.text : theme.secondaryText
          return (
            <Box key={ev.id}>
              <Text color={selected ? theme.permission : theme.secondaryText}>{prefix}</Text>
              <Text color={selected ? theme.permission : theme.text} dimColor={!selected}>
                {indexText}
              </Text>
              <Text>{'  '}</Text>
              <Text color={color} dimColor={!ev.enabled && !selected}>
                {ev.label}
              </Text>
            </Box>
          )
        })}
      </DialogFrame>
      <FooterHint theme={theme} text="Enter to select · Esc to exit" />
    </Box>
  )
}

export function MatcherListView({
  theme,
  eventName,
  matchers,
  cursor,
  banner,
}: {
  theme: Theme
  eventName: string
  matchers: Array<{ source: HookSource; matcher: string; hooksCount: number }>
  cursor: number
  banner?: string | null
}): React.ReactNode {
  const rows = [{ kind: 'add' as const }, ...matchers.map((m) => ({ kind: 'matcher' as const, ...m }))]
  const top = computeWindowTop(cursor, rows.length, MAX_VISIBLE_ROWS)
  const visible = rows.slice(top, top + MAX_VISIBLE_ROWS)
  const hasMoreAbove = top > 0
  const hasMoreBelow = top + MAX_VISIBLE_ROWS < rows.length

  return (
    <Box flexDirection="column">
      <DialogFrame theme={theme} borderColor={theme.permission}>
        <Text color={theme.permission} bold>
          {eventName} - Tool Matchers
        </Text>
        <ToolExecutionInfo theme={theme} eventName={eventName} />

        {banner ? <Text color={theme.secondaryText}>{banner}</Text> : null}

        {visible.map((row, i) => {
          const realIndex = top + i
          const selected = realIndex === cursor
          const prefix = selected
            ? '❯ '
            : i === 0 && hasMoreAbove
              ? '↑ '
              : i === visible.length - 1 && hasMoreBelow
                ? '↓ '
                : '  '

          if (row.kind === 'add') {
            return (
              <Box key="add">
                <Text color={selected ? theme.permission : theme.secondaryText}>{prefix}</Text>
                <Text color={selected ? theme.permission : theme.secondaryText} dimColor>
                  {realIndex + 1}.{' '}
                </Text>
                <Text>+ Add new matcher…</Text>
              </Box>
            )
          }

          const label = formatMatcherLabel(row.matcher)
          const color = selected ? theme.permission : theme.text
          const tag =
            row.source === 'projectLocal' ? 'Local' : row.source === 'project' ? 'Project' : row.source === 'user' ? 'User' : 'Settings'
          const countText = row.hooksCount === 1 ? '1 hook' : `${row.hooksCount} hooks`
          return (
            <Box key={`matcher:${row.source}:${row.matcher}`}>
              <Text color={selected ? theme.permission : theme.secondaryText}>{prefix}</Text>
              <Text color={selected ? theme.permission : theme.secondaryText} dimColor>
                {realIndex + 1}.{' '}
              </Text>
              <Box width={30}>
                <Text color={color}>{`[${tag}] ${label}`}</Text>
              </Box>
              <Text color={theme.secondaryText}>{countText}</Text>
            </Box>
          )
        })}
      </DialogFrame>
      <FooterHint theme={theme} text="Enter to select · Esc to go back" />
    </Box>
  )
}

export function HookListView({
  theme,
  eventName,
  matcher,
  showMatcher = true,
  hooks,
  cursor,
  banner,
}: {
  theme: Theme
  eventName: string
  matcher: string
  showMatcher?: boolean
  hooks: HookRuleEntry[]
  cursor: number
  banner?: string | null
}): React.ReactNode {
  const rows = [{ kind: 'add' as const }, ...hooks.map((h) => ({ kind: 'hook' as const, entry: h }))]
  const top = computeWindowTop(cursor, rows.length, MAX_VISIBLE_ROWS)
  const visible = rows.slice(top, top + MAX_VISIBLE_ROWS)
  const hasMoreAbove = top > 0
  const hasMoreBelow = top + MAX_VISIBLE_ROWS < rows.length

  return (
    <Box flexDirection="column">
      <DialogFrame theme={theme} borderColor={theme.success}>
        <Text color={theme.success} bold>
          {showMatcher ? (
            <>
              {eventName} - Matcher: {formatMatcherLabel(matcher)}
            </>
          ) : (
            eventName
          )}
        </Text>
        <ToolExecutionInfo theme={theme} eventName={eventName} />
        {banner ? <Text color={theme.secondaryText}>{banner}</Text> : null}

        {visible.map((row, i) => {
          const realIndex = top + i
          const selected = realIndex === cursor
          const prefix = selected
            ? '❯ '
            : i === 0 && hasMoreAbove
              ? '↑ '
              : i === visible.length - 1 && hasMoreBelow
                ? '↓ '
                : '  '

          if (row.kind === 'add') {
            return (
              <Box key="add">
                <Text color={selected ? theme.permission : theme.secondaryText}>{prefix}</Text>
                <Text color={selected ? theme.permission : theme.secondaryText} dimColor>
                  {realIndex + 1}.{' '}
                </Text>
                <Text>+ Add new hook…</Text>
                {hooks.length === 0 ? (
                  <Box marginLeft={2}>
                    <Text color={theme.secondaryText}>No hooks configured yet</Text>
                  </Box>
                ) : null}
              </Box>
            )
          }

          const color = selected ? theme.permission : theme.text
          return (
            <Box key={`hook:${realIndex}`}>
              <Text color={selected ? theme.permission : theme.secondaryText}>{prefix}</Text>
              <Text color={selected ? theme.permission : theme.secondaryText} dimColor>
                {realIndex + 1}.{' '}
              </Text>
              <Box width={50}>
                <Text color={color}>{row.entry.command}</Text>
              </Box>
              <Text color={theme.secondaryText}>{formatSourceLabel(row.entry.source)}</Text>
            </Box>
          )
        })}
      </DialogFrame>
      <FooterHint theme={theme} text="Enter to select · Esc to go back" />
    </Box>
  )
}

export function AddMatcherView({
  theme,
  eventName,
  inputText,
  matcherValues,
  inputScope,
  onChange,
  onSubmit,
}: {
  theme: Theme
  eventName: string
  inputText: string
  matcherValues: string
  inputScope: InputScopeId
  onChange: (value: string) => void
  onSubmit: (value: string) => void
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <DialogFrame theme={theme} borderColor={theme.success}>
        <Text color={theme.success} bold>
          Add new matcher for {eventName}
        </Text>
        <ToolExecutionInfo theme={theme} eventName={eventName} />
        <Text>Possible matcher values for field tool_name:</Text>
        <Box marginY={1}>
          <Text color={theme.secondaryText}>{matcherValues}</Text>
        </Box>
        <Text>Tool matcher:</Text>
        <Box borderStyle="round" borderColor={DIM_GRAY} paddingX={1} width="100%">
          <TextInput value={inputText} onChange={onChange} onSubmit={onSubmit} focus scope={inputScope} />
        </Box>
        <Box marginY={1} flexDirection="column">
          <Text color={theme.secondaryText}>Example Matchers:</Text>
          <Text color={theme.secondaryText}>• Write (single tool)</Text>
          <Text color={theme.secondaryText}>• Write|Edit (multiple tools)</Text>
          <Text color={theme.secondaryText}>• Web.* (regex pattern)</Text>
        </Box>
      </DialogFrame>
      <FooterHint theme={theme} text="Enter to confirm · Esc to cancel" />
    </Box>
  )
}

export function AddHookView({
  theme,
  eventName,
  matcherName,
  showMatcher = true,
  inputText,
  inputScope,
  onChange,
  onSubmit,
}: {
  theme: Theme
  eventName: string
  matcherName: string
  showMatcher?: boolean
  inputText: string
  inputScope: InputScopeId
  onChange: (value: string) => void
  onSubmit: (value: string) => void
}): React.ReactNode {
  const fullEventLabel = formatEventDetailLabel(eventName)
  const eventDesc = eventDescriptionFromLabel(eventName, fullEventLabel)

  const header = React.useMemo(() => {
    return (
      <>
        <Text color={theme.success} bold>
          Add new hook
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            ⚠ Hooks execute shell commands with your full user permissions. This can pose security risks, so only use
            hooks from trusted sources.
          </Text>
          <Text color={theme.secondaryText}>
            Learn more: <Text underline>https://code.claude.com/docs/en/hooks</Text>
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Event: <Text bold>{eventName}</Text>
            {eventDesc ? ` - ${eventDesc}` : ''}
          </Text>
        </Box>
        <ToolExecutionInfo theme={theme} eventName={eventName} compact />
        {showMatcher ? (
          <Box marginTop={1}>
            <Text>
              Matcher: <Text bold>{formatMatcherLabel(matcherName)}</Text>
            </Text>
          </Box>
        ) : null}
      </>
    )
  }, [eventDesc, eventName, matcherName, showMatcher, theme.secondaryText, theme.success])

  const examples = React.useMemo(() => {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.secondaryText}>Examples:</Text>
        <Text color={theme.secondaryText}>
          • jq -r '.tool_input.file_path | select(endswith(".go"))' | xargs -r gofmt -w
        </Text>
        <Text color={theme.secondaryText}>
          {`• jq -r '"\\(.tool_input.command) - \\(.tool_input.description // "No description")"' >> ~/.formax/bash-command-log.txt`}
        </Text>
        <Text color={theme.secondaryText}>• /usr/local/bin/security_check.sh</Text>
        <Text color={theme.secondaryText}>• python3 ~/hooks/validate_changes.py</Text>
      </Box>
    )
  }, [theme.secondaryText])

  return (
    <Box flexDirection="column">
      <DialogFrame theme={theme} borderColor={theme.success}>
        {header}
        <Box marginTop={1}><Text>Command:</Text></Box>
        <Box borderStyle="round" borderColor={DIM_GRAY} paddingX={1} width="100%">
          <TextInput value={inputText} onChange={onChange} onSubmit={onSubmit} focus scope={inputScope} />
        </Box>
        {examples}
      </DialogFrame>
      <FooterHint theme={theme} text="Enter to confirm · Esc to cancel" />
    </Box>
  )
}

export function SaveHookView({
  theme,
  eventName,
  matcherName,
  showMatcher = true,
  hookCommand,
  cursor,
}: {
  theme: Theme
  eventName: string
  matcherName: string
  showMatcher?: boolean
  hookCommand: string
  cursor: number
}): React.ReactNode {
  const fullEventLabel = formatEventDetailLabel(eventName)

  return (
    <Box flexDirection="column">
      <DialogFrame theme={theme} borderColor={theme.success}>
        <Text color={theme.success} bold>
          Save hook configuration
        </Text>
        <Box marginY={1} flexDirection="column">
          <Text>
            {'  '}
            Event: {fullEventLabel}
          </Text>
          {showMatcher ? (
            <Text>
              {'  '}
              Matcher: {formatMatcherLabel(matcherName)}
            </Text>
          ) : null}
          <Text>
            {'  '}
            Command: {hookCommand}
          </Text>
        </Box>
        <Text>Where should this hook be saved?</Text>
        <Box marginY={1} flexDirection="column">
          {SAVE_SCOPE_OPTIONS.map((loc, i) => {
            const selected = cursor === i
            const prefix = selected ? '❯ ' : '  '
            return (
              <Box key={loc.scope}>
                <Text color={selected ? theme.permission : theme.secondaryText}>{prefix}</Text>
                <Box width={30}>
                  <Text color={selected ? theme.permission : theme.text}>{loc.label}</Text>
                </Box>
                <Text color={theme.secondaryText}>{loc.desc}</Text>
              </Box>
            )
          })}
        </Box>
      </DialogFrame>
    </Box>
  )
}

const CONFIRM_CHOICES: Array<{ key: string; label: string }> = [
  { key: 'yes', label: 'Yes' },
  { key: 'no', label: 'No' },
]

function formatSettingsLocation(source: HookSource): string {
  switch (source) {
    case 'projectLocal':
      return 'Local settings (.formax/settings.local.json)'
    case 'project':
      return 'Project settings (.formax/settings.json)'
    case 'user':
      return 'User settings (~/.formax/settings.json)'
    default:
      return 'Settings'
  }
}

export function ConfirmDeleteView({
  theme,
  command,
  eventName,
  matcherName,
  showMatcher = true,
  source,
  cursor,
}: {
  theme: Theme
  command: string
  eventName: string
  matcherName: string
  showMatcher?: boolean
  source: HookSource
  cursor: 0 | 1
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <DialogFrame theme={theme} borderColor={theme.error}>
        <Text color={theme.error} bold>
          Delete hook?
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>{`  ${command}`}</Text>
          <Text>{`  Event: ${eventName}`}</Text>
          {showMatcher ? <Text>{`  Matcher: ${formatMatcherLabel(matcherName)}`}</Text> : null}
          <Text>{`  ${formatSettingsLocation(source)}`}</Text>
        </Box>
        <Box marginTop={1}>
          <Text>This will remove the hook configuration from your settings.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {CONFIRM_CHOICES.map((item, idx) => {
            const active = idx === cursor
            const prefix = active ? '❯ ' : '  '
            const color = active ? theme.error : theme.text
            return (
              <Text key={item.key} color={color}>
                {prefix}
                {idx + 1}. {item.label}
              </Text>
            )
          })}
        </Box>
      </DialogFrame>
      <FooterHint theme={theme} text="Enter to confirm · Esc to cancel" />
    </Box>
  )
}

export function formatSaveScopeLabel(scope: SaveScope): string {
  const found = SAVE_SCOPE_OPTIONS.find((s) => s.scope === scope)
  return found?.desc ?? scope
}
