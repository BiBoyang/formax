export type SubAgentConfig = {
  name: string
  description: string
  tools: string[]
  systemPrompt: string
  model?: string
  color?: string
}

export type SubAgentResult = {
  agentId: string
  summary: string
  success: boolean
  artifacts?: string[]
  error?: string
}
