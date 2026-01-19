import fsp from 'node:fs/promises'
import path from 'node:path'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from '../components/ui/TextInput'
import { KeyHintBar } from '../components/ui/KeyHintBar'
import { OverlayFrame } from '../components/ui/OverlayFrame'
import { RotatingStar } from '../components/ui/RotatingStar'
import { getTheme } from '../utils/theme'
import { useScopeActivation, useScopedInput } from '../features/repl/inputScopeContext'

type AgentListItem = { name: string; description: string }

type AgentsDialogTheme = ReturnType<typeof getTheme>

export type AgentsDialogGenerateDraft = {
  name: string
  description: string
  systemPrompt: string
}

export type AgentsDialogSaveArgs = {
  scope: 'project' | 'user'
  name: string
  description: string
  systemPrompt: string
  tools: string
  model: string
  color: string
  openInEditor: boolean
}

export type AgentsDialogSaveResult = { name: string; filePath: string }

type AgentScope = 'user' | 'project' | 'builtin'
type AgentMeta = AgentListItem & { scope: AgentScope; model: string }
type DiskAgentInfo = { name: string; model: string; filePath: string }

const COLOR_MAP: Record<string, string> = {
  red: '#ff3b30',
  blue: '#0a84ff',
  green: '#34c759',
  yellow: '#ffd60a',
  purple: '#bf5af2',
  orange: '#ff9f0a',
  pink: '#ff2d55',
  cyan: '#64d2ff',
}
const TOOLS_DIVIDER = '─'.repeat(32)
const AGENTS_DIALOG_ACCENT = '#b1b9f9'

const BUILTIN_AGENT_NAMES = new Set(
  ['general-purpose', 'statusline-setup', 'explore', 'plan', 'claude-code-guide'].map((s) =>
    s.toLowerCase(),
  ),
)

const BUILTIN_MODEL_BY_NAME = new Map<string, string>([
  ['general-purpose', 'sonnet'],
  ['statusline-setup', 'sonnet'],
  ['explore', 'haiku'],
  ['plan', 'inherit'],
  ['claude-code-guide', 'haiku'],
])

const METHOD_OPTIONS: Array<{ label: string; value: 'manual' | 'generate' }> = [
  { label: 'Generate with Claude (recommended)', value: 'generate' },
  { label: 'Manual configuration', value: 'manual' },
]

const MODEL_OPTIONS: Array<{ label: string; description: string }> = [
  { label: 'Sonnet', description: 'Balanced performance - best for most agents' },
  { label: 'Opus', description: 'Most capable for complex reasoning tasks' },
  { label: 'Haiku', description: 'Fast and efficient for simple tasks' },
  { label: 'Inherit', description: 'Use the same model as the main conversation' },
]

const COLOR_OPTIONS = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Cyan']
const SCOPE_OPTIONS: Array<{ label: string; value: 'project' | 'user' }> = [
  { label: 'Project (.formax/agents/)', value: 'project' },
  { label: 'Personal (~/.formax/agents/)', value: 'user' },
]

function Spacer({ height = 1 }: { height?: number }): React.ReactNode {
  return <Box height={height} />
}

const DialogFrame = React.memo(function DialogFrame({
  // keep for call-site simplicity; accent color is fixed for this dialog
  theme: _theme,
  children,
}: {
  theme: AgentsDialogTheme
  children: React.ReactNode
}): React.ReactNode {
  return (
    <OverlayFrame
      borderStyle="round"
      borderColor={AGENTS_DIALOG_ACCENT}
      flexDirection="column"
      paddingX={1}
      width="100%"
    >
      {children}
    </OverlayFrame>
  )
})

