import type { ProviderId } from '../../config/settings/schema.js'

type ModelsDevModelInfo = {
  limit?: {
    context?: unknown
  }
}

type ModelsDevProviderInfo = {
  models?: Record<string, ModelsDevModelInfo>
}

type ModelsDevCatalog = Record<string, ModelsDevProviderInfo>

const MODELS_DEV_URL = 'https://models.dev/api.json'
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000
const FAILURE_TTL_MS = 60 * 1000

let cache: { expiresAt: number; data: ModelsDevCatalog | null } | null = null

function toPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.round(n)
}

function parseHost(baseUrl: string): string {
  try {
    return new URL(String(baseUrl || '').trim()).host.toLowerCase()
  } catch {
    return ''
  }
}

function deriveHostStem(host: string): string | null {
  const normalized = String(host || '').trim().toLowerCase().split(':')[0] || ''
  if (!normalized) return null
  const labels = normalized.split('.').filter(Boolean)
  if (labels.length === 0) return null
  const ignoredPrefixes = new Set(['www', 'api', 'gateway', 'open', 'proxy'])
  let idx = 0
  while (idx < labels.length - 1 && ignoredPrefixes.has(labels[idx]!)) idx += 1
  const stem = labels[idx] || ''
  return /^[a-z0-9-]+$/.test(stem) ? stem : null
}

export function resolveCatalogProviderKeys(args: { provider: ProviderId; baseUrl: string }): string[] {
  const host = parseHost(args.baseUrl)
  const keys: string[] = []

  const push = (key: string) => {
    if (!keys.includes(key)) keys.push(key)
  }

  if (host.includes('bigmodel.cn')) push('zhipuai')
  if (host.includes('moonshot.cn')) {
    push('moonshotai-cn')
    push('moonshotai')
  }
  if (host.includes('moonshot')) {
    push('moonshotai')
    push('moonshotai-cn')
  }
  if (host.includes('minimaxi.com')) {
    push('minimax-cn')
    push('minimax')
  }
  if (host.includes('minimax.io') || host.includes('minimax')) {
    push('minimax')
    push('minimax-cn')
  }
  if (host.includes('anthropic.com')) push('anthropic')
  if (host.includes('openai.com')) push('openai')
  if (host.includes('deepseek.com')) push('deepseek')

  if (args.provider === 'openai') {
    push('openai')
  } else if (args.provider === 'anthropic') {
    if (keys.length === 0) {
      push('anthropic')
      push('zhipuai')
      push('moonshotai-cn')
      push('moonshotai')
      push('minimax-cn')
      push('minimax')
    }
  }

  const hostStem = deriveHostStem(host)
  if (keys.length === 0 && hostStem) push(hostStem)

  return keys
}

async function loadCatalog(): Promise<ModelsDevCatalog | null> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.data

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(MODELS_DEV_URL, { signal: controller.signal })
    if (!res.ok) {
      cache = { data: null, expiresAt: now + FAILURE_TTL_MS }
      return null
    }
    const data = await res.json()
    if (!data || typeof data !== 'object') {
      cache = { data: null, expiresAt: now + FAILURE_TTL_MS }
      return null
    }
    cache = { data: data as ModelsDevCatalog, expiresAt: now + CATALOG_TTL_MS }
    return cache.data
  } catch {
    cache = { data: null, expiresAt: now + FAILURE_TTL_MS }
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function getModelContextWindowsFromCatalog(args: {
  providerKeys: string[]
  modelIds: string[]
}): Promise<Record<string, number>> {
  const providerKeys = (args.providerKeys || []).map((k) => String(k || '').trim()).filter(Boolean)
  const modelIds = [...new Set((args.modelIds || []).map((m) => String(m || '').trim()).filter(Boolean))]
  if (providerKeys.length === 0 || modelIds.length === 0) return {}

  const catalog = await loadCatalog()
  if (!catalog) return {}

  const out: Record<string, number> = {}
  for (const modelId of modelIds) {
    for (const providerKey of providerKeys) {
      const candidate = catalog?.[providerKey]?.models?.[modelId]?.limit?.context
      const context = toPositiveInt(candidate)
      if (context) {
        out[modelId] = context
        break
      }
    }
  }

  // Fallback for provider-key misses: search remaining model IDs across all
  // catalog providers to avoid strict host-key coupling.
  const missing = modelIds.filter((modelId) => out[modelId] === undefined)
  if (missing.length > 0) {
    for (const modelId of missing) {
      for (const providerInfo of Object.values(catalog)) {
        const candidate = providerInfo?.models?.[modelId]?.limit?.context
        const context = toPositiveInt(candidate)
        if (context) {
          out[modelId] = context
          break
        }
      }
    }
  }

  return out
}

export function __resetCatalogCacheForTests(): void {
  cache = null
}
