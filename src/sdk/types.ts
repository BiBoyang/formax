import type { PromptBlock, PromptMessage } from '../prompts/index.js'
import type { SystemPromptProfile } from '../prompts/system.js'
import type { StopReason, StreamEvent, TokenUsage } from '../streaming/types.js'
import type { ReplMode } from '../tools/executor/index.js'
import type { ToolDefinition } from '../tools/types.js'

export type SystemPromptPresetInput = {
  type: 'preset'
  preset: 'claude_code'
  append?: string
}

export type SystemPromptInput = string | PromptBlock[] | SystemPromptPresetInput

export type ToolsPresetInput = {
  type: 'preset'
  preset: 'claude_code'
}

export type JsonSchemaOutputFormat = {
  type: 'json_schema'
  schema: Record<string, unknown>
  /**
   * Additional structured-output correction attempts after the initial response.
   * `0` means no retry.
   */
  maxRetries?: number
}

export type OutputFormat = JsonSchemaOutputFormat

export type ThinkingAdaptive = {
  type: 'adaptive'
}

export type ThinkingEnabled = {
  type: 'enabled'
  budgetTokens?: number
}

export type ThinkingDisabled = {
  type: 'disabled'
}

export type ThinkingConfig = ThinkingAdaptive | ThinkingEnabled | ThinkingDisabled

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'dontAsk'
  | 'bypassPermissions'

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
  permissionMode?: PermissionMode
  interactive?: boolean
  thinking?: ThinkingConfig
  maxThinkingTokens?: number
  maxTurns?: number
  maxBudgetUsd?: number
  resume?: string
  sessionId?: string
  resumeSessionAt?: string
  debug?: boolean
  debugFile?: string
  stderr?: (data: string) => void
  pathToClaudeCodeExecutable?: string
  spawnClaudeCodeProcess?: (...args: unknown[]) => unknown
  executable?: 'bun' | 'deno' | 'node'
  executableArgs?: string[]
  extraArgs?: Record<string, string | null>
  betas?: string[]
  allowDangerouslySkipPermissions?: boolean
  permissionPromptToolName?: string
  promptSuggestions?: boolean
  continue?: boolean
  fallbackModel?: string
  strictMcpConfig?: boolean
  persistSession?: boolean
  forkSession?: boolean
  enableFileCheckpointing?: boolean
  additionalDirectories?: string[]
  sandbox?: unknown
  agent?: string
  agents?: Record<string, unknown>
  tools?: string[] | ToolsPresetInput
  mcpServers?: Record<string, unknown>
  hooks?: Record<string, unknown>
  canUseTool?: (...args: unknown[]) => unknown
  plugins?: unknown[]
  settingSources?: Array<'user' | 'project' | 'local'>
  onElicitation?: (...args: unknown[]) => unknown
  thinkingEnabled?: boolean
  outputFormat?: OutputFormat
  signal?: AbortSignal
  abortController?: AbortController
  onInputRequest?: (
    request: InputRequestMessage,
  ) => Promise<InputRequestResponse> | InputRequestResponse
  onMessage?: (message: QueryMessage) => void
}

export type QueryArgs = {
  prompt: string | AsyncIterable<SDKUserMessage>
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

export type ResultMessageSubtype =
  | 'success'
  | 'error_during_execution'
  | 'error_max_structured_output_retries'

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
  structured_output?: unknown
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

export type QueryInitializationResult = SystemMessage

export type SlashCommand = {
  command: string
  description: string
  source: 'builtin' | 'user' | 'project'
  argHint?: string
  implemented?: boolean
}

export type AgentInfo = {
  name: string
  description: string
  model?: string
}

export type ModelInfo = {
  model: string
  provider: string
  max_tokens?: number
  contextWindowTokens?: number
  supports_reasoning_effort?: boolean
  supports_vision?: boolean
  supports_function_calling?: boolean
}

export type AccountInfo = {
  provider: string
  model: string
  baseUrl?: string
  hasApiKey: boolean
}

export type McpServerStatus = {
  name: string
  status: 'connected' | 'disconnected'
}

export interface Query extends AsyncGenerator<QueryMessage, void, unknown> {
  interrupt(): Promise<void>
  close(): void
  initializationResult(): Promise<QueryInitializationResult>
  supportedCommands(): Promise<SlashCommand[]>
  supportedAgents(): Promise<AgentInfo[]>
  supportedModels(): Promise<ModelInfo[]>
  accountInfo(): Promise<AccountInfo>
  mcpServerStatus(): Promise<McpServerStatus[]>
  setModel(model?: string): Promise<void>
  setPermissionMode(mode: PermissionMode): Promise<void>
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>
}

export type ListSessionsOptions = {
  dir?: string
  limit?: number
}

export type GetSessionMessagesOptions = {
  dir?: string
  limit?: number
  offset?: number
}

export type SessionMessage = {
  type: 'user' | 'assistant'
  uuid: string
  session_id: string
  message: PromptMessage
  parent_tool_use_id: null
}

export type SDKSessionInfo = {
  sessionId: string
  summary: string
  lastModified: number
  fileSize: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
}

export type SDKUserTextBlock = {
  type: 'text'
  text: string
}

export type SDKUserMessage = {
  role: 'user'
  content: SDKUserTextBlock[]
}

export type SDKSessionOptions = QueryOptions

export interface SDKSession {
  readonly sessionId: string
  send(message: string | SDKUserMessage): Promise<void>
  stream(): AsyncGenerator<QueryMessage, void>
  close(): void
  [Symbol.asyncDispose](): Promise<void>
}