const CreateAgentHeader = React.memo(function CreateAgentHeader({
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

const Footer = React.memo(function Footer({ theme, text }: { theme: AgentsDialogTheme; text: string }): React.ReactNode {
  return <KeyHintBar text={text} color={theme.secondaryText} marginLeft={1} marginTop={0} />
})

function CursorPrefix({ theme, active }: { theme: AgentsDialogTheme; active: boolean }): React.ReactNode {
  return <Text color={active ? AGENTS_DIALOG_ACCENT : theme.secondaryText}>{active ? '❯ ' : '  '}</Text>
}

function CheckboxPrefix({
  theme,
  checked,
}: {
  theme: AgentsDialogTheme
  checked: boolean
}): React.ReactNode {
  return <Text color={theme.secondaryText}>{checked ? '☒ ' : '☐ '}</Text>
}

function FrameDivider({ theme }: { theme: AgentsDialogTheme }): React.ReactNode {
  return <Text color={theme.secondaryText}>{TOOLS_DIVIDER}</Text>
}

function FramedRow({
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
      <Text bold={active} color={active ? AGENTS_DIALOG_ACCENT : undefined}>
        {label}
      </Text>
    </Box>
  )
}

const SECTION_PREFIX = '  '

function AgentsListView({
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
      color: selected ? AGENTS_DIALOG_ACCENT : theme.secondaryText,
    }
  }, [cursor, theme.secondaryText])

  const getRowStyle = React.useCallback(
    (rowIndex: number) => {
      const selected = cursor === rowIndex
      return {
        selected,
        prefix: selected ? '> ' : '  ',
        color: selected ? AGENTS_DIALOG_ACCENT : theme.secondaryText,
      }
    },
    [cursor, theme.secondaryText],
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

const SimpleChoiceView = React.memo(function SimpleChoiceView({
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
      {options.map((opt, idx) => (
        <Text key={opt.key} color={idx === cursor ? AGENTS_DIALOG_ACCENT : theme.secondaryText}>
          {idx === cursor ? '> ' : '  '}
          {idx + 1}. {opt.label}
        </Text>
      ))}
    </DialogFrame>
  )
})

const GenerateDescriptionView = React.memo(function GenerateDescriptionView({
  theme,
  value,
}: {
  theme: AgentsDialogTheme
  value: string
}): React.ReactNode {
  return (
    <DialogFrame theme={theme}>
      <CreateAgentHeader
        theme={theme}
        description="Describe what this agent should do and when it should be used (be comprehensive for best results)"
      />
      <Spacer />

      <Box>
        {value.length === 0 ? (
          <>
            <Text inverse> </Text>
            <Text color={theme.secondaryText}>e.g., Help me write unit tests for my code...</Text>
          </>
        ) : (
          <>
            <Text>{value}</Text>
            <Text inverse> </Text>
          </>
        )}
      </Box>
    </DialogFrame>
  )
})

export function AgentsDialog({
  agents,
  toolNames,
  userAgentsDir,
  projectAgentsDir,
  onGenerateDraft,
  onSaveAgent,
  onExit,
}: {
  agents: AgentListItem[]
  toolNames: string[]
  userAgentsDir: string
  projectAgentsDir: string
  onGenerateDraft: (description: string, signal?: AbortSignal) => Promise<AgentsDialogGenerateDraft>
  onSaveAgent: (args: AgentsDialogSaveArgs) => Promise<AgentsDialogSaveResult>
  onExit: (args: { createdAgents: string[] }) => void
}): React.ReactNode {
  const theme = useMemo(() => getTheme(), [])
  useScopeActivation('overlay:agents')

  const [diskUserAgents, setDiskUserAgents] = useState<Record<string, DiskAgentInfo>>({})
  const [diskProjectAgents, setDiskProjectAgents] = useState<Record<string, DiskAgentInfo>>({})

  const refreshDiskAgents = useCallback(async () => {
    const [user, project] = await Promise.all([
      readAgentDir(userAgentsDir),
      readAgentDir(projectAgentsDir),
    ])
    setDiskUserAgents(user)
    setDiskProjectAgents(project)
  }, [projectAgentsDir, userAgentsDir])

  useEffect(() => {
    void refreshDiskAgents()
  }, [refreshDiskAgents])

  const groupedAgents = useMemo(() => {
    const userList: AgentMeta[] = []
    const projectList: AgentMeta[] = []
    const builtins: AgentMeta[] = []

    for (const agent of agents) {
      const key = agent.name.toLowerCase()

      if (BUILTIN_AGENT_NAMES.has(key)) {
        const model = BUILTIN_MODEL_BY_NAME.get(key) ?? 'inherit'
        builtins.push({ ...agent, scope: 'builtin', model })
        continue
      }

      const project = diskProjectAgents[key]
      if (project) {
        projectList.push({ ...agent, scope: 'project', model: project.model })
        continue
      }

      const user = diskUserAgents[key]
      if (user) {
        userList.push({ ...agent, scope: 'user', model: user.model })
        continue
      }

      userList.push({ ...agent, scope: 'user', model: 'inherit' })
    }

    userList.sort((a, b) => a.name.localeCompare(b.name))
    projectList.sort((a, b) => a.name.localeCompare(b.name))
    builtins.sort((a, b) => a.name.localeCompare(b.name))

    const projectNames = new Set(projectList.map((a) => a.name.toLowerCase()))
    const filteredUser = userList.filter((a) => !projectNames.has(a.name.toLowerCase()))

    return { userAgents: filteredUser, projectAgents: projectList, builtins }
  }, [agents, diskProjectAgents, diskUserAgents])

  const listRows = useMemo(() => {
    const rows: Array<{ type: 'create' } | { type: 'agent'; agent: AgentMeta }> = [{ type: 'create' }]
    rows.push(...groupedAgents.userAgents.map((agent) => ({ type: 'agent' as const, agent })))
    rows.push(...groupedAgents.projectAgents.map((agent) => ({ type: 'agent' as const, agent })))
    rows.push(...groupedAgents.builtins.map((agent) => ({ type: 'agent' as const, agent })))
    return rows
  }, [groupedAgents.builtins, groupedAgents.projectAgents, groupedAgents.userAgents])

  type View =
    | { kind: 'list'; cursor: number; banner?: string | null }
    | { kind: 'view_agent'; agent: AgentMeta }
    | { kind: 'create_scope'; cursor: number }
    | { kind: 'create_method'; cursor: number }
    | { kind: 'create_generate_desc' }
    | { kind: 'create_manual_name' }
    | { kind: 'create_manual_desc' }
    | { kind: 'create_tools'; cursor: number }
    | { kind: 'create_model'; cursor: number }
    | { kind: 'create_color'; cursor: number }
    | { kind: 'confirm' }
    | { kind: 'generating_draft'; message: string }
    | { kind: 'saving_agent'; message: string }
    | { kind: 'error'; message: string }

  const [view, setView] = useState<View>({ kind: 'list', cursor: 0, banner: null })
  const [stack, setStack] = useState<View[]>([])
  const viewRef = useRef<View>({ kind: 'list', cursor: 0, banner: null })
  useEffect(() => {
    viewRef.current = view
  }, [view])
  const [createdAgents, setCreatedAgents] = useState<string[]>([])
  const opSeqRef = useRef(0)
  const activeOpRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [draft, setDraft] = useState<AgentsDialogGenerateDraft | null>(null)
  const [scope, setScope] = useState<'project' | 'user'>('project')
  const [agentDescriptionInput, setAgentDescriptionInput] = useState('')
  const [manualNameInput, setManualNameInput] = useState('')
  const [manualDescInput, setManualDescInput] = useState('')

  const [selectedModel, setSelectedModel] = useState('Sonnet')
  const [selectedColor, setSelectedColor] = useState('Blue')
  const [showAdvancedTools, setShowAdvancedTools] = useState(false)
  const [selectedTools, setSelectedTools] = useState<string[]>([])

  const allToolNames = useMemo(
    () => Array.from(new Set(toolNames)).sort((a, b) => a.localeCompare(b)),
    [toolNames],
  )

  const selectableToolNames = useMemo(
    () => allToolNames.filter((t) => !NON_SELECTABLE_TOOLS.has(t)),
    [allToolNames],
  )

  const toolGroups = useMemo(() => {
    const all = new Set<string>(selectableToolNames)
    const readOnly = new Set<string>(selectableToolNames.filter((t) => t === 'Read' || t === 'Glob' || t === 'Grep'))
    const edit = new Set<string>(selectableToolNames.filter((t) => t === 'Edit' || t === 'Write' || t === 'NotebookEdit'))
    const execution = new Set<string>(selectableToolNames.filter((t) => t === 'Bash'))
    const other = new Set<string>(selectableToolNames.filter((t) => !readOnly.has(t) && !edit.has(t) && !execution.has(t)))
    return { all, readOnly, edit, execution, other }
  }, [selectableToolNames])

  const selectedToolSet = useMemo(() => new Set(selectedTools), [selectedTools])

  const toolGroupChecked = useMemo(() => {
    const isChecked = (group: Set<string>) =>
      group.size > 0 && Array.from(group).every((t) => selectedToolSet.has(t))
    return {
      all: isChecked(toolGroups.all),
      readOnly: isChecked(toolGroups.readOnly),
      edit: isChecked(toolGroups.edit),
      execution: isChecked(toolGroups.execution),
      other: isChecked(toolGroups.other),
    }
  }, [selectedToolSet, toolGroups])

  const toolsAnswer = useMemo(() => {
    const selectedSorted = Array.from(selectedToolSet).sort((a, b) => a.localeCompare(b))
    const exact = (want: string[]) => selectedSorted.length === want.length && want.every((t) => selectedToolSet.has(t))

    if (exact(selectableToolNames)) return 'All tools'
    if (exact(Array.from(toolGroups.readOnly))) return 'Read-only tools'
    if (exact(Array.from(toolGroups.edit))) return 'Edit tools'
    if (exact(Array.from(toolGroups.execution))) return 'Execution tools'

    return selectedSorted.join(', ')
  }, [selectableToolNames, selectedToolSet, toolGroups.edit, toolGroups.execution, toolGroups.readOnly])

  const resetCreateState = useCallback(() => {
    setDraft(null)
    setScope('project')
    setAgentDescriptionInput('')
    setManualNameInput('')
    setManualDescInput('')
    setSelectedModel('Sonnet')
    setSelectedColor('Blue')
    setShowAdvancedTools(false)
    setSelectedTools(selectableToolNames)
  }, [selectableToolNames])

  const pushView = useCallback((next: View) => {
    setStack((prev) => [...prev, viewRef.current])
    setView(next)
  }, [])

  const popView = useCallback(() => {
    setStack((prev) => {
      if (prev.length === 0) return prev
      const next = prev.slice(0, -1)
      const last = prev[prev.length - 1]
      if (last) setView(last)
      return next
    })
  }, [])

  const cancelBusy = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    activeOpRef.current = null
    popView()
  }, [popView])

  const closeDialog = useCallback(() => {
    onExit({ createdAgents })
  }, [createdAgents, onExit])

  const startCreate = useCallback(() => {
    resetCreateState()
    pushView({ kind: 'create_scope', cursor: 0 })
  }, [pushView, resetCreateState])

  const startGenerateDraft = useCallback(async () => {
    const desc = agentDescriptionInput.trim()
    if (!desc) {
      pushView({ kind: 'error', message: 'Please describe the agent to generate.' })
      return
    }

    const abortController = new AbortController()
    abortRef.current?.abort()
    abortRef.current = abortController
    const opId = ++opSeqRef.current
    activeOpRef.current = opId

    pushView({ kind: 'generating_draft', message: 'Generating agent from description...' })
    try {
      const generated = await onGenerateDraft(desc, abortController.signal)
      if (activeOpRef.current !== opId) return
      setDraft(generated)
      setView({ kind: 'create_tools', cursor: 0 })
    } catch (e) {
      if (activeOpRef.current !== opId) return
      if (abortController.signal.aborted) return
      const msg = e instanceof Error ? e.message : String(e)
      setView({ kind: 'error', message: msg || 'Generate failed' })
    } finally {
      if (abortRef.current === abortController) abortRef.current = null
      if (activeOpRef.current === opId) activeOpRef.current = null
    }
  }, [agentDescriptionInput, onGenerateDraft, pushView])

  const commitManualDraft = useCallback(() => {
    const name = normalizeAgentName(manualNameInput)
    if (!name) {
      pushView({ kind: 'error', message: 'Missing agent name.' })
      return
    }
    const desc = manualDescInput.trim()
    if (!desc) {
      pushView({ kind: 'error', message: 'Missing agent description.' })
      return
    }

    const systemPrompt = buildManualSystemPrompt({ name, description: desc })
    setDraft({ name, description: desc, systemPrompt })
    pushView({ kind: 'create_tools', cursor: 0 })
  }, [manualDescInput, manualNameInput, pushView])

  const save = useCallback(
    async (openInEditor: boolean) => {
      if (!draft) return
      const opId = ++opSeqRef.current
      activeOpRef.current = opId
      pushView({ kind: 'saving_agent', message: 'Saving…' })
      try {
        const out = await onSaveAgent({
          scope,
          name: draft.name,
          description: draft.description,
          systemPrompt: draft.systemPrompt,
          tools: toolsAnswer,
          model: selectedModel,
          color: selectedColor,
          openInEditor,
        })

        if (activeOpRef.current !== opId) return
        setCreatedAgents((prev) => [...prev, out.name])
        setView({ kind: 'list', cursor: 0, banner: `Created agent: ${out.name}` })
        setStack([])
      } catch (e) {
        if (activeOpRef.current !== opId) return
        const msg = e instanceof Error ? e.message : String(e)
        setView({ kind: 'error', message: msg || 'Save failed' })
      } finally {
        if (activeOpRef.current === opId) activeOpRef.current = null
      }
    },
    [draft, onSaveAgent, pushView, scope, selectedColor, selectedModel, toolsAnswer],
  )

  const hint = useMemo(() => {
    if (view.kind === 'confirm') {
      return 's/Enter to save · e to save and edit in your editor · Esc to cancel'
    }
    if (
      view.kind === 'create_manual_name' ||
      view.kind === 'create_manual_desc'
    ) {
      return 'Enter to continue · Esc to go back'
    }
    if (view.kind === 'create_generate_desc') return 'Enter to submit · Esc to go back'
    if (view.kind === 'generating_draft' || view.kind === 'saving_agent') return 'Esc to cancel'
    if (view.kind === 'create_scope') return '↑↓ to navigate · Enter to select · Esc to cancel'
    return 'Press ↑↓ to navigate · Enter to select · Esc to go back'
  }, [view.kind])

  const handleBusyKeys = useCallback(
    (_input: string, key: any): boolean => {
      if (view.kind !== 'generating_draft' && view.kind !== 'saving_agent') return false
      if (key.escape) cancelBusy()
      return true
    },
    [cancelBusy, view.kind],
  )

  const handleErrorKeys = useCallback(
    (_input: string, key: any): boolean => {
      if (view.kind !== 'error') return false
      if (key.escape || key.return) popView()
      return true
    },
    [popView, view.kind],
  )

  const handleManualTextKeys = useCallback(
    (_input: string, key: any): boolean => {
      if (view.kind !== 'create_manual_name' && view.kind !== 'create_manual_desc') return false
      if (key.escape) popView()
      return true
    },
    [popView, view.kind],
  )

  const handleGenerateDescKeys = useCallback(
    (input: string, key: any): boolean => {
      if (view.kind !== 'create_generate_desc') return false

      if (key.escape) {
        popView()
        return true
      }

      if (key.return) {
        void startGenerateDraft()
        return true
      }

      if (key.backspace || key.delete) {
        setAgentDescriptionInput((prev) => prev.slice(0, -1))
        return true
      }

      if (input && !key.ctrl && !key.meta) {
        setAgentDescriptionInput((prev) => prev + input)
        return true
      }

      return true
    },
    [popView, startGenerateDraft, view.kind],
  )

  const handleEscapeKeys = useCallback(
    (_input: string, key: any): boolean => {
      if (!key.escape) return false
      if (stack.length === 0 || view.kind === 'list') closeDialog()
      else popView()
      return true
    },
    [closeDialog, popView, stack.length, view.kind],
  )

  const handleConfirmKeys = useCallback(
    (input: string, key: any): boolean => {
      if (view.kind !== 'confirm') return false
      if (key.return || input === 's' || input === 'S') void save(false)
      else if (input === 'e' || input === 'E') void save(true)
      return true
    },
    [save, view.kind],
  )

  const listCursor = view.kind === 'list' ? view.cursor : 0

  const handleListKeys = useCallback(
    (_input: string, key: any): boolean => {
      if (view.kind !== 'list') return false

      if (key.downArrow) {
        setView((prev) => {
          if (prev.kind !== 'list') return prev
          const nextCursor = Math.min(prev.cursor + 1, Math.max(0, listRows.length - 1))
          if (nextCursor === prev.cursor) return prev
          return { ...prev, cursor: nextCursor }
        })
        return true
      }
      if (key.upArrow) {
        setView((prev) => {
          if (prev.kind !== 'list') return prev
          const nextCursor = Math.max(prev.cursor - 1, 0)
          if (nextCursor === prev.cursor) return prev
          return { ...prev, cursor: nextCursor }
        })
        return true
      }
      if (key.return) {
        const row = listRows[listCursor]
        if (!row || row.type === 'create') startCreate()
        else pushView({ kind: 'view_agent', agent: row.agent })
        return true
      }

      return false
    },
    [listCursor, listRows, pushView, startCreate, view.kind],
  )

  const handleChoiceCursorKeys = useCallback(
    (_input: string, key: any): boolean => {
      if (
        view.kind !== 'create_scope' &&
        view.kind !== 'create_method' &&
        view.kind !== 'create_tools' &&
        view.kind !== 'create_model' &&
        view.kind !== 'create_color'
      ) {
        return false
      }

      if (key.downArrow) {
        setView((prev) => {
          if (prev.kind !== view.kind) return prev
          let max: number
          switch (prev.kind) {
            case 'create_scope':
              max = SCOPE_OPTIONS.length - 1
              break
            case 'create_method':
              max = METHOD_OPTIONS.length - 1
              break
            case 'create_tools':
              max =
                getToolsSelectableRows({
                  toolGroupChecked,
                  showAdvancedTools,
                  selectableToolNames,
                  selectedToolSet,
                }).length - 1
              break
            case 'create_model':
              max = MODEL_OPTIONS.length - 1
              break
            case 'create_color':
              max = COLOR_OPTIONS.length - 1
              break
            default:
              return prev
          }
          return { ...prev, cursor: Math.min(prev.cursor + 1, max) } as View
        })
        return true
      }

      if (key.upArrow) {
        setView((prev) => {
          if (prev.kind !== view.kind) return prev
          return { ...prev, cursor: Math.max(prev.cursor - 1, 0) } as View
        })
        return true
      }

      return false
    },
    [selectableToolNames, selectedToolSet, showAdvancedTools, toolGroupChecked, view.kind],
  )

  const handleChoiceEnterKeys = useCallback((): boolean => {
    if (view.kind !== 'create_scope' && view.kind !== 'create_method' && view.kind !== 'create_tools' && view.kind !== 'create_model' && view.kind !== 'create_color') {
      return false
    }

    if (view.kind === 'create_scope') {
      const nextScope = SCOPE_OPTIONS[view.cursor]?.value ?? 'project'
      setScope(nextScope)
      pushView({ kind: 'create_method', cursor: 0 })
      return true
    }

    if (view.kind === 'create_method') {
      const nextMethod = METHOD_OPTIONS[view.cursor]?.value ?? 'generate'
      if (nextMethod === 'generate') pushView({ kind: 'create_generate_desc' })
      else pushView({ kind: 'create_manual_name' })
      return true
    }

    if (view.kind === 'create_tools') {
      const rows = getToolsSelectableRows({ toolGroupChecked, showAdvancedTools, selectableToolNames, selectedToolSet })
      const row = rows[view.cursor]
      if (!row) return true

      if (row.type === 'continue') {
        if (selectedToolSet.size === 0) {
          pushView({ kind: 'error', message: 'Select at least one tool.' })
          return true
        }
        pushView({ kind: 'create_model', cursor: 0 })
        return true
      }

      if (row.type === 'advanced') {
        setShowAdvancedTools((v) => !v)
        return true
      }

      if (row.type === 'group') {
        toggleToolGroupSelection({
          group: row.group,
          toolGroups,
          selectedToolSet,
          onChange: setSelectedTools,
        })
        return true
      }

      if (row.type === 'tool') {
        setSelectedTools((prev) => {
          const next = new Set(prev)
          if (next.has(row.tool)) next.delete(row.tool)
          else next.add(row.tool)
          return Array.from(next)
        })
        return true
      }
      return true
    }

    if (view.kind === 'create_model') {
      setSelectedModel(MODEL_OPTIONS[view.cursor]?.label ?? 'Sonnet')
      pushView({ kind: 'create_color', cursor: 0 })
      return true
    }

    if (view.kind === 'create_color') {
      setSelectedColor(COLOR_OPTIONS[view.cursor] ?? 'Blue')
      pushView({ kind: 'confirm' })
      return true
    }

    return false
  }, [
    pushView,
    selectableToolNames,
    selectedToolSet,
    showAdvancedTools,
    toolGroupChecked,
    toolGroups,
    view,
  ])

  useScopedInput('overlay:agents', (input, key) => {
    if (handleBusyKeys(input, key)) return
    if (handleErrorKeys(input, key)) return
    if (handleManualTextKeys(input, key)) return
    if (handleGenerateDescKeys(input, key)) return

    if (handleEscapeKeys(input, key)) return
    if (handleConfirmKeys(input, key)) return
    if (handleListKeys(input, key)) return
    if (handleChoiceCursorKeys(input, key)) return

    if (key.return) {
      if (handleChoiceEnterKeys()) return
    }
  })

  if (view.kind === 'generating_draft') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <DialogFrame theme={theme}>
          <CreateAgentHeader
            theme={theme}
            description="Describe what this agent should do and when it should be used (be comprehensive for best results)"
          />
          <Spacer />
          <Text color={AGENTS_DIALOG_ACCENT}>
            <RotatingStar color={AGENTS_DIALOG_ACCENT} /> {view.message}
          </Text>
        </DialogFrame>
        <Footer theme={theme} text="Esc to cancel" />
      </Box>
    )
  }

  if (view.kind === 'saving_agent') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <DialogFrame theme={theme}>
          <CreateAgentHeader theme={theme} />
          <Text color={theme.secondaryText}>{view.message}</Text>
        </DialogFrame>
        <Footer theme={theme} text="Esc to cancel" />
      </Box>
    )
  }

  if (view.kind === 'error') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <DialogFrame theme={theme}>
          <CreateAgentHeader theme={theme} />
          <Text color={theme.error}>Error: {view.message}</Text>
        </DialogFrame>
        <Footer theme={theme} text="Press Enter or Esc to go back" />
      </Box>
    )
  }

  const box = (() => {
    switch (view.kind) {
      case 'list': {
        return (
          <AgentsListView
            theme={theme}
            agentsCount={agents.length}
            banner={view.banner ?? null}
            cursor={view.cursor}
            userAgentsDir={userAgentsDir}
            groups={groupedAgents}
          />
        )
      }

      case 'view_agent': {
        const a = view.agent
        return (
          <Box borderStyle="round" borderColor={theme.permission} flexDirection="column" paddingX={1} width="100%">
            <Text bold>Agent</Text>
            <Spacer />
            <Text color={theme.secondaryText}>{a.name}</Text>
            <Spacer />
            <Text color={theme.secondaryText}>Scope:</Text>
            <Text>  {a.scope}</Text>
            <Text color={theme.secondaryText}>Model:</Text>
            <Text>  {a.model}</Text>
            <Spacer />
            <Text color={theme.secondaryText}>Description:</Text>
            <Text>{indent(a.description || '', 2)}</Text>
            <Spacer />
          </Box>
        )
      }

      case 'create_scope': {
        return (
          <SimpleChoiceView
            theme={theme}
            title="Create new agent"
            subtitle="Choose location"
            cursor={view.cursor}
            options={SCOPE_OPTIONS.map((o) => ({ key: o.value, label: o.label }))}
          />
        )
      }

      case 'create_method': {
        return (
          <SimpleChoiceView
            theme={theme}
            title="Create new agent"
            subtitle="Creation method"
            cursor={view.cursor}
            options={METHOD_OPTIONS.map((o) => ({ key: o.value, label: o.label }))}
          />
        )
      }

      case 'create_generate_desc': {
        return <GenerateDescriptionView theme={theme} value={agentDescriptionInput} />
      }

      case 'create_manual_name': {
        return (
          <DialogFrame theme={theme}>
            <CreateAgentHeader theme={theme} />
            <Text>Write manually</Text>
            <Spacer />
            <Text>Agent name (used as subagent_type):</Text>
            <Box marginTop={1}>
              <TextInput
                value={manualNameInput}
                onChange={setManualNameInput}
                onSubmit={() => pushView({ kind: 'create_manual_desc' })}
                placeholder="e.g. code-reviewer"
              />
            </Box>
          </DialogFrame>
        )
      }

      case 'create_manual_desc': {
        return (
          <DialogFrame theme={theme}>
            <CreateAgentHeader theme={theme} />
            <Text>Write manually</Text>
            <Spacer />
            <Text>Description (tells Formax when to use this agent):</Text>
            <Box marginTop={1}>
              <TextInput
                value={manualDescInput}
                onChange={setManualDescInput}
                onSubmit={commitManualDraft}
                placeholder="When should this agent be used?"
              />
            </Box>
          </DialogFrame>
        )
      }

      case 'create_tools': {
        const rows = getToolsSelectableRows({ toolGroupChecked, showAdvancedTools, selectableToolNames, selectedToolSet })

        return (
          <DialogFrame theme={theme}>
            <Box marginBottom={1}>
              <CreateAgentHeader theme={theme} subtitle="Select tools" />
            </Box>
            <FramedRow theme={theme} active={view.cursor === 0} label="[ Continue ]" />
            <FrameDivider theme={theme} />

            {rows
              .filter((r) => r.type === 'group')
              .map((row, idx) => {
                const cursor = idx + 1
                if (row.type !== 'group') return null
                return (
                  <FramedRow
                    key={row.key}
                    theme={theme}
                    active={cursor === view.cursor}
                    checked={row.checked}
                    label={row.label}
                  />
                )
              })}
            <FrameDivider theme={theme} />
            {rows
              .filter((r) => r.type === 'advanced')
              .map((row) => (
                <FramedRow key={row.key} theme={theme} active={row.cursor === view.cursor} label={row.label} />
              ))}

            {showAdvancedTools &&
              rows
                .filter((r) => r.type === 'tool')
                .map((row) => {
                  if (row.type !== 'tool') return null
                  return (
                    <FramedRow
                      key={row.key}
                      theme={theme}
                      active={row.cursor === view.cursor}
                      checked={row.checked}
                      label={row.tool}
                    />
                  )
                })}
            <Box marginTop={1}>
              <Text color={theme.secondaryText}>
                {toolGroupChecked.all
                  ? 'All tools selected'
                  : selectedToolSet.size
                    ? `${selectedToolSet.size} tools selected`
                    : 'No tools selected'}
              </Text>
            </Box>
          </DialogFrame>
        )
      }

      case 'create_model': {
        return (
          <DialogFrame theme={theme}>
            <CreateAgentHeader
              theme={theme}
              subtitle="Select model"
              description="Model determines the agent's reasoning capabilities and speed."
            />
            <Spacer />
            {MODEL_OPTIONS.map((opt, idx) => {
              const selected = selectedModel === opt.label
              const active = idx === view.cursor
              return (
                <Box key={opt.label}>
                  <Text color={active ? AGENTS_DIALOG_ACCENT : theme.secondaryText}>{active ? '❯ ' : '  '}</Text>
                  <Text bold={active}>
                    <Text color={selected ? theme.success : undefined}>{idx + 1}. {opt.label}</Text>
                    <Text color={theme.secondaryText}>  {opt.description}</Text>
                    {selected ? <Text color={theme.success}> ✓</Text> : null}
                  </Text>
                </Box>
              )
            })}
            <Spacer />
          </DialogFrame>
        )
      }

      case 'create_color': {
        const previewName = draft?.name || normalizeAgentName(manualNameInput) || 'agent'
        const previewBg = colorToHex(selectedColor)
        return (
          <DialogFrame theme={theme}>
            <CreateAgentHeader theme={theme} subtitle="Choose background color" />
            <Spacer />
            {COLOR_OPTIONS.map((c, idx) => {
              const active = idx === view.cursor
              return (
                <Box key={c}>
                  <Text color={active ? AGENTS_DIALOG_ACCENT : theme.secondaryText}>{active ? '❯ ' : '  '}</Text>
                  <Text color={colorToHex(c)}>█ </Text>
                  <Text bold={active} color={active ? AGENTS_DIALOG_ACCENT : undefined}>
                    {c}
                  </Text>
                </Box>
              )
            })}
            <Spacer />
            <Text color={theme.secondaryText}>Preview: </Text>
            <Text backgroundColor={previewBg} color="#000">
              {' '}
              {previewName}
              {' '}
            </Text>
            <Spacer />
          </DialogFrame>
        )
      }

      case 'confirm': {
        const name = draft?.name ?? 'agent'
        const location =
          scope === 'user' ? `~/.formax/agents/${name}.md` : `.formax/agents/${name}.md`
        const warnings =
          toolsAnswer === 'All tools' ? ['Agent has access to all tools'] : []

        return (
          <DialogFrame theme={theme}>
            <CreateAgentHeader theme={theme} subtitle="Confirm and save" />
            <Spacer />
            <Text>Name: {name}</Text>
            <Text>Location: {location}</Text>
            <Text>Tools: {toolsAnswer || 'All tools'}</Text>
            <Text>Model: {selectedModel}</Text>
            <Spacer />
            <Text>Description (tells Formax when to use this agent):</Text>
            <Spacer />
            <Text>{indent(truncate(draft?.description || '', 140), 2)}</Text>
            <Spacer />
            <Text>System prompt:</Text>
            <Spacer />
            <Text>{indent(truncate(draft?.systemPrompt || '', 180), 2)}</Text>
            {warnings.length ? (
              <>
                <Spacer />
                <Text color={theme.warning}>Warnings:</Text>
                {warnings.map((w) => (
                  <Text key={w}> • {w}</Text>
                ))}
              </>
            ) : null}
            <Spacer />
            <Text color={theme.secondaryText}>Press s or Enter to save, e to save and edit</Text>
          </DialogFrame>
        )
      }
    }
  })()

  return (
    <Box flexDirection="column" marginTop={1}>
      {box}
      <Footer theme={theme} text={hint} />
    </Box>
  )
}

