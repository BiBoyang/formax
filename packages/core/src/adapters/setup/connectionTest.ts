import { fetchAnthropicModels, fetchCustomModels } from '../../core/models/models.js'
import { getModelContextWindowsFromCatalog, resolveCatalogProviderKeys } from '../../core/models/modelContextCatalog.js'
import { createModelContextWindowMetadata } from '../../config/modelCapability.js'
import { extractContextWindowTokens, inferContextWindowTokens } from '../../config/modelContextWindow.js'
import { ErrorCode } from '../../core/errors/codes.js'
import { mapUnknownError } from '../../core/setup/errorMapping.js'
import type { ProviderId } from '../../config/settings/schema.js'
import type { ConnectionTestResult } from '../../core/setup/types.js'

function uniqStrings(values: string[]): string[] {
  const out: string[] = []
  for (const v of values) {
    if (!v || out.includes(v)) continue
    out.push(v)
  }
  return out
}

function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl || '').trim().replace(/\/+$/, '')
}

function resolveModelDetailProbeUrls(args: { provider: ProviderId; baseUrl: string; modelId: string }): string[] {
  const modelId = encodeURIComponent(args.modelId)
  const base = normalizeBaseUrl(args.baseUrl)
  const withoutV1 = base.replace(/\/v1$/i, '')
  const urls: string[] = []

  urls.push(`${withoutV1}/v1/models/${modelId}`)

  if (args.provider === 'openai') {
    urls.push(`${withoutV1}/models/${modelId}`)
  }

  if (/\/anthropic$/i.test(withoutV1)) {
    const openAiStyleBase = withoutV1.replace(/\/anthropic$/i, '')
    urls.push(`${openAiStyleBase}/models/${modelId}`)
    urls.push(`${openAiStyleBase}/v1/models/${modelId}`)
  }

  return uniqStrings(urls)
}

function extractContextFromDetailPayload(payload: any): number | undefined {
  const candidates = [payload, payload?.data, payload?.model, payload?.item]
  for (const candidate of candidates) {
    const context = extractContextWindowTokens(candidate)
    if (context) return context
  }
  return undefined
}

async function probeModelContextWindows(args: {
  provider: ProviderId
  baseUrl: string
  apiKey: string
  modelIds: string[]
}): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const headers =
    args.provider === 'anthropic'
      ? {
          'x-api-key': args.apiKey,
          Authorization: `Bearer ${args.apiKey}`,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        }
      : {
          Authorization: `Bearer ${args.apiKey}`,
          'Content-Type': 'application/json',
        }

  for (const modelId of args.modelIds) {
    const urls = resolveModelDetailProbeUrls({
      provider: args.provider,
      baseUrl: args.baseUrl,
      modelId,
    })
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'GET', headers })
        if (!res.ok) continue
        const data = await res.json()
        const context = extractContextFromDetailPayload(data)
        if (context) {
          out[modelId] = context
          break
        }
      } catch {
        // Ignore probe errors and continue to next candidate URL.
      }
    }
  }

  return out
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
            const context = extractContextWindowTokens(m)
            return context ? ([name, context] as const) : null
          })
          .filter((row): row is readonly [string, number] => Boolean(row)),
      )
      const missing = names.filter((name) => !detected[name])
      const fromProbe =
        missing.length > 0
          ? await probeModelContextWindows({
              provider,
              baseUrl: args.baseUrl,
              apiKey: args.apiKey,
              modelIds: missing,
            })
          : {}
      const stillMissing = missing.filter((name) => !fromProbe[name])
      const fromCatalog =
        stillMissing.length > 0
          ? await getModelContextWindowsFromCatalog({
              providerKeys: resolveCatalogProviderKeys({ provider, baseUrl: args.baseUrl }),
              modelIds: stillMissing,
            })
          : {}
      const modelContextWindows = Object.fromEntries(
        names.map(
          (name) =>
            [name, detected[name] ?? fromProbe[name] ?? fromCatalog[name] ?? inferContextWindowTokens(name)] as const,
        ),
      )
      const modelContextWindowMetadata = Object.fromEntries(
        names.map((name) => {
          const tokens = detected[name] ?? fromProbe[name] ?? fromCatalog[name] ?? inferContextWindowTokens(name)
          const source = detected[name]
            ? 'provider_list'
            : fromProbe[name]
              ? 'provider_detail'
              : fromCatalog[name]
                ? 'catalog'
                : 'heuristic'
          const confidence = source === 'catalog' ? 'catalog' : source === 'heuristic' ? 'heuristic' : 'detected'
          return [
            name,
            createModelContextWindowMetadata({
              provider,
              baseUrl: args.baseUrl,
              model: name,
              tokens,
              source,
              confidence,
            }),
          ] as const
        }),
      )
      return { ok: true, models: names, modelContextWindows, modelContextWindowMetadata }
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
        const context = extractContextWindowTokens(m)
        return [{ name, context }]
      })
      const models = rows.map((row) => row.name)
      const detected = Object.fromEntries(
        rows
          .map((row) => (row.context ? ([row.name, row.context] as const) : null))
          .filter((pair): pair is readonly [string, number] => Boolean(pair)),
      )
      const missing = models.filter((name) => !detected[name])
      const fromProbe =
        missing.length > 0
          ? await probeModelContextWindows({
              provider,
              baseUrl: args.baseUrl,
              apiKey: args.apiKey,
              modelIds: missing,
            })
          : {}
      const stillMissing = missing.filter((name) => !fromProbe[name])
      const fromCatalog =
        stillMissing.length > 0
          ? await getModelContextWindowsFromCatalog({
              providerKeys: resolveCatalogProviderKeys({ provider, baseUrl: args.baseUrl }),
              modelIds: stillMissing,
            })
          : {}
      const modelContextWindows = Object.fromEntries(
        models.map(
          (name) =>
            [name, detected[name] ?? fromProbe[name] ?? fromCatalog[name] ?? inferContextWindowTokens(name)] as const,
        ),
      )
      const modelContextWindowMetadata = Object.fromEntries(
        models.map((name) => {
          const tokens = detected[name] ?? fromProbe[name] ?? fromCatalog[name] ?? inferContextWindowTokens(name)
          const source = detected[name]
            ? 'provider_list'
            : fromProbe[name]
              ? 'provider_detail'
              : fromCatalog[name]
                ? 'catalog'
                : 'heuristic'
          const confidence = source === 'catalog' ? 'catalog' : source === 'heuristic' ? 'heuristic' : 'detected'
          return [
            name,
            createModelContextWindowMetadata({
              provider,
              baseUrl: args.baseUrl,
              model: name,
              tokens,
              source,
              confidence,
            }),
          ] as const
        }),
      )
      if (models.length > 0) {
        return { ok: true, models, modelContextWindows, modelContextWindowMetadata }
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
