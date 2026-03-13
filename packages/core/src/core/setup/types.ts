import type { ModelTier, ProviderId, TierContextWindowMapping } from '../../config/settings/schema.js'
import type { ErrorCode } from '../errors/codes.js'

export type SetupProviderOption = {
  id: ProviderId
  label: string
  description?: string
  disabled?: boolean
}

export type SetupStep =
  | 'welcome'
  | 'provider'
  | 'anthropicVendor'
  | 'baseUrl'
  | 'apiKey'
  | 'test'
  | 'modelMode'
  | 'model'
  | 'confirm'
  | 'write'
  | 'done'

export type SetupModelMode = 'quick' | 'advanced'
export type SetupAnthropicVendor = 'anthropic' | 'glm' | 'kimi' | 'minimax' | 'custom'

export type SetupTierModels = Record<ModelTier, string>

export type SetupDraft = {
  provider: ProviderId | null
  anthropicVendor: SetupAnthropicVendor | null
  baseUrl: string
  apiKey: string
  modelMode: SetupModelMode
  model: string
  tierModels: SetupTierModels
  tierContextWindowTokens: TierContextWindowMapping
  contextWindowTokens?: number
}

export type ConnectionTestOk = {
  ok: true
  models: string[]
  modelContextWindows?: Record<string, number>
}

export type ConnectionTestError = {
  ok: false
  code: ErrorCode
  message: string
}

export type ConnectionTestResult = ConnectionTestOk | ConnectionTestError
