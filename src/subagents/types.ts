export type SubAgentConfig = {
  name: string
  description: string
  tools: string[]
  systemPrompt: string
}

export type SubAgentResult = {
  summary: string
  success: boolean
  artifacts?: string[]
  error?: string
}

