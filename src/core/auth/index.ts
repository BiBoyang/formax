import type { FileStore } from '../../adapters/fs/fileStore.js'
import { AuthStoreV1Schema } from '../config/schema.js'
import type { AuthStoreV1, ProviderId } from '../config/schema.js'

const AUTH_FILE_MODE = 0o600

export type AuthListItem = {
  provider: ProviderId
  authRef: string
}

export type AuthListResult = {
  authPath: string
  items: AuthListItem[]
  warnings: string[]
}

export type AuthSetResult = {
  authPath: string
  provider: ProviderId
  authRef: string
  warnings: string[]
}

export type AuthDeleteResult = {
  authPath: string
  provider: ProviderId
  authRef: string
  deleted: boolean
  warnings: string[]
}

function emptyAuthStore(): AuthStoreV1 {
  return AuthStoreV1Schema.parse({})
}

async function loadAuthStore(args: {
  fileStore: FileStore
  authPath: string
}): Promise<{ store: AuthStoreV1; exists: boolean; warnings: string[] }> {
  const warnings: string[] = []
  const exists = await args.fileStore.exists(args.authPath)
  if (!exists) return { store: emptyAuthStore(), exists: false, warnings }

  let raw = ''
  try {
    raw = await args.fileStore.readText(args.authPath)
  } catch {
    warnings.push(`Failed to read auth store at ${args.authPath}`)
    return { store: emptyAuthStore(), exists: true, warnings }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    warnings.push(`Failed to parse auth store JSON at ${args.authPath}`)
    return { store: emptyAuthStore(), exists: true, warnings }
  }

  const validated = AuthStoreV1Schema.safeParse(parsed)
  if (!validated.success) {
    warnings.push(`Auth store is invalid at ${args.authPath}`)
    return { store: emptyAuthStore(), exists: true, warnings }
  }

  return { store: validated.data, exists: true, warnings }
}

function normalizeAuthRef(raw: string): string {
  const trimmed = String(raw).trim()
  if (!trimmed) throw new Error('authRef is required')
  return trimmed
}

function normalizeApiKey(raw: string): string {
  const trimmed = String(raw).trim()
  if (!trimmed) throw new Error('apiKey is required')
  return trimmed
}

export async function authList(args: { fileStore: FileStore; authPath: string }): Promise<AuthListResult> {
  const loaded = await loadAuthStore(args)
  const items: AuthListItem[] = []

  for (const provider of Object.keys(loaded.store.providers) as ProviderId[]) {
    const entries = loaded.store.providers[provider]
    for (const authRef of Object.keys(entries)) {
      items.push({ provider, authRef })
    }
  }

  items.sort((a, b) => (a.provider === b.provider ? a.authRef.localeCompare(b.authRef) : a.provider.localeCompare(b.provider)))
  return { authPath: args.authPath, items, warnings: loaded.warnings }
}

export async function authSet(args: {
  fileStore: FileStore
  authPath: string
  provider: ProviderId
  authRef: string
  apiKey: string
}): Promise<AuthSetResult> {
  const authRef = normalizeAuthRef(args.authRef)
  const apiKey = normalizeApiKey(args.apiKey)

  const loaded = await loadAuthStore({ fileStore: args.fileStore, authPath: args.authPath })
  const store = loaded.store

  const providers = { ...store.providers } as any
  const providerEntries = { ...(providers[args.provider] || {}) }
  providerEntries[authRef] = { apiKey }
  providers[args.provider] = providerEntries

  const next = AuthStoreV1Schema.parse({ ...store, providers })
  await args.fileStore.writeJsonAtomic(args.authPath, next, { mode: AUTH_FILE_MODE })

  return { authPath: args.authPath, provider: args.provider, authRef, warnings: loaded.warnings }
}

export async function authDelete(args: {
  fileStore: FileStore
  authPath: string
  provider: ProviderId
  authRef: string
}): Promise<AuthDeleteResult> {
  const authRef = normalizeAuthRef(args.authRef)

  const loaded = await loadAuthStore({ fileStore: args.fileStore, authPath: args.authPath })
  if (!loaded.exists) {
    return { authPath: args.authPath, provider: args.provider, authRef, deleted: false, warnings: loaded.warnings }
  }

  const store = loaded.store
  const existing = store.providers[args.provider]
  if (!existing || !(authRef in existing)) {
    return { authPath: args.authPath, provider: args.provider, authRef, deleted: false, warnings: loaded.warnings }
  }

  const providers = { ...store.providers } as any
  const providerEntries = { ...providers[args.provider] }
  delete providerEntries[authRef]
  if (Object.keys(providerEntries).length === 0) delete providers[args.provider]
  else providers[args.provider] = providerEntries

  const next = AuthStoreV1Schema.parse({ ...store, providers })
  await args.fileStore.writeJsonAtomic(args.authPath, next, { mode: AUTH_FILE_MODE })

  return { authPath: args.authPath, provider: args.provider, authRef, deleted: true, warnings: loaded.warnings }
}
