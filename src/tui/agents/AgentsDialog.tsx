import React, { useCallback, useEffect, useMemo, useRef, useState, useReducer } from 'react'
import { Box, Text } from 'ink'
import TextInput from '../../components/ui/TextInput'
import { RotatingStar } from '../../components/ui/RotatingStar'
import { getTheme } from '../theme'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext.js'
import { consumeBufferedArrow } from '../../features/repl/keys/escapeSequences.js'
import { getInputToken, getKeyName, getVerticalArrowKeyDelta, isReturnKeyToken } from '../../features/repl/keys/keyTokens.js'
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
import type {
  AgentsDialogGenerateDraft,
  AgentsDialogSaveArgs,
  AgentsDialogSaveResult,
} from '../../shared/replDialogContracts.js'
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

function buildGroupedAgents(
  agents: AgentListItem[],
  diskProjectAgents: Record<string, DiskAgentInfo>,
  diskUserAgents: Record<string, DiskAgentInfo>,
): { userAgents: AgentMeta[]; projectAgents: AgentMeta[]; builtins: AgentMeta[] } {
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
}

function computeToolsAnswer(
  selectableToolNames: string[],
  selectedToolSet: Set<string>,
  toolGroups: { readOnly: Set<string>; edit: Set<string>; execution: Set<string> },
): string {
  const selectedSorted = Array.from(selectedToolSet).sort((a, b) => a.localeCompare(b))
  const exact = (want: string[]) => selectedSorted.length === want.length && want.every((t) => selectedToolSet.has(t))
  if (exact(selectableToolNames)) return 'All tools'
  if (exact(Array.from(toolGroups.readOnly))) return 'Read-only tools'
  if (exact(Array.from(toolGroups.edit))) return 'Edit tools'
  if (exact(Array.from(toolGroups.execution))) return 'Execution tools'
  return selectedSorted.join(', ')
}

function getHintForView(kind: View['kind']): string {
  if (kind === 'confirm') return 's/Enter to save · e to save and edit in your editor · Esc to cancel'
  if (kind === 'create_manual_name' || kind === 'create_manual_desc') return 'Enter to continue · Esc to go back'
  if (kind === 'create_generate_desc') return 'Enter to submit · Esc to go back'
  if (kind === 'generating_draft' || kind === 'saving_agent') return 'Esc to cancel'
  if (kind === 'create_scope') return '↑↓ to navigate · Enter to select · Esc to cancel'
  return 'Press ↑↓ to navigate · Enter to select · Esc to go back'
}

function toErrorMessage(error: unknown, fallback: string): string {
  const msg = error instanceof Error ? error.message : String(error)
  return msg || fallback
}

function isBusyView(kind: View['kind']): boolean {
  return kind === 'generating_draft' || kind === 'saving_agent'
}

function isManualTextView(kind: View['kind']): boolean {
  return kind === 'create_manual_name' || kind === 'create_manual_desc'
}

function isChoiceView(kind: View['kind']): kind is 'create_scope' | 'create_method' | 'create_tools' | 'create_model' | 'create_color' {
  return kind === 'create_scope' || kind === 'create_method' || kind === 'create_tools' || kind === 'create_model' || kind === 'create_color'
}

function shouldAwaitBufferedArrow(res: { pending: boolean; delta: number }): boolean {
  return res.pending && res.delta === 0
}

function getChoiceMaxCursor(args: {
  kind: 'create_scope' | 'create_method' | 'create_tools' | 'create_model' | 'create_color'
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
}): number {
  switch (args.kind) {
    case 'create_scope':
      return Math.max(0, SCOPE_OPTIONS.length - 1)
    case 'create_method':
      return Math.max(0, METHOD_OPTIONS.length - 1)
    case 'create_tools':
      return Math.max(
        0,
        getToolsSelectableRows({
          toolGroupChecked: args.toolGroupChecked,
          showAdvancedTools: args.showAdvancedTools,
          selectableToolNames: args.selectableToolNames,
          selectedToolSet: args.selectedToolSet,
        }).length - 1,
      )
    case 'create_model':
      return Math.max(0, MODEL_OPTIONS.length - 1)
    case 'create_color':
      return Math.max(0, COLOR_OPTIONS.length - 1)
  }
}

