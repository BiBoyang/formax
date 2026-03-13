import { fetchAnthropicModels, fetchCustomModels } from '../../core/models/models.js'
import { getModelContextWindowsFromCatalog, resolveCatalogProviderKeys } from '../../core/models/modelContextCatalog.js'
import { ErrorCode } from '../../core/errors/codes.js'
import { mapUnknownError } from '../../core/setup/errorMapping.js'
import type { ProviderId } from '../../config/settings/schema.js'
import type { ConnectionTestResult } from '../../core/setup/types.js'

function toPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.round(n)
}

function inferContextWindowTokens(model: string): number {
  const m = String(model).trim().toLowerCase()
  if (m.startsWith('claude-')) return 200000
  if (m.startsWith('gpt-4o') || m.startsWith('gpt-4.1') || m.startsWith('gpt-4-turbo')) return 128000
  if (m === 'gpt-4' || m.startsWith('gpt-4-')) return 8192
  if (m.startsWith('gpt-3.5')) return 16385
  if (m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 128000
  return 32768
}

export async function testSetupConnection(args: {
  provider: ProviderId
  baseUrl: string
  apiKey: string
}): Promise<ConnectionTestResult> {
  const provider = args.provider

  if (provider === 'anthropic') {
    try {
      const modelInfos = await fetchAnthropicModels(args.apiKey, args.baseUrl)
      const names = modelInfos.map((m) => String(m.model || '').trim()).filter(Boolean)
      const detected = Object.fromEntries(
        modelInfos
          .map((m) => {
            const name = String(m.model || '').trim()
            if (!name) return null
            const context = toPositiveInt((m as any).contextWindowTokens ?? (m as any).context_window ?? (m as any).context_length)
            return context ? ([name, context] as const) : null
          })
          .filter((row): row is readonly [string, number] => Boolean(row)),
      )
      const missing = names.filter((name) => !detected[name])
      const fromCatalog =
        missing.length > 0
          ? await getModelContextWindowsFromCatalog({
              providerKeys: resolveCatalogProviderKeys({ provider, baseUrl: args.baseUrl }),
              modelIds: missing,
            })
          : {}
      const modelContextWindows = Object.fromEntries(
        names.map((name) => [name, detected[name] ?? fromCatalog[name] ?? inferContextWindowTokens(name)] as const),
      )
      return { ok: true, models: names, modelContextWindows }
    } catch (err) {
      const mapped = mapUnknownError(err)
      return { ok: false, code: mapped.code, message: mapped.message }
    }
  }

  if (provider === 'openai') {
    try {
      const rawModels = await fetchCustomModels(args.baseUrl, args.apiKey)
      const rows = rawModels.flatMap((m: any) => {
        const name = String(m?.id || m?.model || m?.name || '').trim()
        if (!name) return []
        const context = toPositiveInt(
          m?.contextWindowTokens ?? m?.context_window ?? m?.context_length ?? m?.inputTokenLimit ?? m?.input_token_limit,
        )
        return [{ name, context }]
      })
      const models = rows.map((row) => row.name)
      const detected = Object.fromEntries(
        rows
          .map((row) => (row.context ? ([row.name, row.context] as const) : null))
          .filter((pair): pair is readonly [string, number] => Boolean(pair)),
      )
      const missing = models.filter((name) => !detected[name])
      const fromCatalog =
        missing.length > 0
          ? await getModelContextWindowsFromCatalog({
              providerKeys: resolveCatalogProviderKeys({ provider, baseUrl: args.baseUrl }),
              modelIds: missing,
            })
          : {}
      const modelContextWindows = Object.fromEntries(
        models.map((name) => [name, detected[name] ?? fromCatalog[name] ?? inferContextWindowTokens(name)] as const),
      )
      if (models.length > 0) {
        return { ok: true, models, modelContextWindows }
      }
      return { ok: false, code: ErrorCode.Unknown, message: 'No models returned from provider.' }
    } catch (err) {
      const mapped = mapUnknownError(err)
      return { ok: false, code: mapped.code, message: mapped.message }
    }
  }

  if (provider === 'gemini') {
    return { ok: false, code: ErrorCode.SetupRequired, message: 'Gemini setup is not implemented yet.' }
  }

  return { ok: false, code: ErrorCode.Unknown, message: `Unknown provider: ${String(provider)}` }
}
