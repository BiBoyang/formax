import React, { useCallback, useEffect, useMemo, useRef, useState, useReducer } from 'react'
import { Box, Text } from 'ink'
import TextInput from '../../components/ui/TextInput'
import { RotatingStar } from '../../components/ui/RotatingStar'
import { getTheme } from '../../utils/theme'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext.js'
import { consumeBufferedArrow } from '../../features/repl/keys/escapeSequences.js'
import {
  Spacer,
  DialogFrame,
  CreateAgentHeader,
  Footer,
  FramedRow,
  FrameDivider,
  AgentsListView,
  SimpleChoiceView,
  GenerateDescriptionView,
} from './ui.js'
import {
  type AgentListItem,
  type AgentsDialogGenerateDraft,
  type AgentsDialogSaveArgs,
  type AgentsDialogSaveResult,
  type AgentMeta,
  type DiskAgentInfo,
  BUILTIN_AGENT_NAMES,
  BUILTIN_MODEL_BY_NAME,
  METHOD_OPTIONS,
  MODEL_OPTIONS,
  COLOR_OPTIONS,
  SCOPE_OPTIONS,
  NON_SELECTABLE_TOOLS,
  type View,
} from './constants.js'
import {
  normalizeAgentName,
  buildManualSystemPrompt,
  truncate,
  indent,
  colorToHex,
  getToolsSelectableRows,
  readAgentDir,
} from './utils.js'
import { dialogReducer, initialDialogState } from './reducer.js'

