import type { PromptBlock, PromptMessage } from '../prompts/index.js'
import type { SystemPromptProfile } from '../prompts/system.js'
import type { StopReason, StreamEvent, TokenUsage } from '../streaming/types.js'
import type { ReplMode } from '../tools/executor/index.js'
import type { ToolDefinition } from '../tools/types.js'

export type HookEvent = (typeof import('./constants.js').HOOK_EVENTS)[number]
export type ExitReason = (typeof import('./constants.js').EXIT_REASONS)[number]

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
export type OutputFormatType = OutputFormat['type']
export type BaseOutputFormat = {
  type: OutputFormatType
}

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

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export type ElicitationRequest = {
  serverName: string
  message: string
  mode?: 'form' | 'url'
  url?: string
  elicitationId?: string
  requestedSchema?: Record<string, unknown>
}

export type ElicitationResult =
  | {
      action: 'accept'
      content: Record<string, unknown>
    }
  | {
      action: 'decline'
    }
  | {
      action: 'cancel'
    }

export type OnElicitation = (
  request: ElicitationRequest,
  options: { signal: AbortSignal },
) => Promise<ElicitationResult>

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'dontAsk'
  | 'bypassPermissions'

export type PermissionBehavior = 'allow' | 'deny' | 'ask'

export type PermissionRuleValue = {
  toolName: string
  ruleContent?: string
}

export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg'

export type PermissionUpdate =
  | {
      type: 'addRules'
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
      destination: PermissionUpdateDestination
    }
  | {
      type: 'replaceRules'
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
      destination: PermissionUpdateDestination
    }
  | {
      type: 'removeRules'
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
      destination: PermissionUpdateDestination
    }
  | {
      type: 'setMode'
      mode: PermissionMode
      destination: PermissionUpdateDestination
    }
  | {
      type: 'addDirectories'
      directories: string[]
      destination: PermissionUpdateDestination
    }
  | {
      type: 'removeDirectories'
      directories: string[]
      destination: PermissionUpdateDestination
    }

export type PermissionResult =
  | {
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      updatedPermissions?: PermissionUpdate[]
      toolUseID?: string
    }
  | {
      behavior: 'deny'
      message: string
      interrupt?: boolean
      toolUseID?: string
    }

export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal
    suggestions?: PermissionUpdate[]
    blockedPath?: string
    decisionReason?: string
    toolUseID: string
    agentID?: string
  },
) => Promise<PermissionResult>

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
  effort?: EffortLevel
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
  canUseTool?: CanUseTool
  plugins?: unknown[]
  settingSources?: Array<'user' | 'project' | 'local'>
  onElicitation?: OnElicitation
  thinkingEnabled?: boolean
  outputFormat?: OutputFormat
  signal?: AbortSignal
  abortController?: AbortController
  onMessage?: (message: QueryMessage) => void
}

export type QueryArgs = {
  prompt: string | AsyncIterable<SDKUserMessage>
  history?: PromptMessage[]
  options?: QueryOptions
}

// Official-aligned alias for query options (supported subset).
export type Options = QueryOptions

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

export type PromptRequest = AskUserQuestionRequest
export type PromptRequestOption = AskUserQuestionRequest['options'][number]

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
  blocked_path?: string
  decision_reason?: string
  agent_id?: string
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

export type AskUserQuestionInputResponse = {
  answers: Record<string, string>
}

export type PromptResponse = AskUserQuestionInputResponse

export type QueryMessage =
  | SystemMessage
  | PartialAssistantMessage
  | InputRequestMessage
  | AssistantMessage
  | ResultMessage

// Official-aligned SDK message aliases (supported subset).
export type SDKSystemMessage = SystemMessage
export type SDKPartialAssistantMessage = PartialAssistantMessage
export type SDKAssistantMessage = AssistantMessage
export type SDKResultMessage = ResultMessage
export type SDKResultSuccess = ResultMessage & { subtype: 'success' }
export type SDKResultError = ResultMessage & {
  subtype: Exclude<ResultMessageSubtype, 'success'>
}
export type SDKMessage = QueryMessage

export type QueryInitializationResult = SystemMessage

export type SlashCommand = {
  name: string
  command: string
  description: string
  source: 'builtin' | 'user' | 'project'
  argumentHint?: string
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
  value?: string
  displayName?: string
  description?: string
  supportsEffort?: boolean
  supportedEffortLevels?: Array<'low' | 'medium' | 'high' | 'max'>
  supportsAdaptiveThinking?: boolean
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

export type McpSetServersResult = Record<string, unknown>

export type RewindFilesResult = {
  canRewind?: boolean
  error?: string
  filesChanged?: string[]
  insertions?: number
  deletions?: number
  [key: string]: unknown
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
  setMcpServers(servers: Record<string, unknown>): Promise<McpSetServersResult>
  reconnectMcpServer(serverName: string): Promise<void>
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>
  stopTask(taskId: string): Promise<void>
  rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>
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
