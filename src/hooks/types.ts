export type HookEventName =
  | 'PreToolUse'
  | 'PermissionRequest'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'Stop'

export type HookDefinition = {
  type: 'command'
  command: string
  timeout?: number
  timeoutMs?: number
}

export type HookMatcherRule = {
  matcher?: string
  hooks: HookDefinition[]
}

export type HooksSettings = {
  hooks: Partial<Record<HookEventName, HookMatcherRule[]>>
}

export type HookSource = 'projectLocal' | 'project' | 'user'

export type HookRuleEntry = {
  source: HookSource
  matcher: string
  command: string
  timeoutMs: number | null
}

export type MergedHooks = {
  PreToolUse: HookRuleEntry[]
  PermissionRequest: HookRuleEntry[]
  PostToolUse: HookRuleEntry[]
  UserPromptSubmit: HookRuleEntry[]
  SessionStart: HookRuleEntry[]
  Stop: HookRuleEntry[]
  warnings: string[]
}

export type HookExecResult = {
  source?: HookSource
  matcher?: string
  timeoutMs?: number | null
  command: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  stdoutTruncated?: boolean
  stderrTruncated?: boolean
  durationMs: number
  timedOut: boolean
}

export type HookRun = HookExecResult & {
  parsedJson: unknown | null
}

export type HookAdditionalContext = {
  toolUseId: string
  toolName: string
  blocks: Array<{ type: 'text'; text: string }>
}
