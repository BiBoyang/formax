import type { ThreadRuntimePreferences } from '../../semantics'
import type { VisibleSurface } from './newThreadDraft'

export type RuntimeModelTier = 'haiku' | 'sonnet' | 'opus'
export type RuntimeThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const RUNTIME_THINKING_EFFORTS: RuntimeThinkingEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export function isRuntimeThinkingEffort(value: unknown): value is RuntimeThinkingEffort {
  return typeof value === 'string' && RUNTIME_THINKING_EFFORTS.includes(value as RuntimeThinkingEffort)
}

export type RuntimePreferenceView = {
  modelTier: RuntimeModelTier
  thinkingMode: boolean
  thinkingEffort: RuntimeThinkingEffort
}

export type RuntimePreferencePatch = {
  modelTier?: RuntimeModelTier | null
  thinkingMode?: boolean | null
  thinkingEffort?: RuntimeThinkingEffort | null
}

export type RuntimePreferenceWriteTarget =
  | { kind: 'thread'; threadId: string }
  | { kind: 'newThreadDraft' }
  | { kind: 'globalDefaults' }

export const DEFAULT_RUNTIME_PREFERENCES: RuntimePreferenceView = {
  modelTier: 'sonnet',
  thinkingMode: true,
  thinkingEffort: 'medium',
}

export function normalizeRuntimePreferences(preferences: ThreadRuntimePreferences | null | undefined): Partial<RuntimePreferenceView> {
  return {
    ...(preferences?.modelTier ? { modelTier: preferences.modelTier } : {}),
    ...(typeof preferences?.thinkingMode === 'boolean' ? { thinkingMode: preferences.thinkingMode } : {}),
    ...(isRuntimeThinkingEffort(preferences?.thinkingEffort) ? { thinkingEffort: preferences.thinkingEffort } : {}),
  }
}

export function resolveRuntimePreferenceView(args: {
  globalDefaults: RuntimePreferenceView
  threadPreferences?: ThreadRuntimePreferences | null
}): RuntimePreferenceView {
  return {
    ...args.globalDefaults,
    ...normalizeRuntimePreferences(args.threadPreferences),
  }
}

export function resolveThreadPreferencePatchForDefaults(
  patch: Partial<RuntimePreferenceView>,
  globalDefaults: RuntimePreferenceView,
): RuntimePreferencePatch {
  return {
    ...(patch.modelTier !== undefined
      ? { modelTier: patch.modelTier === globalDefaults.modelTier ? null : patch.modelTier }
      : {}),
    ...(patch.thinkingMode !== undefined
      ? { thinkingMode: patch.thinkingMode === globalDefaults.thinkingMode ? null : patch.thinkingMode }
      : {}),
    ...(patch.thinkingEffort !== undefined
      ? { thinkingEffort: patch.thinkingEffort === globalDefaults.thinkingEffort ? null : patch.thinkingEffort }
      : {}),
  }
}

export function resolvePreferenceWriteTarget(args: {
  visibleSurface: VisibleSurface
  activeThreadId: string | null
}): RuntimePreferenceWriteTarget {
  if (args.visibleSurface === 'newThreadDraft') {
    return { kind: 'newThreadDraft' }
  }
  if (args.visibleSurface === 'thread' && args.activeThreadId) {
    return { kind: 'thread', threadId: args.activeThreadId }
  }
  return { kind: 'globalDefaults' }
}

export function preferenceTargetKey(target: RuntimePreferenceWriteTarget): string {
  if (target.kind === 'newThreadDraft') return 'newThreadDraft'
  return target.kind === 'thread' ? `thread:${target.threadId}` : 'globalDefaults'
}
