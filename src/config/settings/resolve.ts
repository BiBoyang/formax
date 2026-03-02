import type { AuthStoreV1, FormaxConfigV1, FormaxConfigV1Patch, ProviderId } from './schema'
import { AuthStoreV1Schema, FormaxConfigV1PatchSchema, FormaxConfigV1Schema } from './schema'

export type ConfigSource = 'flags' | 'env' | 'project' | 'global' | 'default'

export type ResolvedAuth = {
  provider: ProviderId
  apiKey: string
  source: ConfigSource
}

export type ResolvedConfig = {
  config: FormaxConfigV1
  auth: ResolvedAuth | null
  sources: Record<string, ConfigSource>
  warnings: string[]
}

export type ResolveRuntimeConfigInputs = {
  defaults?: unknown
  globalConfig?: unknown
  projectConfig?: unknown
  authStore?: unknown
  env?: Record<string, string | undefined>
  flags?: unknown
}

const SOURCE_ORDER: ConfigSource[] = ['default', 'global', 'project', 'env', 'flags']
const KNOWN_SOURCE_KEYS = [
  'version',
  'llm.provider',
  'llm.baseUrl',
  'llm.model',
  'llm.defaultTier',
  'llm.tierModels',
  'llm.timeoutMs',
  'llm.authRef',
  'llm.contextWindowTokens',
  'llm.thinkingMode',
  'paths.logsDir',
  'paths.subagentsDir',
  'paths.planDir',
  'ui.assistantTextMode',
  'ui.promptProfile',
  'ui.showContextMeter',
  'ui.showAutoCompactNotice',
  'ui.outputStyle',
  'ui.verboseOutput',
  'context.effectiveContextWindowPercent',
  'context.autoCompactTokenLimitPercent',
  'context.baselineTokens',
  'context.compactKeepLastTurns',
  'context.enableAutoCompact',
  'context.autoCompactMinTurnsBetweenRuns',
] as const

function normalizeAnthropicBaseUrl(baseUrl: string): string {
  const raw = (baseUrl || '').trim()
  if (!raw) return ''
  const trimmed = raw.replace(/\/+$/, '')
  if (/\/v\d+$/i.test(trimmed)) return trimmed
  return `${trimmed}/v1`
}

function parsePatch(source: ConfigSource, input: unknown, warnings: string[]): FormaxConfigV1Patch {
  const res = FormaxConfigV1PatchSchema.safeParse(input ?? {})
  if (res.success) return res.data
  warnings.push(`${source} config is invalid and was ignored`)
  return {}
}

function parseAuthStore(input: unknown, warnings: string[]): AuthStoreV1 | null {
  if (!input) return null
  const res = AuthStoreV1Schema.safeParse(input)
  if (res.success) return res.data
  warnings.push('auth store is invalid and was ignored')
  return null
}

function resolveAuthFromStore(
  store: AuthStoreV1 | null,
  provider: ProviderId,
  authRef: string,
  warnings: string[],
): ResolvedAuth | null {
  if (!store) return null
  const providerEntries = store.providers[provider]
  if (!providerEntries) return null
  const entry = providerEntries[authRef]
  if (!entry) {
    warnings.push(`auth ref "${authRef}" not found for provider "${provider}"`)
    return null
  }
  return { provider, apiKey: entry.apiKey, source: 'global' }
}