function getToolsSelectionText(toolGroupCheckedAll: boolean, selectedToolCount: number): string {
  if (toolGroupCheckedAll) return 'All tools selected'
  if (selectedToolCount) return `${selectedToolCount} tools selected`
  return 'No tools selected'
}

function getPreviewNameForColor(draftName: string | undefined, manualNameInput: string): string {
  return draftName || normalizeAgentName(manualNameInput) || 'agent'
}

function getConfirmViewData(args: {
  draftName?: string
  draftDescription?: string
  draftSystemPrompt?: string
  scope: 'user' | 'project'
  toolsAnswer: string
  selectedModel: string
}): {
  name: string
  location: string
  tools: string
  selectedModel: string
  description: string
  systemPrompt: string
  warnings: string[]
} {
  const name = args.draftName ?? 'agent'
  const location = args.scope === 'user' ? `~/.formax/agents/${name}.md` : `.formax/agents/${name}.md`
  const warnings = args.toolsAnswer === 'All tools' ? ['Agent has access to all tools'] : []
  return {
    name,
    location,
    tools: args.toolsAnswer || 'All tools',
    selectedModel: args.selectedModel,
    description: args.draftDescription || '',
    systemPrompt: args.draftSystemPrompt || '',
    warnings,
  }
}

function getConfirmSaveAction(args: { input: string; key: { return?: boolean } }): 'save' | 'save_and_edit' | null {
  if (args.key.return || args.input === 's' || args.input === 'S') return 'save'
  if (args.input === 'e' || args.input === 'E') return 'save_and_edit'
  return null
}

function getArrowNavigationMax(args: {
  kind: View['kind']
  listLength: number
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
}): number | undefined {
  if (args.kind === 'list') return Math.max(0, args.listLength - 1)
  if (isChoiceView(args.kind)) {
    return getChoiceMaxCursor({
      kind: args.kind,
      toolGroupChecked: args.toolGroupChecked,
      showAdvancedTools: args.showAdvancedTools,
      selectableToolNames: args.selectableToolNames,
      selectedToolSet: args.selectedToolSet,
    })
  }
  return undefined
}

type ChoiceEnterResolution =
  | { handled: false }
  | { handled: true; action: 'set_scope'; scope: 'user' | 'project' }
  | { handled: true; action: 'set_method'; method: 'generate' | 'manual' }
  | { handled: true; action: 'tools_missing_selection' }
  | { handled: true; action: 'tools_continue' }
  | { handled: true; action: 'tools_toggle_advanced'; show: boolean }
  | { handled: true; action: 'tools_toggle_group'; group: 'all' | 'readOnly' | 'edit' | 'execution' | 'other' }
  | { handled: true; action: 'tools_set_selection'; tools: string[] }
  | { handled: true; action: 'set_model'; model: string }
  | { handled: true; action: 'set_color'; color: string }

function resolveListEnterAction(args: {
  kind: View['kind']
  row: { type: 'create' } | { type: 'agent'; agent: AgentMeta } | undefined
}): { handled: boolean; action?: 'start_create' | 'view_agent'; agent?: AgentMeta } {
  if (args.kind !== 'list') return { handled: false }
  if (!args.row || args.row.type === 'create') return { handled: true, action: 'start_create' }
  return { handled: true, action: 'view_agent', agent: args.row.agent }
}

