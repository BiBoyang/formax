import type { FormaxConfigV1, FormaxConfigV1Patch } from './schema'
import { FormaxConfigV1PatchSchema, FormaxConfigV1Schema } from './schema'

export type ConfigSource = 'flags' | 'env' | 'project' | 'global' | 'default'

export type ResolvedAuth = {
  provider: string
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
  env?: Record<string, string | undefined>
  flags?: unknown
}

const SOURCE_ORDER: ConfigSource[] = ['default', 'global', 'project', 'env', 'flags']
const KNOWN_SOURCE_KEYS = [
  'version',
  'llm.provider',
  'llm.baseUrl',
  'llm.model',
  'llm.timeoutMs',
  'llm.authRef',
  'paths.logsDir',
  'paths.subagentsDir',
  'paths.planDir',
  'ui.assistantTextMode',
  'ui.promptProfile',
] as const

function normalizeAnthropicBaseUrl(baseUrl: string): string {
  const raw = (baseUrl || '').trim()
  if (!raw) return ''
  const trimmed = raw.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function parsePatch(source: ConfigSource, input: unknown, warnings: string[]): FormaxConfigV1Patch {
  const res = FormaxConfigV1PatchSchema.safeParse(input ?? {})
  if (res.success) return res.data
  warnings.push(`${source} config is invalid and was ignored`)
  return {}
}

function envToPatch(
  env: Record<string, string | undefined>,
  warnings: string[],
): { patch: FormaxConfigV1Patch; auth: ResolvedAuth | null } {
  const patch: FormaxConfigV1Patch = {}

  const apiKey = (env.ANTHROPIC_API_KEY2 || '').trim()
  const baseUrl = normalizeAnthropicBaseUrl((env.ANTHROPIC_BASE_URL2 || '').trim())
  const model = (env.ANTHROPIC_MODEL || '').trim()
  const timeoutMsRaw = (env.ANTHROPIC_TIMEOUT_MS || '').trim()
  const timeoutMsParsed = timeoutMsRaw ? Number(timeoutMsRaw) : undefined
  const timeoutMs =
    timeoutMsRaw && Number.isFinite(timeoutMsParsed) && Number.isInteger(timeoutMsParsed) && timeoutMsParsed > 0
      ? timeoutMsParsed
      : undefined
  if (timeoutMsRaw && timeoutMs === undefined) {
    warnings.push('env ANTHROPIC_TIMEOUT_MS is invalid and was ignored')
  }

  const logsDir = (env.FORMAX_LOGS_DIR || '').trim()
  const subagentsDir = (env.FORMAX_SUBAGENTS_DIR || '').trim()
  const planDir = (env.FORMAX_PLAN_DIR || '').trim()

  const assistantTextModeRaw = (env.FORMAX_ASSISTANT_TEXT_MODE || '').trim().toLowerCase()
  const assistantTextMode =
    assistantTextModeRaw === 'stream' ? 'stream' : assistantTextModeRaw === 'buffered' ? 'buffered' : undefined

  const promptProfileRaw = (env.FORMAX_PROMPT_PROFILE || '').trim().toLowerCase()
  const promptProfile = promptProfileRaw === 'lite' ? 'lite' : promptProfileRaw === 'full' ? 'full' : undefined

  const hasAnthropic = Boolean(apiKey || baseUrl || model || timeoutMsRaw)
  if (hasAnthropic) {
    patch.llm = {
      ...(patch.llm || {}),
      provider: 'anthropic',
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { model } : {}),
      ...(Number.isFinite(timeoutMs) ? { timeoutMs: timeoutMs as number } : {}),
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
  }
}

function flattenPatch(patch: FormaxConfigV1Patch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.llm) for (const [k, v] of Object.entries(patch.llm)) out[`llm.${k}`] = v
  if (patch.paths) for (const [k, v] of Object.entries(patch.paths)) out[`paths.${k}`] = v
  if (patch.ui) for (const [k, v] of Object.entries(patch.ui)) out[`ui.${k}`] = v
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
      .find((src) => Object.prototype.hasOwnProperty.call(bySource[src], key))
    if (chosen) sources[key] = chosen
  }
  return sources
}

export function resolveRuntimeConfig(inputs: ResolveRuntimeConfigInputs): ResolvedConfig {
  const warnings: string[] = []

  const defaultsPatch = parsePatch('default', inputs.defaults ?? {}, warnings)
  const globalPatch = parsePatch('global', inputs.globalConfig ?? {}, warnings)
  const projectPatch = parsePatch('project', inputs.projectConfig ?? {}, warnings)
  const envParsed = envToPatch(inputs.env ?? {}, warnings)
  const envPatch = envParsed.patch
  const flagsPatch = parsePatch('flags', inputs.flags ?? {}, warnings)

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

  return { config, auth: envParsed.auth, sources, warnings }
}
