import type { Theme } from '../../utils/theme.js'

export type AgentListItem = { name: string; description: string }

export type AgentsDialogTheme = Theme

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

export type AgentScope = 'user' | 'project' | 'builtin'

export type AgentMeta = AgentListItem & { scope: AgentScope; model: string }

export type DiskAgentInfo = { name: string; model: string; filePath: string }

export const COLOR_MAP: Record<string, string> = {
  red: '#ff3b30',
  blue: '#0a84ff',
  green: '#34c759',
  yellow: '#ffd60a',
  purple: '#bf5af2',
  orange: '#ff9f0a',
  pink: '#ff2d55',
  cyan: '#64d2ff',
}

export const TOOLS_DIVIDER = '─'.repeat(32)

export const BUILTIN_AGENT_NAMES = new Set(
  ['general-purpose', 'statusline-setup', 'explore', 'plan', 'claude-code-guide'].map((s) =>
    s.toLowerCase(),
  ),
)

export const BUILTIN_MODEL_BY_NAME = new Map<string, string>([
  ['general-purpose', 'sonnet'],
  ['statusline-setup', 'sonnet'],
  ['explore', 'haiku'],
  ['plan', 'inherit'],
  ['claude-code-guide', 'haiku'],
])

export const METHOD_OPTIONS: Array<{ label: string; value: 'manual' | 'generate' }> = [
  { label: 'Generate with Claude (recommended)', value: 'generate' },
  { label: 'Manual configuration', value: 'manual' },
]

export const MODEL_OPTIONS: Array<{ label: string; description: string }> = [
  { label: 'Sonnet', description: 'Balanced performance - best for most agents' },
  { label: 'Opus', description: 'Most capable for complex reasoning tasks' },
  { label: 'Haiku', description: 'Fast and efficient for simple tasks' },
  { label: 'Inherit', description: 'Use the same model as the main conversation' },
]

export const COLOR_OPTIONS = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Cyan']

export const SCOPE_OPTIONS: Array<{ label: string; value: 'project' | 'user' }> = [
  { label: 'Project (.formax/agents/)', value: 'project' },
  { label: 'Personal (~/.formax/agents/)', value: 'user' },
]

export const NON_SELECTABLE_TOOLS = new Set([
  'Task',
  'TaskOutput',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'KillShell',
])

// View type - represents all possible view states
export type View =
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

export type ToolsSelectableRow =
  | { type: 'continue'; key: string; cursor: number }
  | {
      type: 'group'
      key: string
      cursor: number
      group: 'all' | 'readOnly' | 'edit' | 'execution' | 'other'
      label: string
      checked: boolean
    }
  | { type: 'advanced'; key: string; cursor: number; label: string }
  | { type: 'tool'; key: string; cursor: number; tool: string; checked: boolean }

// Reducer state and action types
export type DialogState = {
  view: View
  stack: View[]
  draft: AgentsDialogGenerateDraft | null
  scope: 'project' | 'user'
  agentDescriptionInput: string
  manualNameInput: string
  manualDescInput: string
  selectedModel: string
  selectedColor: string
  showAdvancedTools: boolean
  selectedTools: string[]
}

export type DialogAction =
  | { type: 'SET_VIEW'; view: View }
  | { type: 'PUSH_VIEW'; view: View }
  | { type: 'POP_VIEW' }
  | { type: 'RESET_TO_LIST'; banner?: string | null }
  | { type: 'MOVE_CURSOR'; cursor: number }
  | { type: 'SET_DRAFT'; draft: AgentsDialogGenerateDraft | null }
  | { type: 'SET_SCOPE'; scope: 'project' | 'user' }
  | { type: 'SET_DESCRIPTION_INPUT'; value: string }
  | { type: 'SET_MANUAL_NAME_INPUT'; value: string }
  | { type: 'SET_MANUAL_DESC_INPUT'; value: string }
  | { type: 'SET_MODEL'; model: string }
  | { type: 'SET_COLOR'; color: string }
  | { type: 'SET_ADVANCED_TOOLS'; show: boolean }
  | { type: 'SET_TOOLS'; tools: string[] }
  | { type: 'RESET_CREATE_STATE'; selectableToolNames: string[] }
  | {
      type: 'TOGGLE_TOOL_GROUP'
      group: 'all' | 'readOnly' | 'edit' | 'execution' | 'other'
      toolGroups: {
        all: Set<string>
        readOnly: Set<string>
        edit: Set<string>
        execution: Set<string>
        other: Set<string>
      }
    }
  | { type: 'SET_ERROR'; message: string }
  | { type: 'SET_GENERATING_MESSAGE'; message: string }
  | { type: 'SET_SAVING_MESSAGE'; message: string }