function resolveChoiceEnterAction(args: {
  kind: View['kind']
  cursor: number
  selectedToolSet: Set<string>
  selectedTools: string[]
  showAdvancedTools: boolean
  selectableToolNames: string[]
  toolGroupChecked: {
    all: boolean
    readOnly: boolean
    edit: boolean
    execution: boolean
    other: boolean
  }
}): ChoiceEnterResolution {
  if (!isChoiceView(args.kind)) return { handled: false }

  if (args.kind === 'create_scope') {
    const scope = SCOPE_OPTIONS[args.cursor]?.value ?? 'project'
    return { handled: true, action: 'set_scope', scope }
  }

  if (args.kind === 'create_method') {
    const method = METHOD_OPTIONS[args.cursor]?.value ?? 'generate'
    return { handled: true, action: 'set_method', method }
  }

  if (args.kind === 'create_tools') {
    const rows = getToolsSelectableRows({
      toolGroupChecked: args.toolGroupChecked,
      showAdvancedTools: args.showAdvancedTools,
      selectableToolNames: args.selectableToolNames,
      selectedToolSet: args.selectedToolSet,
    })
    const row = rows[args.cursor]
    if (!row) return { handled: false }

    switch (row.type) {
      case 'continue':
        if (args.selectedToolSet.size === 0) return { handled: true, action: 'tools_missing_selection' }
        return { handled: true, action: 'tools_continue' }
      case 'advanced':
        return { handled: true, action: 'tools_toggle_advanced', show: !args.showAdvancedTools }
      case 'group':
        return { handled: true, action: 'tools_toggle_group', group: row.group }
      case 'tool': {
        const next = new Set(args.selectedTools)
        if (next.has(row.tool)) next.delete(row.tool)
        else next.add(row.tool)
        return { handled: true, action: 'tools_set_selection', tools: Array.from(next) }
      }
    }
  }

  if (args.kind === 'create_model') {
    const model = MODEL_OPTIONS[args.cursor]?.label ?? 'Sonnet'
    return { handled: true, action: 'set_model', model }
  }

  const color = COLOR_OPTIONS[args.cursor] ?? 'Blue'
  return { handled: true, action: 'set_color', color }
}