function normalizeAgentName(raw: string): string {
  const s = String(raw || '').trim().toLowerCase()
  return s
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+/, '')
    .replace(/[-_]+$/, '')
}

function buildManualSystemPrompt(args: { name: string; description: string }): string {
  return [
    `You are the ${args.name} agent.`,
    '',
    `When to use: ${args.description}`,
    '',
    'Be concise and helpful.',
  ].join('\n')
}

function truncate(s: string, max: number): string {
  const str = String(s || '')
  if (str.length <= max) return str
  return str.slice(0, Math.max(0, max - 1)) + '…'
}

function indent(s: string, spaces: number): string {
  const pad = ' '.repeat(Math.max(0, spaces))
  return s
    .split(/\r?\n/)
    .map((line) => (line ? pad + line : line))
    .join('\n')
}

function colorToHex(color: string): string {
  const c = String(color || '').trim().toLowerCase()
  return COLOR_MAP[c] ?? AGENTS_DIALOG_ACCENT
}

const NON_SELECTABLE_TOOLS = new Set([
  'Task',
  'TaskOutput',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'KillShell',
])

type ToolsSelectableRow =
  | { type: 'continue'; key: string; cursor: number }
  | { type: 'group'; key: string; cursor: number; group: 'all' | 'readOnly' | 'edit' | 'execution' | 'other'; label: string; checked: boolean }
  | { type: 'advanced'; key: string; cursor: number; label: string }
  | { type: 'tool'; key: string; cursor: number; tool: string; checked: boolean }

