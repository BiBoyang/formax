import type { ProviderId } from '../config/schema.js'
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
  | 'model'
  | 'confirm'
  | 'write'
  | 'done'

export type SetupDraft = {
  provider: ProviderId | null
  baseUrl: string
  apiKey: string
  model: string
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
