import fs from 'node:fs'
import readline from 'node:readline'
import type {
  ThreadRuntimePreferences,
  ThreadRuntimePreferencesPatch,
} from '../../semantics/runtime/threadRuntimeState.js'
import { parseJsonLine, parseSessionEventRecord } from './recordParsing.js'

export const THREAD_RUNTIME_STATE_PATCH_EVENT_NAME = 'thread_runtime_state_patch'
export const THREAD_RUNTIME_STATE_PATCH_SCHEMA_VERSION = 1

export type ThreadRuntimeStatePatchEventSource = 'web' | 'tui' | 'system'

export type ThreadRuntimeStatePatchEventData = {
  schemaVersion: 1
  threadId: string
  source: ThreadRuntimeStatePatchEventSource
  patch: {
    preferences: ThreadRuntimePreferencesPatch
  }
  opId?: string
}

export type ReducedThreadRuntimePreferences = {
  preferences: ThreadRuntimePreferences
  validEventCount: number
  ignoredEventCount: number
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parsePreferencePatch(value: unknown): ThreadRuntimePreferencesPatch | null {
  if (!isObject(value)) return null
  const out: ThreadRuntimePreferencesPatch = {}
  let hasField = false

  if (Object.prototype.hasOwnProperty.call(value, 'modelTier')) {
    const modelTier = value.modelTier
    if (modelTier === null) {
      out.modelTier = null
      hasField = true
    } else if (modelTier === 'haiku' || modelTier === 'sonnet' || modelTier === 'opus') {
      out.modelTier = modelTier
      hasField = true
    } else {
      return null
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'thinkingMode')) {
    const thinkingMode = value.thinkingMode
    if (thinkingMode === null) {
      out.thinkingMode = null
      hasField = true
    } else if (typeof thinkingMode === 'boolean') {
      out.thinkingMode = thinkingMode
      hasField = true
    } else {
      return null
    }
  }

  return hasField ? out : {}
}

function applyPreferencePatch(
  current: ThreadRuntimePreferences,
  patch: ThreadRuntimePreferencesPatch,
): ThreadRuntimePreferences {
  const next: ThreadRuntimePreferences = { ...current }
  if (Object.prototype.hasOwnProperty.call(patch, 'modelTier')) {
    if (patch.modelTier === null) delete next.modelTier
    else if (patch.modelTier) next.modelTier = patch.modelTier
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'thinkingMode')) {
    if (patch.thinkingMode === null) delete next.thinkingMode
    else if (typeof patch.thinkingMode === 'boolean') next.thinkingMode = patch.thinkingMode
  }
  return next
}

export function parseThreadRuntimeStatePatchEventData(
  data: unknown,
  expectedThreadId?: string,
): ThreadRuntimeStatePatchEventData | null {
  if (!isObject(data)) return null
  if (data.schemaVersion !== THREAD_RUNTIME_STATE_PATCH_SCHEMA_VERSION) return null

  const threadId = toNonEmptyString(data.threadId)
  if (!threadId) return null
  if (expectedThreadId && threadId !== expectedThreadId) return null

  const source = data.source === 'web' || data.source === 'tui' || data.source === 'system'
    ? data.source
    : null
  if (!source) return null

  if (!isObject(data.patch)) return null
  if (Object.keys(data.patch).some((key) => key !== 'preferences')) return null
  const preferences = parsePreferencePatch(data.patch.preferences)
  if (!preferences) return null

  const opId = toNonEmptyString(data.opId)
  return {
    schemaVersion: THREAD_RUNTIME_STATE_PATCH_SCHEMA_VERSION,
    threadId,
    source,
    patch: { preferences },
    ...(opId ? { opId } : {}),
  }
}

export function buildThreadRuntimeStatePatchEventData(args: {
  threadId: string
  patch: { preferences: ThreadRuntimePreferencesPatch }
  source: ThreadRuntimeStatePatchEventSource
  opId?: string
}): ThreadRuntimeStatePatchEventData {
  const threadId = toNonEmptyString(args.threadId)
  if (!threadId) throw new Error('Invalid threadId: expected non-empty string')
  const preferences = parsePreferencePatch(args.patch.preferences)
  if (!preferences) throw new Error('Invalid preferences patch')
  const opId = toNonEmptyString(args.opId)
  return {
    schemaVersion: THREAD_RUNTIME_STATE_PATCH_SCHEMA_VERSION,
    threadId,
    source: args.source,
    patch: { preferences },
    ...(opId ? { opId } : {}),
  }
}

export async function readThreadRuntimePreferencesFromSession(args: {
  filePath: string
  threadId: string
}): Promise<ReducedThreadRuntimePreferences> {
  let preferences: ThreadRuntimePreferences = {}
  let validEventCount = 0
  let ignoredEventCount = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(args.filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  try {
    for await (const line of rl) {
      const parsed = parseJsonLine(line)
      const event = parseSessionEventRecord(parsed)
      if (!event || event.name !== THREAD_RUNTIME_STATE_PATCH_EVENT_NAME) continue
      const data = parseThreadRuntimeStatePatchEventData(event.data, args.threadId)
      if (!data) {
        ignoredEventCount += 1
        continue
      }
      preferences = applyPreferencePatch(preferences, data.patch.preferences)
      validEventCount += 1
    }
  } finally {
    rl.close()
  }

  return { preferences, validEventCount, ignoredEventCount }
}