function envToPatch(
  env: Record<string, string | undefined>,
  warnings: string[],
): { patch: FormaxConfigV1Patch; auth: ResolvedAuth | null } {
  const patch: FormaxConfigV1Patch = {}

  const apiKey = (env.FORMAX_API_KEY || '').trim()
  const baseUrl = normalizeAnthropicBaseUrl((env.FORMAX_BASE_URL || '').trim())
  const timeoutMsRaw = (env.FORMAX_TIMEOUT_MS || '').trim()
  const timeoutMsParsed = timeoutMsRaw ? Number(timeoutMsRaw) : undefined
  const timeoutMs =
    timeoutMsRaw && Number.isFinite(timeoutMsParsed) && Number.isInteger(timeoutMsParsed) && timeoutMsParsed > 0
      ? timeoutMsParsed
      : undefined
  if (timeoutMsRaw && timeoutMs === undefined) {
    warnings.push('env FORMAX_TIMEOUT_MS is invalid and was ignored')
  }

  const logsDir = (env.FORMAX_LOGS_DIR || '').trim()
  const subagentsDir = (env.FORMAX_SUBAGENTS_DIR || '').trim()
  const planDir = (env.FORMAX_PLAN_DIR || '').trim()

  const assistantTextModeRaw = (env.FORMAX_ASSISTANT_TEXT_MODE || '').trim().toLowerCase()
  const assistantTextMode =
    assistantTextModeRaw === 'stream' ? 'stream' : assistantTextModeRaw === 'buffered' ? 'buffered' : undefined

  const promptProfileRaw = (env.FORMAX_PROMPT_PROFILE || '').trim().toLowerCase()
  const promptProfile = promptProfileRaw === 'lite' ? 'lite' : promptProfileRaw === 'full' ? 'full' : undefined

  const showContextMeterRaw = (env.FORMAX_SHOW_CONTEXT_METER || '').trim().toLowerCase()
  const showContextMeter =
    showContextMeterRaw === '1' || showContextMeterRaw === 'true'
      ? true
      : showContextMeterRaw === '0' || showContextMeterRaw === 'false'
        ? false
        : undefined
  if (showContextMeterRaw && showContextMeter === undefined) {
    warnings.push('env FORMAX_SHOW_CONTEXT_METER is invalid and was ignored')
  }

  const showAutoCompactNoticeRaw = (env.FORMAX_SHOW_AUTO_COMPACT_NOTICE || '').trim().toLowerCase()
  const showAutoCompactNotice =
    showAutoCompactNoticeRaw === '1' || showAutoCompactNoticeRaw === 'true'
      ? true
      : showAutoCompactNoticeRaw === '0' || showAutoCompactNoticeRaw === 'false'
        ? false
        : undefined
  if (showAutoCompactNoticeRaw && showAutoCompactNotice === undefined) {
    warnings.push('env FORMAX_SHOW_AUTO_COMPACT_NOTICE is invalid and was ignored')
  }

  const contextWindowTokensRaw = (env.FORMAX_CONTEXT_WINDOW_TOKENS || '').trim()
  const contextWindowTokensParsed = contextWindowTokensRaw ? Number(contextWindowTokensRaw) : undefined
  const contextWindowTokens =
    contextWindowTokensRaw &&
    Number.isFinite(contextWindowTokensParsed) &&
    Number.isInteger(contextWindowTokensParsed) &&
    contextWindowTokensParsed > 0
      ? contextWindowTokensParsed
      : undefined
  if (contextWindowTokensRaw && contextWindowTokens === undefined) {
    warnings.push('env FORMAX_CONTEXT_WINDOW_TOKENS is invalid and was ignored')
  }

  const effectiveContextWindowPercentRaw = (env.FORMAX_EFFECTIVE_CONTEXT_WINDOW_PERCENT || '').trim()
  const effectiveContextWindowPercentParsed = effectiveContextWindowPercentRaw
    ? Number(effectiveContextWindowPercentRaw)
    : undefined
  const effectiveContextWindowPercent =
    effectiveContextWindowPercentRaw &&
    Number.isFinite(effectiveContextWindowPercentParsed) &&
    effectiveContextWindowPercentParsed >= 0 &&
    effectiveContextWindowPercentParsed <= 1
      ? effectiveContextWindowPercentParsed
      : undefined
  if (effectiveContextWindowPercentRaw && effectiveContextWindowPercent === undefined) {
    warnings.push('env FORMAX_EFFECTIVE_CONTEXT_WINDOW_PERCENT is invalid and was ignored')
  }

  const autoCompactTokenLimitPercentRaw = (env.FORMAX_AUTO_COMPACT_TOKEN_LIMIT_PERCENT || '').trim()
  const autoCompactTokenLimitPercentParsed = autoCompactTokenLimitPercentRaw
    ? Number(autoCompactTokenLimitPercentRaw)
    : undefined
  const autoCompactTokenLimitPercent =
    autoCompactTokenLimitPercentRaw &&
    Number.isFinite(autoCompactTokenLimitPercentParsed) &&
    autoCompactTokenLimitPercentParsed >= 0 &&
    autoCompactTokenLimitPercentParsed <= 1
      ? autoCompactTokenLimitPercentParsed
      : undefined
  if (autoCompactTokenLimitPercentRaw && autoCompactTokenLimitPercent === undefined) {
    warnings.push('env FORMAX_AUTO_COMPACT_TOKEN_LIMIT_PERCENT is invalid and was ignored')
  }

  const baselineTokensRaw = (env.FORMAX_BASELINE_TOKENS || '').trim()
  const baselineTokensParsed = baselineTokensRaw ? Number(baselineTokensRaw) : undefined
  const baselineTokens =
    baselineTokensRaw &&
    Number.isFinite(baselineTokensParsed) &&
    Number.isInteger(baselineTokensParsed) &&
    baselineTokensParsed >= 0
      ? baselineTokensParsed
      : undefined
  if (baselineTokensRaw && baselineTokens === undefined) {
    warnings.push('env FORMAX_BASELINE_TOKENS is invalid and was ignored')
  }

  const compactKeepLastTurnsRaw = (env.FORMAX_COMPACT_KEEP_LAST_TURNS || '').trim()
  const compactKeepLastTurnsParsed = compactKeepLastTurnsRaw ? Number(compactKeepLastTurnsRaw) : undefined
  const compactKeepLastTurns =
    compactKeepLastTurnsRaw &&
    Number.isFinite(compactKeepLastTurnsParsed) &&
    Number.isInteger(compactKeepLastTurnsParsed) &&
    compactKeepLastTurnsParsed >= 0
      ? compactKeepLastTurnsParsed
      : undefined
  if (compactKeepLastTurnsRaw && compactKeepLastTurns === undefined) {
    warnings.push('env FORMAX_COMPACT_KEEP_LAST_TURNS is invalid and was ignored')
  }

  const autoCompactMinTurnsBetweenRunsRaw = (env.FORMAX_AUTO_COMPACT_MIN_TURNS_BETWEEN_RUNS || '').trim()
  const autoCompactMinTurnsBetweenRunsParsed = autoCompactMinTurnsBetweenRunsRaw
    ? Number(autoCompactMinTurnsBetweenRunsRaw)
    : undefined
  const autoCompactMinTurnsBetweenRuns =
    autoCompactMinTurnsBetweenRunsRaw &&
    Number.isFinite(autoCompactMinTurnsBetweenRunsParsed) &&
    Number.isInteger(autoCompactMinTurnsBetweenRunsParsed) &&
    autoCompactMinTurnsBetweenRunsParsed >= 0
      ? autoCompactMinTurnsBetweenRunsParsed
      : undefined
  if (autoCompactMinTurnsBetweenRunsRaw && autoCompactMinTurnsBetweenRuns === undefined) {
    warnings.push('env FORMAX_AUTO_COMPACT_MIN_TURNS_BETWEEN_RUNS is invalid and was ignored')
  }

  const hasLlmEnv = Boolean(baseUrl || timeoutMsRaw)
  if (hasLlmEnv) {
    patch.llm = {
      ...(patch.llm || {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(Number.isFinite(timeoutMs) ? { timeoutMs: timeoutMs as number } : {}),
    }
  }

  if (contextWindowTokens !== undefined) {
    patch.llm = {
      ...(patch.llm || {}),
      contextWindowTokens,
    }
  }

  if (logsDir || subagentsDir || planDir) {
    patch.paths = {
      ...(patch.paths || {}),
      ...(logsDir ? { logsDir } : {}),
      ...(subagentsDir ? { subagentsDir } : {}),
      ...(planDir ? { planDir } : {}),
    }
  }

  if (assistantTextMode || promptProfile) {
    patch.ui = {
      ...(patch.ui || {}),
      ...(assistantTextMode ? { assistantTextMode } : {}),
      ...(promptProfile ? { promptProfile } : {}),
    }
  }

  if (showContextMeter !== undefined) {
    patch.ui = {
      ...(patch.ui || {}),
      showContextMeter,
    }
  }

  if (showAutoCompactNotice !== undefined) {
    patch.ui = {
      ...(patch.ui || {}),
      showAutoCompactNotice,
    }
  }

  if (
    effectiveContextWindowPercent !== undefined ||
    autoCompactTokenLimitPercent !== undefined ||
    baselineTokens !== undefined ||
    compactKeepLastTurns !== undefined ||
    autoCompactMinTurnsBetweenRuns !== undefined
  ) {
    patch.context = {
      ...(patch.context || {}),
      ...(effectiveContextWindowPercent !== undefined ? { effectiveContextWindowPercent } : {}),
      ...(autoCompactTokenLimitPercent !== undefined ? { autoCompactTokenLimitPercent } : {}),
      ...(baselineTokens !== undefined ? { baselineTokens } : {}),
      ...(compactKeepLastTurns !== undefined ? { compactKeepLastTurns } : {}),
      ...(autoCompactMinTurnsBetweenRuns !== undefined ? { autoCompactMinTurnsBetweenRuns } : {}),
    }
  }

  const auth: ResolvedAuth | null = apiKey
    ? {
        provider: 'anthropic',
        apiKey,
        source: 'env',
      }
    : null

  const validated = FormaxConfigV1PatchSchema.safeParse(patch)
  if (!validated.success) {
    warnings.push('env config is invalid and was ignored')
    return { patch: {}, auth }
  }

  return { patch: validated.data, auth }
}

function mergePatch(base: FormaxConfigV1Patch, next: FormaxConfigV1Patch): FormaxConfigV1Patch {
  return {
    ...base,
    ...next,
    llm: { ...(base.llm || {}), ...(next.llm || {}) },
    paths: { ...(base.paths || {}), ...(next.paths || {}) },
    ui: { ...(base.ui || {}), ...(next.ui || {}) },
    context: { ...(base.context || {}), ...(next.context || {}) },
  }
}

function flattenPatch(patch: FormaxConfigV1Patch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.llm) for (const [k, v] of Object.entries(patch.llm)) out[`llm.${k}`] = v
  if (patch.paths) for (const [k, v] of Object.entries(patch.paths)) out[`paths.${k}`] = v
  if (patch.ui) for (const [k, v] of Object.entries(patch.ui)) out[`ui.${k}`] = v
  if (patch.context) for (const [k, v] of Object.entries(patch.context)) out[`context.${k}`] = v
  if (patch.version !== undefined) out.version = patch.version
  return out
}

function computeSources(patches: Record<ConfigSource, FormaxConfigV1Patch>): Record<string, ConfigSource> {
  const bySource = Object.fromEntries(Object.entries(patches).map(([k, v]) => [k, flattenPatch(v)])) as Record<
    ConfigSource,
    Record<string, unknown>
  >

  const keys = new Set<string>()
  for (const src of SOURCE_ORDER) for (const key of Object.keys(bySource[src])) keys.add(key)

  const sources: Record<string, ConfigSource> = {}
  for (const key of keys) {
    const chosen = SOURCE_ORDER
      .slice()
      .reverse()
      .find((src) => Object.prototype.hasOwnProperty.call(bySource[src], key)) as ConfigSource
    sources[key] = chosen
  }
  return sources
}

export function resolveRuntimeConfig(inputs: ResolveRuntimeConfigInputs): ResolvedConfig {
  const warnings: string[] = []

  const authStore = parseAuthStore(inputs.authStore, warnings)
  const defaultsPatch = parsePatch('default', inputs.defaults, warnings)
  const globalPatch = parsePatch('global', inputs.globalConfig, warnings)
  const projectPatch = parsePatch('project', inputs.projectConfig, warnings)
  const envParsed = envToPatch(inputs.env ?? {}, warnings)
  const envPatch = envParsed.patch
  const flagsPatch = parsePatch('flags', inputs.flags, warnings)

  const mergedPatch = [defaultsPatch, globalPatch, projectPatch, envPatch, flagsPatch].reduce(mergePatch, {})
  const config = FormaxConfigV1Schema.parse(mergedPatch)
  const sources = computeSources({
    default: defaultsPatch,
    global: globalPatch,
    project: projectPatch,
    env: envPatch,
    flags: flagsPatch,
  })

  for (const key of KNOWN_SOURCE_KEYS) {
    if (!(key in sources)) sources[key] = 'default'
  }

  const auth =
    envParsed.auth ?? resolveAuthFromStore(authStore, config.llm.provider, config.llm.authRef, warnings)

  return { config, auth, sources, warnings }
}
