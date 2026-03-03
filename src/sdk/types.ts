import type { PromptBlock, PromptMessage } from '../prompts/index.js'
import type { SystemPromptProfile } from '../prompts/system.js'
import type { StopReason, StreamEvent, TokenUsage } from '../streaming/types.js'
import type { ReplMode } from '../tools/executor/index.js'
import type { ToolDefinition } from '../tools/types.js'

export type SystemPromptInput = string | PromptBlock[]

export type QueryOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  model?: string
  promptProfile?: SystemPromptProfile
  systemPrompt?: SystemPromptInput
  appendSystemPrompt?: SystemPromptInput
  includePartialMessages?: boolean
  allowedTools?: string[]
  disallowedTools?: string[]
  replMode?: ReplMode
  interactive?: boolean
  thinkingEnabled?: boolean
  signal?: AbortSignal
  onInputRequest?: (
    request: InputRequestMessage,
  ) => Promise<InputRequestResponse> | InputRequestResponse
  onMessage?: (message: QueryMessage) => void
}

export type QueryArgs = {
  prompt: string
  history?: PromptMessage[]
  options?: QueryOptions
}

export type SystemMessage = {
  type: 'system'
  subtype: 'init'
  session_id: string
  cwd: string
  model: string
  tools: ToolDefinition[]
}

export type PartialAssistantMessage = {
  type: 'stream_event'
  session_id: string
  uuid: string
  parent_tool_use_id: string | null
  event: StreamEvent
}

export type AssistantMessage = {
  type: 'assistant'
  session_id: string
  uuid: string
  text: string
  blocks: PromptBlock[]
  usage?: TokenUsage
  model?: string
}

export type ResultMessageSubtype = 'success' | 'error_during_execution'

export type ResultMessage = {
  type: 'result'
  session_id: string
  uuid: string
  subtype: ResultMessageSubtype
  stop_reason: StopReason
  result: string
  usage: TokenUsage | null
  model?: string
  assistant: AssistantMessage | null
  history: PromptMessage[]
  duration_ms: number
  error?: string
}

export type AskUserQuestionRequest = {
  question: string
  header: string
  fieldId?: string
  options: Array<{
    label: string
    description: string
  }>
  multiSelect: boolean
}

export type ApprovalInputRequestMessage = {
  type: 'input_request'
  subtype: 'approval_request'
  session_id: string
  uuid: string
  tool_use_id: string
  tool_name: string
  action: unknown
  effective_decision: unknown
  suggestions?: string[]
  workspace_request?: { dir: string } | null
}

export type AskUserQuestionInputRequestMessage = {
  type: 'input_request'
  subtype: 'ask_user_question'
  session_id: string
  uuid: string
  tool_use_id: string
  questions: AskUserQuestionRequest[]
}

export type InputRequestMessage = ApprovalInputRequestMessage | AskUserQuestionInputRequestMessage

export type ApprovalInputResponse = {
  decision: 'approve' | 'approve_remember' | 'deny' | 'feedback'
  feedback?: string
  scope?: 'session' | 'project' | 'global'
}

export type AskUserQuestionInputResponse = {
  answers: Record<string, string>
}

export type InputRequestResponse = ApprovalInputResponse | AskUserQuestionInputResponse | null | void

export type QueryMessage =
  | SystemMessage
  | PartialAssistantMessage
  | InputRequestMessage
  | AssistantMessage
  | ResultMessage
