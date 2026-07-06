import type { RuntimeConfig } from '../../config/config.js'

export type SetupStatusReason =
  | 'configured'
  | 'missing_api_key'
  | 'missing_base_url'
  | 'missing_model'
  | 'invalid_config'

export type SetupConfiguredStatusInput =
  | { runtime: RuntimeConfig; configLoadError?: undefined }
  | { runtime?: undefined; configLoadError: unknown }

const EXPLICIT_MODEL_SOURCES = new Set(['tier_env', 'legacy_sonnet_model', 'tier_model'])

function hasExplicitModelSource(runtime: RuntimeConfig): boolean {
  const source = runtime.llm.modelSource
  return typeof source === 'string' && EXPLICIT_MODEL_SOURCES.has(source)
}

export function getSetupConfiguredReason(input: SetupConfiguredStatusInput): SetupStatusReason {
  if (!input.runtime || input.configLoadError != null) return 'invalid_config'
  const runtime = input.runtime
  if (!runtime.llm.apiKey.trim()) return 'missing_api_key'
  if (!runtime.llm.baseUrl.trim()) return 'missing_base_url'
  if (!runtime.llm.model.trim() || !hasExplicitModelSource(runtime)) return 'missing_model'
  return 'configured'
}
