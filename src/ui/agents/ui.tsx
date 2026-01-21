import React from 'react'
import { Box, Text } from 'ink'
import TextInput from '../../components/ui/TextInput'
import { KeyHintBar } from '../../components/ui/KeyHintBar'
import { OverlayFrame } from '../../components/ui/OverlayFrame'
import { SelectList } from '../../components/ui/SelectList'
import { RotatingStar } from '../../components/ui/RotatingStar'
import type { AgentsDialogTheme, AgentMeta } from './constants.js'
import { TOOLS_DIVIDER } from './constants.js'
import type { ToolsSelectableRow } from './constants.js'

export function Spacer({ height = 1 }: { height?: number }): React.ReactNode {
  return <Box height={height} />
}

export const DialogFrame = React.memo(function DialogFrame({
  theme,
  children,
}: {
  theme: AgentsDialogTheme
  children: React.ReactNode
}): React.ReactNode {
  return (
    <OverlayFrame
      borderStyle="round"
      borderColor={theme.permission}
      flexDirection="column"
      paddingX={1}
      width="100%"
    >
      {children}
    </OverlayFrame>
  )
})

export const CreateAgentHeader = React.memo(function CreateAgentHeader({
  theme,
  subtitle,
  description,
}: {
  theme: AgentsDialogTheme
  subtitle?: string
  description?: string
}): React.ReactNode {
  return (
    <Box marginTop={0} flexDirection="column">
      <Text bold>Create new agent</Text>
      {subtitle ? <Text color={theme.secondaryText}>{subtitle}</Text> : null}
      {description ? <Text color={theme.secondaryText}>{description}</Text> : null}
    </Box>
  )
})

export const Footer = React.memo(function Footer({ theme, text }: { theme: AgentsDialogTheme; text: string }): React.ReactNode {
  return <KeyHintBar text={text} color={theme.secondaryText} marginLeft={1} marginTop={0} />
})

export function CursorPrefix({ theme, active }: { theme: AgentsDialogTheme; active: boolean }): React.ReactNode {
  return <Text color={active ? theme.permission : theme.secondaryText}>{active ? '❯ ' : '  '}</Text>
}

export function CheckboxPrefix({
  theme,
  checked,
}: {
  theme: AgentsDialogTheme
  checked: boolean
}): React.ReactNode {
  return <Text color={theme.secondaryText}>{checked ? '☒ ' : '☐ '}</Text>
}

export function FrameDivider({ theme }: { theme: AgentsDialogTheme }): React.ReactNode {
  return <Text color={theme.secondaryText}>{TOOLS_DIVIDER}</Text>
}

export function FramedRow({
  theme,
  active,
  checked,
  label,
}: {
  theme: AgentsDialogTheme
  active: boolean
  checked?: boolean
  label: string
}): React.ReactNode {
  return (
    <Box>
      <CursorPrefix theme={theme} active={active} />
      {typeof checked === 'boolean' ? <CheckboxPrefix theme={theme} checked={checked} /> : null}
      <Text bold={active} color={active ? theme.permission : undefined}>
        {label}
      </Text>
    </Box>
  )
}

const SECTION_PREFIX = '  '