function getToolsSelectableRows(args: {
  toolGroupChecked: {
    all: boolean
    readOnly: boolean
    edit: boolean
    execution: boolean
    other: boolean
  }
  showAdvancedTools: boolean
  selectableToolNames: string[]
  selectedToolSet: Set<string>
}): ToolsSelectableRow[] {
  const rows: ToolsSelectableRow[] = []
  let cursor = 0

  rows.push({ type: 'continue', key: 'continue', cursor })
  cursor++

  rows.push({
    type: 'group',
    key: 'group-all',
    cursor,
    group: 'all',
    label: 'All tools',
    checked: args.toolGroupChecked.all,
  })
  cursor++

  rows.push({
    type: 'group',
    key: 'group-readonly',
    cursor,
    group: 'readOnly',
    label: 'Read-only tools',
    checked: args.toolGroupChecked.readOnly,
  })
  cursor++

  rows.push({
    type: 'group',
    key: 'group-edit',
    cursor,
    group: 'edit',
    label: 'Edit tools',
    checked: args.toolGroupChecked.edit,
  })
  cursor++

  rows.push({
    type: 'group',
    key: 'group-exec',
    cursor,
    group: 'execution',
    label: 'Execution tools',
    checked: args.toolGroupChecked.execution,
  })
  cursor++

  rows.push({
    type: 'group',
    key: 'group-other',
    cursor,
    group: 'other',
    label: 'Other tools',
    checked: args.toolGroupChecked.other,
  })
  cursor++

  rows.push({
    type: 'advanced',
    key: 'advanced',
    cursor,
    label: args.showAdvancedTools ? '[ Hide advanced options ]' : '[ Show advanced options ]',
  })
  cursor++

  if (args.showAdvancedTools) {
    for (const tool of args.selectableToolNames) {
      rows.push({
        type: 'tool',
        key: `tool-${tool}`,
        cursor,
        tool,
        checked: args.selectedToolSet.has(tool),
      })
      cursor++
    }
  }

  return rows
}