function validateManualDraft(
  manualNameInput: string,
  manualDescInput: string,
): { error?: string; draft?: { name: string; description: string; systemPrompt: string } } {
  const name = normalizeAgentName(manualNameInput)
  if (!name) return { error: 'Missing agent name.' }
  const description = manualDescInput.trim()
  if (!description) return { error: 'Missing agent description.' }
  const systemPrompt = buildManualSystemPrompt({ name, description })
  return { draft: { name, description, systemPrompt } }
}

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
    return buildGroupedAgents(agents, diskProjectAgents, diskUserAgents)
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
    return computeToolsAnswer(selectableToolNames, selectedToolSet, {
      readOnly: toolGroups.readOnly,
      edit: toolGroups.edit,
      execution: toolGroups.execution,
    })
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

    pushView({ kind: 'generating_draft', message: 'Generating agent from description...' })
    try {
      const generated = await onGenerateDraft(desc, abortController.signal)
      dispatch({ type: 'SET_DRAFT', draft: generated })
      dispatch({ type: 'SET_VIEW', view: { kind: 'create_tools', cursor: 0 } })
    } catch (e) {
      if (abortController.signal.aborted) return
      dispatch({ type: 'SET_VIEW', view: { kind: 'error', message: toErrorMessage(e, 'Generate failed') } })
    } finally {
      if (abortRef.current === abortController) abortRef.current = null
    }
  }, [agentDescriptionInput, onGenerateDraft, pushView])

  const commitManualDraft = useCallback(() => {
    const result = validateManualDraft(manualNameInput, manualDescInput)
    if (result.error) {
      pushView({ kind: 'error', message: result.error })
      return
    }
    dispatch({ type: 'SET_DRAFT', draft: result.draft! })
    pushView({ kind: 'create_tools', cursor: 0 })
  }, [manualDescInput, manualNameInput, pushView])

  const save = useCallback(
    async (openInEditor: boolean) => {
      /* c8 ignore start */
      if (!draft) return
      /* c8 ignore stop */
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

        setCreatedAgents((prev: string[]) => [...prev, out.name])
        dispatch({ type: 'RESET_TO_LIST', banner: `Created agent: ${out.name}` })
      } catch (e) {
        dispatch({ type: 'SET_VIEW', view: { kind: 'error', message: toErrorMessage(e, 'Save failed') } })
      }
    },
    [draft, onSaveAgent, pushView, scope, selectedColor, selectedModel, toolsAnswer],
  )

  const hint = useMemo(() => {
    return getHintForView(view.kind)
  }, [view.kind])

  const handleBusyKeys = useCallback(
    (_input: string, key: any): boolean => {
      if (!isBusyView(view.kind)) return false
      /* c8 ignore start */
      if (key.escape) cancelBusy()
      /* c8 ignore stop */
      return true
    },
    [cancelBusy, view.kind],
  )

  const handleErrorKeys = useCallback(
    (_input: string, key: any): boolean => {
      if (view.kind !== 'error') return false
      /* c8 ignore start */
      if (key.escape || key.return) popView()
      /* c8 ignore stop */
      return true
    },
    [popView, view.kind],
  )

  const handleManualTextKeys = useCallback(
    (_input: string, key: any): boolean => {
      if (!isManualTextView(view.kind) || !key.escape) return false
      popView()
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
      const action = getConfirmSaveAction({ input, key })
      /* c8 ignore start */
      if (action === 'save') void save(false)
      else if (action === 'save_and_edit') void save(true)
      /* c8 ignore stop */
      return true
    },
    [save, view.kind],
  )

  const listCursor = view.kind === 'list' ? view.cursor : 0

  const handleListKeys = useCallback(
    (_input: string, key: any): boolean => {
      if (view.kind !== 'list' || !key.return) return false
      const row = listRows[listCursor]
      if (!row || row.type === 'create') startCreate()
      else pushView({ kind: 'view_agent', agent: row.agent })
      return true
    },
    [listCursor, listRows, pushView, startCreate, view],
  )

  const handleChoiceEnterKeys = useCallback((): boolean => {
    const resolved = resolveChoiceEnterAction({
      kind: view.kind,
      cursor: view.kind === 'list' || view.kind === 'confirm' || view.kind === 'view_agent' || view.kind === 'create_generate_desc' || view.kind === 'create_manual_name' || view.kind === 'create_manual_desc' || view.kind === 'generating_draft' || view.kind === 'saving_agent' || view.kind === 'error'
        ? 0
        : view.cursor,
      selectedToolSet,
      selectedTools,
      showAdvancedTools,
      selectableToolNames,
      toolGroupChecked,
    })
    if (!resolved.handled) return false

    switch (resolved.action) {
      case 'set_scope':
        dispatch({ type: 'SET_SCOPE', scope: resolved.scope })
        pushView({ kind: 'create_method', cursor: 0 })
        return true
      case 'set_method':
        if (resolved.method === 'generate') pushView({ kind: 'create_generate_desc' })
        else pushView({ kind: 'create_manual_name' })
        return true
      case 'tools_missing_selection':
        pushView({ kind: 'error', message: 'Select at least one tool.' })
        return true
      case 'tools_continue':
        pushView({ kind: 'create_model', cursor: 0 })
        return true
      case 'tools_toggle_advanced':
        dispatch({ type: 'SET_ADVANCED_TOOLS', show: resolved.show })
        return true
      case 'tools_toggle_group':
        dispatch({ type: 'TOGGLE_TOOL_GROUP', group: resolved.group, toolGroups })
        return true
      case 'tools_set_selection':
        dispatch({ type: 'SET_TOOLS', tools: resolved.tools })
        return true
      case 'set_model':
        dispatch({ type: 'SET_MODEL', model: resolved.model })
        pushView({ kind: 'create_color', cursor: 0 })
        return true
      case 'set_color':
        dispatch({ type: 'SET_COLOR', color: resolved.color })
        pushView({ kind: 'confirm' })
        return true
    }
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
    const token = getInputToken({ input, key })
    const keyName = getKeyName(key)

    if (key.escape || keyName === 'escape') escapeBufferRef.current = ''

    const keyDelta = getVerticalArrowKeyDelta(key)
    const hasArrowKeyDelta = keyDelta !== 0

    // In some environments/tests, arrow escape sequences can arrive split or batched across
    // multiple `useInput` calls. Buffer ESC sequences so Up/Down always work reliably.
    let bufferedDelta = 0
    if (!hasArrowKeyDelta && token) {
      const res = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
      escapeBufferRef.current = res.nextBuffer
      /* c8 ignore start */
      if (shouldAwaitBufferedArrow(res)) return
      /* c8 ignore stop */
      bufferedDelta = res.delta
    }

    const arrowDelta = keyDelta + bufferedDelta

    if (arrowDelta !== 0) {
      const max = getArrowNavigationMax({
        kind: view.kind,
        listLength: listRows.length,
        toolGroupChecked,
        showAdvancedTools,
        selectableToolNames,
        selectedToolSet,
      })
      /* c8 ignore start */
      if (max !== undefined) {
        dispatch({ type: 'MOVE_CURSOR', cursor: Math.max(0, Math.min(view.cursor + arrowDelta, max)) })
        return
      }
      /* c8 ignore stop */
    }

    const patchedKey = key as any
    const forwardedInput = input

    if (handleBusyKeys(forwardedInput, patchedKey)) return
    if (handleErrorKeys(forwardedInput, patchedKey)) return
    if (handleManualTextKeys(forwardedInput, patchedKey)) return

    if (handleEscapeKeys(forwardedInput, patchedKey)) return
    if (handleConfirmKeys(forwardedInput, patchedKey)) return
    if (handleListKeys(forwardedInput, patchedKey)) return
    if (isReturnKeyToken({ token, key: patchedKey }) && handleChoiceEnterKeys()) return
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
        const description = a.description || ''
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
            <Text>{indent(description, 2)}</Text>
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
                {getToolsSelectionText(toolGroupChecked.all, selectedToolSet.size)}
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
        const previewName = getPreviewNameForColor(draft?.name, manualNameInput)
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
        const confirm = getConfirmViewData({
          draftName: draft?.name,
          draftDescription: draft?.description,
          draftSystemPrompt: draft?.systemPrompt,
          scope,
          toolsAnswer,
          selectedModel,
        })

        return (
          <DialogFrame theme={theme}>
            <CreateAgentHeader theme={theme} subtitle="Confirm and save" />
            <Spacer />
            <Text>Name: {confirm.name}</Text>
            <Text>Location: {confirm.location}</Text>
            <Text>Tools: {confirm.tools}</Text>
            <Text>Model: {confirm.selectedModel}</Text>
            <Spacer />
            <Text>Description (tells Formax when to use this agent):</Text>
            <Spacer />
            <Text>{indent(truncate(confirm.description, 140), 2)}</Text>
            <Spacer />
            <Text>System prompt:</Text>
            <Spacer />
            <Text>{indent(truncate(confirm.systemPrompt, 180), 2)}</Text>
            {confirm.warnings.length ? (
              <>
                <Spacer />
                <Text color={theme.warning}>Warnings:</Text>
                {confirm.warnings.map((w) => (
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

export const __agentsDialogTestOnly = {
  buildGroupedAgents,
  computeToolsAnswer,
  getHintForView,
  toErrorMessage,
  isBusyView,
  isManualTextView,
  isChoiceView,
  shouldAwaitBufferedArrow,
  getChoiceMaxCursor,
  getToolsSelectionText,
  getPreviewNameForColor,
  getConfirmViewData,
  getConfirmSaveAction,
  getArrowNavigationMax,
  resolveListEnterAction,
  resolveChoiceEnterAction,
  validateManualDraft,
}