export function AgentsListView({
  theme,
  agentsCount,
  banner,
  cursor,
  userAgentsDir,
  groups,
}: {
  theme: AgentsDialogTheme
  agentsCount: number
  banner: string | null
  cursor: number
  userAgentsDir: string
  groups: { userAgents: AgentMeta[]; projectAgents: AgentMeta[]; builtins: AgentMeta[] }
}): React.ReactNode {
  const userStart = 1
  const projectStart = userStart + groups.userAgents.length
  const builtinsStart = projectStart + groups.projectAgents.length

  const createStyle = React.useMemo(() => {
    const selected = cursor === 0
    return {
      selected,
      prefix: selected ? '> ' : '  ',
      color: selected ? theme.permission : theme.secondaryText,
    }
  }, [cursor, theme.permission, theme.secondaryText])

  const getRowStyle = React.useCallback(
    (rowIndex: number) => {
      const selected = cursor === rowIndex
      return {
        selected,
        prefix: selected ? '> ' : '  ',
        color: selected ? theme.permission : theme.secondaryText,
      }
    },
    [cursor, theme.permission, theme.secondaryText],
  )

  return (
    <DialogFrame theme={theme}>
      <Box marginTop={0} flexDirection="column">
        <Text bold>Agents</Text>
        <Text color={theme.secondaryText}>{agentsCount} agents</Text>
        <Spacer />
        {banner ? (
          <>
            <Text color={theme.secondaryText}>{banner}</Text>
            <Spacer />
          </>
        ) : null}
      </Box>

      <Text color={createStyle.color}>
        {createStyle.prefix}Create new agent
      </Text>

      <Spacer />

      {groups.userAgents.length ? (
        <Box flexDirection="column">
          <Text bold color={theme.secondaryText}>
            {SECTION_PREFIX}User agents ({userAgentsDir})
          </Text>
          {groups.userAgents.map((a, i) => {
            const rowIndex = userStart + i
            const style = getRowStyle(rowIndex)
            return (
              <Text key={`user-${a.name}`} color={style.color}>
                {style.prefix}
                {a.name} · {a.model}
              </Text>
            )
          })}
        </Box>
      ) : null}

      {groups.projectAgents.length ? (
        <>
          <Spacer />
          <Box flexDirection="column">
            <Text bold color={theme.secondaryText}>
              {SECTION_PREFIX}Project agents
            </Text>
            {groups.projectAgents.map((a, i) => {
              const rowIndex = projectStart + i
              const style = getRowStyle(rowIndex)
              return (
                <Text key={`project-${a.name}`} color={style.color}>
                  {style.prefix}
                  {a.name} · {a.model}
                </Text>
              )
            })}
          </Box>
        </>
      ) : null}

      <Spacer />

      <Box flexDirection="column">
        <Text bold color={theme.secondaryText}>
          {SECTION_PREFIX}Built-in agents (always available)
        </Text>

        {groups.builtins.map((a, i) => {
          const rowIndex = builtinsStart + i
          const style = getRowStyle(rowIndex)
          return (
            <Text key={`builtin-${a.name}`} color={style.color}>
              {style.prefix}
              {a.name} · {a.model}
            </Text>
          )
        })}
      </Box>

      <Spacer />

    </DialogFrame>
  )
}

export const SimpleChoiceView = React.memo(function SimpleChoiceView({
  theme,
  title,
  subtitle,
  cursor,
  options,
}: {
  theme: AgentsDialogTheme
  title: string
  subtitle: string
  cursor: number
  options: Array<{ key: string; label: string }>
}): React.ReactNode {
  return (
    <DialogFrame theme={theme}>
      <Box marginTop={0} flexDirection="column">
        <Text bold>{title}</Text>
        <Text color={theme.secondaryText}>{subtitle}</Text>
      </Box>
      <Spacer />
      <SelectList
        items={options.map((opt) => ({ key: opt.key, label: opt.label }))}
        cursor={cursor}
        accentColor={theme.permission}
        mutedColor={theme.secondaryText}
        activePrefix="> "
        inactivePrefix="  "
        showNumbers
      />
    </DialogFrame>
  )
})

export const GenerateDescriptionView = React.memo(function GenerateDescriptionView({
  theme,
  value,
  onChange,
  onSubmit,
}: {
  theme: AgentsDialogTheme
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
}): React.ReactNode {

  return (
    <DialogFrame theme={theme}>
      <CreateAgentHeader
        theme={theme}
        description="Describe what this agent should do and when it should be used (be comprehensive for best results)"
      />
      <Spacer />
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={() => onSubmit()}
        placeholder="e.g., Help me write unit tests for my code..."
        scope="overlay:agents"
      />
    </DialogFrame>
  )
})
