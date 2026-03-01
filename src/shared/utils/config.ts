
// Model profile structure aligns with Kode-cli config format
export type ModelProfile = {
  name: string
  provider: string
  modelName: string
  baseURL?: string
  apiKey: string
  maxTokens: number
  contextLength: number
  reasoningEffort?: 'low' | 'medium' | 'high' | 'minimal' | null
  isActive: boolean
  createdAt: number
  lastUsed?: number
}

export type ModelPointers = {
  main: string
  task: string
  reasoning: string
  quick: string
}

export type ModelConfig = {
  provider?: string
  baseURL?: string
  apiKey?: string
  name?: string
  maxTokens?: number
  contextLength?: number
  reasoningEffort?: 'low' | 'medium' | 'high' | null
}


// Unified configuration type - single source of truth
export type GlobalConfig = {
  theme: string
  hasCompletedOnboarding?: boolean
  model?: ModelConfig // Legacy field (kept for backward compatibility)
  modelProfiles?: ModelProfile[]
  modelPointers?: ModelPointers
  defaultModelName?: string
  primaryProvider?: string
}

// Re-export as AppConfig for backward compatibility with Jotai atoms
export type AppConfig = GlobalConfig

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  theme: 'dark',
  hasCompletedOnboarding: false,
  modelProfiles: [],
  modelPointers: {
    main: '',
    task: '',
    reasoning: '',
    quick: '',
  },
  defaultModelName: '',
}


export function getGlobalConfig(): GlobalConfig {
  return DEFAULT_GLOBAL_CONFIG
}

