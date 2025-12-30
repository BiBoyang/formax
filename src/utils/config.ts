import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { FORMAX_CONFIG_FILE } from './env'
import type { ThemeName } from './theme'

// Simple deep clone for config objects
function cloneDeep<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// Unified configuration type - single source of truth
export type GlobalConfig = {
  theme: ThemeName
  hasCompletedOnboarding?: boolean
  model?: {
    provider?: string
    baseURL?: string
    apiKey?: string
    name?: string
    maxTokens?: number
    contextLength?: number
    reasoningEffort?: 'low' | 'medium' | 'high'
  }
}

// Re-export as AppConfig for backward compatibility with Jotai atoms
export type AppConfig = GlobalConfig

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  theme: 'dark',
  hasCompletedOnboarding: false,
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
  return getConfig(FORMAX_CONFIG_FILE, DEFAULT_GLOBAL_CONFIG)
}

export function saveGlobalConfig(config: GlobalConfig): void {
  if (process.env.NODE_ENV === 'test') {
    for (const key in config) {
      TEST_GLOBAL_CONFIG_FOR_TESTING[key] = config[key]
    }
    return
  }

  // Read existing config to ensure we don't lose other fields
  const existingConfig = getConfig(FORMAX_CONFIG_FILE, DEFAULT_GLOBAL_CONFIG)
  
  // Merge configs, ensuring all fields are preserved
  const mergedConfig: GlobalConfig = {
    ...existingConfig,
    ...config,
    // Deep merge model object if it exists
    model: config.model
      ? {
          ...existingConfig.model,
          ...config.model,
        }
      : existingConfig.model,
  }

  saveConfig(FORMAX_CONFIG_FILE, mergedConfig, DEFAULT_GLOBAL_CONFIG)
}

