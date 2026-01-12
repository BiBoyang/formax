export type SubAgentConfig = {
  name: string
  description: string
  tools: string[]
  systemPrompt: string
}

export type SubAgentResult = {
  agentId: string
  summary: string
  success: boolean
  artifacts?: string[]
  error?: string
}
