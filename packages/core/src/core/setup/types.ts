import type { CapabilityConfidence, CapabilitySource, ModelIdentity, ModelTier, ProviderId, TierContextWindowMapping } from '../../config/settings/schema.js'
import type { ErrorCode } from '../errors/codes.js'
import type { ModelContextWindowMetadata } from '../../config/modelCapability.js'

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
export type SetupAnthropicVendor = 'deepseek' | 'anthropic' | 'glm' | 'kimi' | 'minimax' | 'custom'

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
  tierContextWindowSources?: Partial<Record<ModelTier, CapabilitySource>>
  tierContextWindowConfidence?: Partial<Record<ModelTier, CapabilityConfidence>>
  tierContextWindowBindings?: Partial<Record<ModelTier, ModelIdentity>>
  tierContextWindowManualClears?: Partial<Record<ModelTier, ModelIdentity>>
  contextWindowTokens?: number
  contextWindowBinding?: ModelIdentity
}

export type ConnectionTestOk = {
  ok: true
  models: string[]
  modelContextWindows?: Record<string, number>
  modelContextWindowMetadata?: Record<string, ModelContextWindowMetadata>
}

export type ConnectionTestError = {
  ok: false
  code: ErrorCode
  message: string
}

export type ConnectionTestResult = ConnectionTestOk | ConnectionTestError
