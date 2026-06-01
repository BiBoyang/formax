export const THINKING_EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type ThinkingEffort = (typeof THINKING_EFFORT_VALUES)[number]

export const DEFAULT_THINKING_EFFORT: ThinkingEffort = 'medium'

export function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return typeof value === 'string' && (THINKING_EFFORT_VALUES as readonly string[]).includes(value)
}
