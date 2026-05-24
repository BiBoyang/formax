export const DEFAULT_MAX_AUTO_TITLE_MESSAGE_COUNT = 12
export const DEFAULT_MAX_AUTO_TITLE_ATTEMPTS = 3

export type SessionTitlePolicyInput = {
  hasLabel: boolean
  titleSource?: 'manual' | 'auto_title' | 'legacy' | null
  candidateUserText: string | null
  messageCount: number | null
  failedAttemptCount?: number
  attemptedInProcess: boolean
  maxMessageCount?: number
  maxAttempts?: number
}

export function shouldGenerateSessionTitle(args: SessionTitlePolicyInput): boolean {
  if (args.hasLabel) return false
  if (args.titleSource === 'manual' || args.titleSource === 'legacy') return false
  if (args.attemptedInProcess) return false
  if (!args.candidateUserText?.trim()) return false

  const maxAttempts = args.maxAttempts ?? DEFAULT_MAX_AUTO_TITLE_ATTEMPTS
  if ((args.failedAttemptCount ?? 0) >= maxAttempts) return false

  const maxMessageCount = args.maxMessageCount ?? DEFAULT_MAX_AUTO_TITLE_MESSAGE_COUNT
  if (args.messageCount != null && args.messageCount > maxMessageCount) return false

  return true
}