// Re-export public types for backward compatibility
export type { AgentsDialogGenerateDraft, AgentsDialogSaveArgs, AgentsDialogSaveResult }

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
  const escapeBufferRef = useRef('')

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

  const [state, dispatch] = useReducer(dialogReducer, initialDialogState())
  const { view, stack, draft, scope, agentDescriptionInput, manualNameInput, manualDescInput, selectedModel, selectedColor, showAdvancedTools, selectedTools } = state

  const viewRef = useRef<View>({ kind: 'list', cursor: 0, banner: null })
  useEffect(() => {
    viewRef.current = view
  }, [view])
  const [createdAgents, setCreatedAgents] = useState<string[]>([])
  const opSeqRef = useRef(0)
  const activeOpRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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
    dispatch({ type: 'RESET_CREATE_STATE', selectableToolNames })
  }, [selectableToolNames])

  const pushView = useCallback((next: View) => {
    dispatch({ type: 'PUSH_VIEW', view: next })
  }, [])

  const popView = useCallback(() => {
    dispatch({ type: 'POP_VIEW' })
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
      dispatch({ type: 'SET_DRAFT', draft: generated })
      dispatch({ type: 'SET_VIEW', view: { kind: 'create_tools', cursor: 0 } })
    } catch (e) {
      if (activeOpRef.current !== opId) return
      if (abortController.signal.aborted) return
      const msg = e instanceof Error ? e.message : String(e)
      dispatch({ type: 'SET_VIEW', view: { kind: 'error', message: msg || 'Generate failed' } })
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
    dispatch({ type: 'SET_DRAFT', draft: { name, description: desc, systemPrompt } })
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
        setCreatedAgents((prev: string[]) => [...prev, out.name])
        dispatch({ type: 'RESET_TO_LIST', banner: `Created agent: ${out.name}` })
      } catch (e) {
        if (activeOpRef.current !== opId) return
        const msg = e instanceof Error ? e.message : String(e)
        dispatch({ type: 'SET_VIEW', view: { kind: 'error', message: msg || 'Save failed' } })
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
        const prev = view
        const nextCursor = Math.min(prev.cursor + 1, Math.max(0, listRows.length - 1))
        if (nextCursor === prev.cursor) return true
        dispatch({ type: 'MOVE_CURSOR', cursor: nextCursor })
        return true
      }
      if (key.upArrow) {
        const prev = view
        const nextCursor = Math.max(prev.cursor - 1, 0)
        if (nextCursor === prev.cursor) return true
        dispatch({ type: 'MOVE_CURSOR', cursor: nextCursor })
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
    [listCursor, listRows, pushView, startCreate, view],
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
        const prev = view
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
            return false
        }
        dispatch({ type: 'MOVE_CURSOR', cursor: Math.min(prev.cursor + 1, max) })
        return true
      }

      if (key.upArrow) {
        const prev = view
        dispatch({ type: 'MOVE_CURSOR', cursor: Math.max(prev.cursor - 1, 0) })
        return true
      }

      return false
    },
    [selectableToolNames, selectedToolSet, showAdvancedTools, toolGroupChecked, view],
  )

  const handleChoiceEnterKeys = useCallback((): boolean => {
    if (view.kind !== 'create_scope' && view.kind !== 'create_method' && view.kind !== 'create_tools' && view.kind !== 'create_model' && view.kind !== 'create_color') {
      return false
    }

    if (view.kind === 'create_scope') {
      const nextScope = SCOPE_OPTIONS[view.cursor]?.value ?? 'project'
      dispatch({ type: 'SET_SCOPE', scope: nextScope })
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
        dispatch({ type: 'SET_ADVANCED_TOOLS', show: !showAdvancedTools })
        return true
      }

      if (row.type === 'group') {
        dispatch({
          type: 'TOGGLE_TOOL_GROUP',
          group: row.group,
          toolGroups,
        })
        return true
      }

      if (row.type === 'tool') {
        const next = new Set(selectedTools)
        if (next.has(row.tool)) next.delete(row.tool)
        else next.add(row.tool)
        dispatch({ type: 'SET_TOOLS', tools: Array.from(next) })
        return true
      }
      return true
    }

    if (view.kind === 'create_model') {
      dispatch({ type: 'SET_MODEL', model: MODEL_OPTIONS[view.cursor]?.label ?? 'Sonnet' })
      pushView({ kind: 'create_color', cursor: 0 })
      return true
    }

    if (view.kind === 'create_color') {
      dispatch({ type: 'SET_COLOR', color: COLOR_OPTIONS[view.cursor] ?? 'Blue' })
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
    selectedTools,
    view,
  ])

  useScopedInput('overlay:agents', (input, key) => {
    const seq = (key as unknown as { sequence?: string } | undefined)?.sequence
    const token = (typeof seq === 'string' && seq.length > 0 ? seq : input) || ''
    const keyName = typeof (key as any)?.name === 'string' ? String((key as any).name) : ''

    if (key.escape || keyName === 'escape') escapeBufferRef.current = ''

    const isUpArrowKey = keyName === 'up' || Boolean((key as any)?.upArrow)
    const isDownArrowKey = keyName === 'down' || Boolean((key as any)?.downArrow)

    // In some environments/tests, arrow escape sequences can arrive split or batched across
    // multiple `useInput` calls. Buffer ESC sequences so Up/Down always work reliably.
    let bufferedDelta = 0
    if (!isUpArrowKey && !isDownArrowKey && token) {
      const res = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
      escapeBufferRef.current = res.nextBuffer
      if (res.pending && res.delta === 0) return
      bufferedDelta = res.delta
    }

    const arrowDelta = (isUpArrowKey ? -1 : 0) + (isDownArrowKey ? 1 : 0) + bufferedDelta

    if (arrowDelta !== 0) {
      if (view.kind === 'list') {
        const max = Math.max(0, listRows.length - 1)
        dispatch({ type: 'MOVE_CURSOR', cursor: Math.max(0, Math.min(view.cursor + arrowDelta, max)) })
        return
      }

      if (
        view.kind === 'create_scope' ||
        view.kind === 'create_method' ||
        view.kind === 'create_tools' ||
        view.kind === 'create_model' ||
        view.kind === 'create_color'
      ) {
        let max = 0
        switch (view.kind) {
          case 'create_scope':
            max = Math.max(0, SCOPE_OPTIONS.length - 1)
            break
          case 'create_method':
            max = Math.max(0, METHOD_OPTIONS.length - 1)
            break
          case 'create_tools':
            max = Math.max(
              0,
              getToolsSelectableRows({
                toolGroupChecked,
                showAdvancedTools,
                selectableToolNames,
                selectedToolSet,
              }).length - 1,
            )
            break
          case 'create_model':
            max = Math.max(0, MODEL_OPTIONS.length - 1)
            break
          case 'create_color':
            max = Math.max(0, COLOR_OPTIONS.length - 1)
            break
        }
        dispatch({ type: 'MOVE_CURSOR', cursor: Math.max(0, Math.min(view.cursor + arrowDelta, max)) })
        return
      }
    }

    const patchedKey = key as any
    const forwardedInput = input

    if (handleBusyKeys(forwardedInput, patchedKey)) return
    if (handleErrorKeys(forwardedInput, patchedKey)) return
    if (handleManualTextKeys(forwardedInput, patchedKey)) return

    if (handleEscapeKeys(forwardedInput, patchedKey)) return
    if (handleConfirmKeys(forwardedInput, patchedKey)) return
    if (handleListKeys(forwardedInput, patchedKey)) return
    if (handleChoiceCursorKeys(forwardedInput, patchedKey)) return

    const isEnter = Boolean(patchedKey.return) || keyName === 'return' || token === '\r' || token === '\n'
    if (isEnter) {
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
          <Text color={theme.permission}>
            <RotatingStar color={theme.permission} /> {view.message}
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
        return (
          <GenerateDescriptionView
            theme={theme}
            value={agentDescriptionInput}
            onChange={(value) => dispatch({ type: 'SET_DESCRIPTION_INPUT', value })}
            onSubmit={() => void startGenerateDraft()}
          />
        )
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
                onChange={(value) => dispatch({ type: 'SET_MANUAL_NAME_INPUT', value })}
                onSubmit={() => pushView({ kind: 'create_manual_desc' })}
                placeholder="e.g. code-reviewer"
                scope="overlay:agents"
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
                onChange={(value) => dispatch({ type: 'SET_MANUAL_DESC_INPUT', value })}
                onSubmit={commitManualDraft}
                placeholder="When should this agent be used?"
                scope="overlay:agents"
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
                  <Text color={active ? theme.permission : theme.secondaryText}>{active ? '❯ ' : '  '}</Text>
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
        const previewBg = colorToHex(selectedColor, theme.permission)
        return (
          <DialogFrame theme={theme}>
            <CreateAgentHeader theme={theme} subtitle="Choose background color" />
            <Spacer />
            {COLOR_OPTIONS.map((c, idx) => {
              const active = idx === view.cursor
              return (
                <Box key={c}>
                  <Text color={active ? theme.permission : theme.secondaryText}>{active ? '❯ ' : '  '}</Text>
                  <Text color={colorToHex(c, theme.permission)}>█ </Text>
                  <Text bold={active} color={active ? theme.permission : undefined}>
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