function toggleToolGroupSelection(args: {
  group: 'all' | 'readOnly' | 'edit' | 'execution' | 'other'
  toolGroups: {
    all: Set<string>
    readOnly: Set<string>
    edit: Set<string>
    execution: Set<string>
    other: Set<string>
  }
  selectedToolSet: Set<string>
  onChange: (next: string[]) => void
}): void {
  const groupSet = args.toolGroups[args.group]
  const isOn = groupSet.size > 0 && Array.from(groupSet).every((t) => args.selectedToolSet.has(t))

  if (args.group === 'all') {
    args.onChange(isOn ? [] : Array.from(groupSet))
    return
  }

  const next = new Set(args.selectedToolSet)
  if (isOn) {
    for (const t of groupSet) next.delete(t)
  } else {
    for (const t of groupSet) next.add(t)
  }
  args.onChange(Array.from(next))
}

async function readAgentDir(dir: string): Promise<Record<string, { name: string; model: string; filePath: string }>> {
  const out: Record<string, { name: string; model: string; filePath: string }> = {}
  if (!dir) return out

  let entries: string[] = []
  try {
    entries = await fsp.readdir(dir)
  } catch {
    return out
  }

  await Promise.all(
    entries
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .map(async (fileName) => {
        const filePath = path.join(dir, fileName)
        let raw = ''
        try {
          raw = await fsp.readFile(filePath, 'utf8')
        } catch {
          return
        }
        const fm = parseFrontmatter(raw)
        const name = String(fm.name || path.basename(fileName, '.md')).trim()
        const modelRaw = String(fm.model || '').trim()
        const model = modelRaw ? modelRaw.toLowerCase() : 'inherit'
        out[name.toLowerCase()] = { name, model, filePath }
      }),
  )

  return out
}

function parseFrontmatter(raw: string): Record<string, string> {
  const text = String(raw || '').trim()
  if (!text) return {}
  const lines = text.split(/\r?\n/)
  if (lines[0] !== '---') return {}
  const out: Record<string, string> = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '---') break
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const k = line.slice(0, idx).trim()
    if (!k) continue
    let v = line.slice(idx + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}
