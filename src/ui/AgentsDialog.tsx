import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from '../components/ui/TextInput'
import { getTheme } from '../utils/theme'

type AgentListItem = { name: string; description: string }

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

export function AgentsDialog({
  agents,
  toolNames,
  onGenerateDraft,
  onSaveAgent,
  onExit,
}: {
  agents: AgentListItem[]
  toolNames: string[]
  onGenerateDraft: (description: string, signal?: AbortSignal) => Promise<AgentsDialogGenerateDraft>
  onSaveAgent: (args: AgentsDialogSaveArgs) => Promise<AgentsDialogSaveResult>
  onExit: (args: { createdAgents: string[] }) => void
}): React.ReactNode {
  const theme = getTheme()

  const builtinNames = useMemo(
    () =>
      new Set(
        ['general-purpose', 'statusline-setup', 'explore', 'plan', 'claude-code-guide'].map((s) =>
          s.toLowerCase(),
        ),
      ),
    [],
  )

  const groupedAgents = useMemo(() => {
    const projectAgents: AgentListItem[] = []
    const builtins: AgentListItem[] = []

    for (const agent of agents) {
      if (builtinNames.has(agent.name.toLowerCase())) builtins.push(agent)
      else projectAgents.push(agent)
    }

    projectAgents.sort((a, b) => a.name.localeCompare(b.name))
    builtins.sort((a, b) => a.name.localeCompare(b.name))

    return { projectAgents, builtins }
  }, [agents, builtinNames])

  type View =
    | { kind: 'list'; cursor: number; banner?: string | null }
    | { kind: 'view_agent'; agent: AgentListItem }
    | { kind: 'create_scope'; cursor: number }
    | { kind: 'create_method'; cursor: number }
    | { kind: 'create_generate_desc' }
    | { kind: 'create_manual_name' }
    | { kind: 'create_manual_desc' }
    | { kind: 'create_tools'; cursor: number }
    | { kind: 'create_model'; cursor: number }
    | { kind: 'create_color'; cursor: number }
    | { kind: 'confirm' }
    | { kind: 'busy'; message: string }
    | { kind: 'error'; message: string }

  const [view, setView] = useState<View>({ kind: 'list', cursor: 0, banner: null })
  const [stack, setStack] = useState<View[]>([])
  const [createdAgents, setCreatedAgents] = useState<string[]>([])
  const opSeqRef = useRef(0)
  const activeOpRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [draft, setDraft] = useState<AgentsDialogGenerateDraft | null>(null)
  const [scope, setScope] = useState<'project' | 'user'>('project')
  const [method, setMethod] = useState<'manual' | 'generate'>('generate')
  const [agentDescriptionInput, setAgentDescriptionInput] = useState('')
  const [manualNameInput, setManualNameInput] = useState('')
  const [manualDescInput, setManualDescInput] = useState('')

  const [selectedModel, setSelectedModel] = useState('Sonnet')
  const [selectedColor, setSelectedColor] = useState('Automatic')
  const [toolGroups, setToolGroups] = useState(() => ({
    readOnly: true,
    edit: true,
    execution: true,
    other: true,
  }))

  const scopeOptions = useMemo(
    () => [
      {
        label: 'Project-level (.formax/agents)',
        value: 'project' as const,
        description: 'Saved to the current repo and shared with this project.',
      },
      {
        label: 'User-level (~/.formax/agents)',
        value: 'user' as const,
        description: 'Saved to your global config and available in all projects.',
      },
    ],
    [],
  )

  const methodOptions = useMemo(
    () => [
      {
        label: 'Generate with Claude',
        value: 'generate' as const,
        description: 'Describe what you want; Claude drafts identifier + whenToUse + system prompt.',
      },
      {
        label: 'Write manually',
        value: 'manual' as const,
        description: 'Formax creates a starter agent prompt you can customize.',
      },
    ],
    [],
  )

  const modelOptions = useMemo(
    () => [
      {
        label: 'Sonnet',
        description: 'Balanced performance - best for most agents',
      },
      {
        label: 'Opus',
        description: 'Most capable for complex reasoning tasks',
      },
      {
        label: 'Haiku',
        description: 'Fast and efficient for simple tasks',
      },
      {
        label: 'Inherit',
        description: 'Use the same model as the main conversation',
      },
    ],
    [],
  )

  const colorOptions = useMemo(
    () => ['Automatic', 'Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Cyan'],
    [],
  )

  const allToolNames = useMemo(() => Array.from(new Set(toolNames)).sort((a, b) => a.localeCompare(b)), [toolNames])

  const selectedTools = useMemo(() => {
    const base = new Set<string>()
    if (toolGroups.readOnly) for (const t of ['Read', 'Glob', 'Grep']) base.add(t)
    if (toolGroups.edit) for (const t of ['Read', 'Edit', 'Write', 'NotebookEdit']) base.add(t)
    if (toolGroups.execution) for (const t of ['Bash']) base.add(t)
    if (toolGroups.other) {
      for (const t of allToolNames) {
        if (t === 'Read' || t === 'Glob' || t === 'Grep') continue
        if (t === 'Edit' || t === 'Write' || t === 'NotebookEdit') continue
        if (t === 'Bash') continue
        base.add(t)
      }
    }
    return Array.from(base).sort((a, b) => a.localeCompare(b))
  }, [allToolNames, toolGroups])

  const toolsAnswer = useMemo(() => {
    if (toolGroups.readOnly && toolGroups.edit && toolGroups.execution && toolGroups.other) return 'All tools'

    const exact = (want: string[]) =>
      selectedTools.length === want.length && want.every((t) => selectedTools.includes(t))

    if (exact(['Read', 'Glob', 'Grep'])) return 'Read-only tools'
    if (exact(['Read', 'Edit', 'Write', 'NotebookEdit'])) return 'Edit tools'
    if (exact(['Bash'])) return 'Execution tools'

    return selectedTools.join(', ')
  }, [selectedTools, toolGroups])

  const resetCreateState = useCallback(() => {
    setDraft(null)
    setScope('project')
    setMethod('generate')
    setAgentDescriptionInput('')
    setManualNameInput('')
    setManualDescInput('')
    setSelectedModel('Sonnet')
    setSelectedColor('Automatic')
    setToolGroups({ readOnly: true, edit: true, execution: true, other: true })
  }, [])

  const pushView = useCallback((next: View) => {
    setStack((prev) => [...prev, view])
    setView(next)
  }, [view])

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

    pushView({ kind: 'busy', message: 'Generating with Claude…' })
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
      pushView({ kind: 'busy', message: 'Saving…' })
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
      return 's/Enter to save · e to save and show file path · Esc to cancel'
    }
    if (
      view.kind === 'create_generate_desc' ||
      view.kind === 'create_manual_name' ||
      view.kind === 'create_manual_desc'
    ) {
      return 'Enter to continue · Esc to go back'
    }
    return 'Press ↑↓ to navigate · Enter to select · Esc to go back'
  }, [view.kind])

  useInput((input, key) => {
    if (view.kind === 'busy') {
      if (key.escape) cancelBusy()
      return
    }

    if (view.kind === 'error') {
      if (key.escape) {
        popView()
      }
      if (key.return) {
        popView()
      }
      return
    }

    // Text input screens: Esc handled here; typing handled by TextInput.
    if (view.kind === 'create_generate_desc' || view.kind === 'create_manual_name' || view.kind === 'create_manual_desc') {
      if (key.escape) popView()
      return
    }

    if (key.escape) {
      if (stack.length === 0 || view.kind === 'list') {
        closeDialog()
      } else {
        popView()
      }
      return
    }

    if (view.kind === 'confirm') {
      if (key.return || input === 's' || input === 'S') {
        void save(false)
      } else if (input === 'e' || input === 'E') {
        void save(true)
      }
      return
    }

    if (view.kind === 'list') {
      if (key.return) startCreate()
      return
    }

    if (view.kind === 'view_agent') {
      if (key.escape) popView()
      return
    }

    if (key.downArrow) {
      if (view.kind === 'create_scope' || view.kind === 'create_method' || view.kind === 'create_tools' || view.kind === 'create_model' || view.kind === 'create_color') {
        setView((prev) => {
          if (prev.kind !== view.kind) return prev
          const max =
            prev.kind === 'create_scope'
              ? scopeOptions.length - 1
              : prev.kind === 'create_method'
                ? methodOptions.length - 1
                : prev.kind === 'create_tools'
                  ? 5
                  : prev.kind === 'create_model'
                    ? modelOptions.length - 1
                    : colorOptions.length - 1
          return { ...prev, cursor: Math.min(prev.cursor + 1, max) } as View
        })
      }
      return
    }

    if (key.upArrow) {
      if (view.kind === 'create_scope' || view.kind === 'create_method' || view.kind === 'create_tools' || view.kind === 'create_model' || view.kind === 'create_color') {
        setView((prev) => {
          if (prev.kind !== view.kind) return prev
          return { ...prev, cursor: Math.max(prev.cursor - 1, 0) } as View
        })
      }
      return
    }

    if (key.return) {
      if (view.kind === 'create_scope') {
        const nextScope = scopeOptions[view.cursor]?.value ?? 'project'
        setScope(nextScope)
        pushView({ kind: 'create_method', cursor: 0 })
        return
      }

      if (view.kind === 'create_method') {
        const nextMethod = methodOptions[view.cursor]?.value ?? 'generate'
        setMethod(nextMethod)
        if (nextMethod === 'generate') {
          pushView({ kind: 'create_generate_desc' })
        } else {
          pushView({ kind: 'create_manual_name' })
        }
        return
      }

      if (view.kind === 'create_tools') {
        if (view.cursor === 0) {
          if (selectedTools.length === 0) {
            pushView({ kind: 'error', message: 'Select at least one tool group.' })
            return
          }
          pushView({ kind: 'create_model', cursor: 0 })
          return
        }

        const keyByCursor = ['continue', 'all', 'readOnly', 'edit', 'execution', 'other'][view.cursor] as
          | 'continue'
          | 'all'
          | 'readOnly'
          | 'edit'
          | 'execution'
          | 'other'

        if (keyByCursor === 'all') {
          const allOn = toolGroups.readOnly && toolGroups.edit && toolGroups.execution && toolGroups.other
          setToolGroups(allOn ? { readOnly: false, edit: false, execution: false, other: false } : { readOnly: true, edit: true, execution: true, other: true })
          return
        }

        setToolGroups((prev) => ({ ...prev, [keyByCursor]: !prev[keyByCursor] }))
        return
      }

      if (view.kind === 'create_model') {
        setSelectedModel(modelOptions[view.cursor]?.label ?? 'Sonnet')
        pushView({ kind: 'create_color', cursor: 0 })
        return
      }

      if (view.kind === 'create_color') {
        setSelectedColor(colorOptions[view.cursor] ?? 'Automatic')
        pushView({ kind: 'confirm' })
        return
      }
    }
  })

  if (view.kind === 'busy') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.secondaryText}>{view.message}</Text>
      </Box>
    )
  }

  if (view.kind === 'error') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.error}>Error: {view.message}</Text>
        <Text color={theme.secondaryText}>Press Enter or Esc to go back</Text>
      </Box>
    )
  }

  const box = (() => {
    switch (view.kind) {
      case 'list': {
        const banner = view.banner
        return (
          <Box borderStyle="round" flexDirection="column" paddingX={1} width="100%">
            <Text bold>Agents</Text>
            <Text color={theme.secondaryText}>{agents.length} agents</Text>
            {banner ? (
              <>
                <Text />
                <Text>{banner}</Text>
              </>
            ) : null}
            <Text />
            <Text color={theme.secondaryText}>❯ Create new agent</Text>
            <Text />
            {groupedAgents.projectAgents.length ? (
              <>
                <Text color={theme.secondaryText}>Project agents</Text>
                {groupedAgents.projectAgents.map((a) => (
                  <Text key={a.name}>  {a.name}</Text>
                ))}
                <Text />
              </>
            ) : null}
            <Text color={theme.secondaryText}>Built-in agents (always available)</Text>
            {groupedAgents.builtins.map((a) => (
              <Text key={a.name}>
                {'  '}
                {a.name}
              </Text>
            ))}
          </Box>
        )
      }

      case 'create_scope': {
        return (
          <Box borderStyle="round" flexDirection="column" paddingX={1} width="100%">
            <Text bold>Create new agent</Text>
            <Text>Choose scope</Text>
            <Text />
            {scopeOptions.map((opt, idx) => (
              <Box key={opt.value}>
                <Text color={theme.secondaryText}>{idx === view.cursor ? '❯ ' : '  '}</Text>
                <Text bold={idx === view.cursor}>{opt.label}</Text>
              </Box>
            ))}
          </Box>
        )
      }

      case 'create_method': {
        return (
          <Box borderStyle="round" flexDirection="column" paddingX={1} width="100%">
            <Text bold>Create new agent</Text>
            <Text>Choose method</Text>
            <Text color={theme.secondaryText}>Generate with Claude drafts name + whenToUse + system prompt.</Text>
            <Text />
            {methodOptions.map((opt, idx) => (
              <Box key={opt.value}>
                <Text color={theme.secondaryText}>{idx === view.cursor ? '❯ ' : '  '}</Text>
                <Text bold={idx === view.cursor}>{opt.label}</Text>
              </Box>
            ))}
          </Box>
        )
      }

      case 'create_generate_desc': {
        return (
          <Box borderStyle="round" flexDirection="column" paddingX={1} width="100%">
            <Text bold>Create new agent</Text>
            <Text>Generate with Claude</Text>
            <Text />
            <Text>Describe the sub-agent:</Text>
            <Box marginTop={1}>
              <TextInput
                value={agentDescriptionInput}
                onChange={setAgentDescriptionInput}
                onSubmit={() => void startGenerateDraft()}
                placeholder="Describe what the agent does and when to use it"
              />
            </Box>
          </Box>
        )
      }

      case 'create_manual_name': {
        return (
          <Box borderStyle="round" flexDirection="column" paddingX={1} width="100%">
            <Text bold>Create new agent</Text>
            <Text>Write manually</Text>
            <Text />
            <Text>Agent name (used as subagent_type):</Text>
            <Box marginTop={1}>
              <TextInput
                value={manualNameInput}
                onChange={setManualNameInput}
                onSubmit={() => pushView({ kind: 'create_manual_desc' })}
                placeholder="e.g. code-reviewer"
              />
            </Box>
          </Box>
        )
      }

      case 'create_manual_desc': {
        return (
          <Box borderStyle="round" flexDirection="column" paddingX={1} width="100%">
            <Text bold>Create new agent</Text>
            <Text>Write manually</Text>
            <Text />
            <Text>Description (tells Formax when to use this agent):</Text>
            <Box marginTop={1}>
              <TextInput
                value={manualDescInput}
                onChange={setManualDescInput}
                onSubmit={commitManualDraft}
                placeholder="When should this agent be used?"
              />
            </Box>
          </Box>
        )
      }

      case 'create_tools': {
        const allOn = toolGroups.readOnly && toolGroups.edit && toolGroups.execution && toolGroups.other
        const rows = [
          { key: 'continue', label: '[ Continue ]', checked: null as null | boolean },
          { key: 'all', label: 'All tools', checked: allOn },
          { key: 'readOnly', label: 'Read-only tools', checked: toolGroups.readOnly },
          { key: 'edit', label: 'Edit tools', checked: toolGroups.edit },
          { key: 'execution', label: 'Execution tools', checked: toolGroups.execution },
          { key: 'other', label: 'Other tools', checked: toolGroups.other },
        ] as const

        return (
          <Box borderStyle="round" flexDirection="column" paddingX={1} width="100%">
            <Text bold>Create new agent</Text>
            <Text>Select tools</Text>
            <Text />
            {rows.map((row, idx) => (
              <Box key={row.key}>
                <Text color={theme.secondaryText}>{idx === view.cursor ? '❯ ' : '  '}</Text>
                {row.checked === null ? (
                  <Text bold={idx === view.cursor}>{row.label}</Text>
                ) : (
                  <>
                    <Text color={theme.secondaryText}>{row.checked ? '☒ ' : '☐ '}</Text>
                    <Text bold={idx === view.cursor}>{row.label}</Text>
                  </>
                )}
              </Box>
            ))}
            <Text />
            <Text color={theme.secondaryText}>
              {allOn ? 'All tools selected' : selectedTools.length ? `${selectedTools.length} tools selected` : 'No tools selected'}
            </Text>
          </Box>
        )
      }

      case 'create_model': {
        return (
          <Box borderStyle="round" flexDirection="column" paddingX={1} width="100%">
            <Text bold>Create new agent</Text>
            <Text>Select model</Text>
            <Text color={theme.secondaryText}>Model determines the agent's reasoning capabilities and speed.</Text>
            <Text />
            {modelOptions.map((opt, idx) => {
              const selected = selectedModel === opt.label
              return (
                <Box key={opt.label}>
                  <Text color={theme.secondaryText}>{idx === view.cursor ? '❯ ' : '  '}</Text>
                  <Text bold={idx === view.cursor}>
                    {idx + 1}. {opt.label.padEnd(10)} {opt.description}
                    {selected ? ' ✔' : ''}
                  </Text>
                </Box>
              )
            })}
          </Box>
        )
      }

      case 'create_color': {
        const previewName = draft?.name || normalizeAgentName(manualNameInput) || 'agent'
        return (
          <Box borderStyle="round" flexDirection="column" paddingX={1} width="100%">
            <Text bold>Create new agent</Text>
            <Text>Choose background color</Text>
            <Text />
            {colorOptions.map((c, idx) => (
              <Box key={c}>
                <Text color={theme.secondaryText}>{idx === view.cursor ? '❯ ' : '  '}</Text>
                <Text bold={idx === view.cursor}>{c}</Text>
              </Box>
            ))}
            <Text />
            <Text />
            <Text color={theme.secondaryText}>Preview:  {previewName}</Text>
          </Box>
        )
      }

      case 'confirm': {
        const name = draft?.name ?? 'agent'
        const location =
          scope === 'user' ? `~/.formax/agents/${name}.md` : `.formax/agents/${name}.md`
        const warnings =
          toolsAnswer === 'All tools' ? ['Agent has access to all tools'] : []

        return (
          <Box borderStyle="round" flexDirection="column" paddingX={1} width="100%">
            <Text bold>Create new agent</Text>
            <Text>Confirm and save</Text>
            <Text />
            <Text>Name: {name}</Text>
            <Text>Location: {location}</Text>
            <Text>Tools: {toolsAnswer || 'All tools'}</Text>
            <Text>Model: {selectedModel}</Text>
            <Text />
            <Text>Description (tells Formax when to use this agent):</Text>
            <Text />
            <Text>{indent(truncate(draft?.description || '', 140), 2)}</Text>
            <Text />
            <Text>System prompt:</Text>
            <Text />
            <Text>{indent(truncate(draft?.systemPrompt || '', 180), 2)}</Text>
            {warnings.length ? (
              <>
                <Text />
                <Text>Warnings:</Text>
                {warnings.map((w) => (
                  <Text key={w}> • {w}</Text>
                ))}
              </>
            ) : null}
            <Text />
            <Text color={theme.secondaryText}>Press s or Enter to save, e to save and show file path</Text>
          </Box>
        )
      }
    }
  })()

  return (
    <Box flexDirection="column" marginTop={1}>
      {box}
      <Box marginTop={1}>
        <Text color={theme.secondaryText}>{hint}</Text>
      </Box>
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
