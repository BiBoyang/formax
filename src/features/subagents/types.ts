export type SubAgentConfig = {
  name: string
  description: string
  tools: string[]
  systemPrompt: string
  model?: string
  color?: string
}

export type SubAgentListItem = {
  name: string
  description: string
  model?: string
  color?: string
}

export type SubAgentResult = {
  agentId: string
  /** Full text output from the sub-agent (assistant deltas), before truncation. */
  response: string
  summary: string
  success: boolean
  artifacts?: string[]
  error?: string
}
