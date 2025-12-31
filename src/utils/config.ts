import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { FORMAX_CONFIG_FILE } from './env'
import type { ThemeName } from './theme'

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

const DEFAULT_CONTEXT_LENGTH = 128000
const DEFAULT_MAX_TOKENS = 8192

// Simple deep clone for config objects
function cloneDeep<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// Unified configuration type - single source of truth
export type GlobalConfig = {
  theme: ThemeName
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

// Test mode config storage
const TEST_GLOBAL_CONFIG_FOR_TESTING: GlobalConfig = {
  ...DEFAULT_GLOBAL_CONFIG,
}

function getConfig<A extends object>(
  file: string,
  defaultConfig: A,
): A {
  if (!existsSync(file)) {
    return cloneDeep(defaultConfig)
  }

  try {
    const fileContent = readFileSync(file, 'utf-8')
    const parsedConfig = JSON.parse(fileContent)

    // Merge with default config to ensure all fields exist
    const finalConfig = {
      ...cloneDeep(defaultConfig),
      ...parsedConfig,
    }

    return finalConfig
  } catch (error) {
    // If file exists but can't be parsed, return default config
    console.warn(
      `Warning: Could not parse config file ${file}, using defaults. Error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return cloneDeep(defaultConfig)
  }
}

function saveConfig<A extends object>(
  file: string,
  config: A,
  defaultConfig: A,
): void {
  // Filter out any values that match the defaults
  // But keep all fields that are explicitly set (not undefined)
  // Special handling for GlobalConfig: always keep theme and model if they exist
  const filteredConfig = Object.fromEntries(
    Object.entries(config).filter(([key, value]) => {
      const defaultValue = defaultConfig[key as keyof A]
      // If the value is undefined, filter it out
      if (value === undefined) {
        return false
      }
      // Always keep 'theme' and 'model' if they exist (even if theme matches default)
      // This ensures user selections are preserved
      if (key === 'theme' || key === 'model') {
        return true
      }
      // If the key doesn't exist in default config, keep it
      if (defaultValue === undefined) {
        return true
      }
      // Compare values, but keep objects/arrays even if they match defaults
      // This ensures nested objects are preserved
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // For objects, keep them if they have any properties
        return Object.keys(value).length > 0
      }
      // For primitive values, only filter if they match defaults
      return JSON.stringify(value) !== JSON.stringify(defaultValue)
    }),
  )

  // Ensure directory exists
  const dir = dirname(file)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(file, JSON.stringify(filteredConfig, null, 2), 'utf-8')
}

export function getGlobalConfig(): GlobalConfig {
  if (process.env.NODE_ENV === 'test') {
    return TEST_GLOBAL_CONFIG_FOR_TESTING
  }
  const config = getConfig(FORMAX_CONFIG_FILE, DEFAULT_GLOBAL_CONFIG)
  return migrateLegacyModelConfig(config)
}

export function saveGlobalConfig(config: GlobalConfig): void {
  if (process.env.NODE_ENV === 'test') {
    for (const key in config) {
      TEST_GLOBAL_CONFIG_FOR_TESTING[key] = config[key]
    }
    return
  }

  const normalizedConfig = migrateLegacyModelConfig(config)

  // Read existing config to ensure we don't lose other fields
  const existingConfig = getConfig(FORMAX_CONFIG_FILE, DEFAULT_GLOBAL_CONFIG)
  
  // Merge configs, ensuring all fields are preserved
  const mergedConfig: GlobalConfig = migrateLegacyModelConfig({
    ...existingConfig,
    ...normalizedConfig,
    // Deep merge legacy model object if it exists
    model: normalizedConfig.model
      ? {
          ...existingConfig.model,
          ...normalizedConfig.model,
        }
      : existingConfig.model,
  })

  saveConfig(FORMAX_CONFIG_FILE, mergedConfig, DEFAULT_GLOBAL_CONFIG)
}

// Normalize and migrate legacy { model: {...} } into Kode-compatible modelProfiles format
function migrateLegacyModelConfig(config: GlobalConfig): GlobalConfig {
  // If we already have modelProfiles, just ensure defaults exist
  if (config.modelProfiles && config.modelProfiles.length > 0) {
    return {
      ...DEFAULT_GLOBAL_CONFIG,
      ...config,
      modelPointers: config.modelPointers ?? DEFAULT_GLOBAL_CONFIG.modelPointers,
      defaultModelName: config.defaultModelName ?? config.modelPointers?.main ?? '',
    }
  }

  // If legacy model config exists, convert it
  if (config.model?.provider && config.model?.name && config.model?.apiKey) {
    const provider = config.model.provider
    const modelName = config.model.name

    const profile: ModelProfile = {
      name: `${provider} ${modelName}`.trim(),
      provider,
      modelName,
      baseURL: config.model.baseURL,
      apiKey: config.model.apiKey,
      maxTokens: config.model.maxTokens ?? DEFAULT_MAX_TOKENS,
      contextLength: config.model.contextLength ?? DEFAULT_CONTEXT_LENGTH,
      reasoningEffort: config.model.reasoningEffort ?? null,
      isActive: true,
      createdAt: Date.now(),
    }

    return {
      ...config,
      modelProfiles: [profile],
      modelPointers: {
        main: modelName,
        task: modelName,
        reasoning: modelName,
        quick: modelName,
      },
      defaultModelName: modelName,
    }
  }

  // No legacy data, ensure defaults exist
  return {
    ...DEFAULT_GLOBAL_CONFIG,
    ...config,
    modelProfiles: config.modelProfiles ?? [],
    modelPointers: config.modelPointers ?? DEFAULT_GLOBAL_CONFIG.modelPointers,
    defaultModelName: config.defaultModelName ?? '',
  }
}

// Helper to find the active model profile using pointers with fallbacks
export function getActiveModelProfile(
  config: GlobalConfig = getGlobalConfig(),
): ModelProfile | null {
  const profiles = config.modelProfiles ?? []
  const pointers = config.modelPointers ?? DEFAULT_GLOBAL_CONFIG.modelPointers

  if (!profiles.length) {
    return null
  }

  const findByModelName = (modelName?: string) =>
    profiles.find((p) => p.modelName === modelName && p.isActive)

  // Prefer explicit pointers
  const pointerOrder: Array<keyof ModelPointers> = ['main', 'task', 'reasoning', 'quick']
  for (const key of pointerOrder) {
    const profile = findByModelName(pointers[key])
    if (profile) return profile
  }

  // Fallback to first active profile
  return profiles.find((p) => p.isActive) ?? profiles[0] ?? null
}
