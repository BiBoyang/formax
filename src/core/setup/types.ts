import type { ModelTier, ProviderId } from '../config/schema.js'
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
  | 'baseUrl'
  | 'apiKey'
  | 'test'
  | 'modelMode'
  | 'model'
  | 'confirm'
  | 'write'
  | 'done'

export type SetupModelMode = 'quick' | 'advanced'

export type SetupTierModels = Record<ModelTier, string>

export type SetupDraft = {
  provider: ProviderId | null
  baseUrl: string
  apiKey: string
  modelMode: SetupModelMode
  model: string
  tierModels: SetupTierModels
}

export type ConnectionTestOk = {
  ok: true
  models: string[]
}

export type ConnectionTestError = {
  ok: false
  code: ErrorCode
  message: string
}

export type ConnectionTestResult = ConnectionTestOk | ConnectionTestError
