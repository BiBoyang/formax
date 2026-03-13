export const DEFAULT_MAX_AUTO_TITLE_MESSAGE_COUNT = 12

export type SessionTitlePolicyInput = {
  hasLabel: boolean
  candidateUserText: string | null
  messageCount: number | null
  attemptedInProcess: boolean
  maxMessageCount?: number
}

export function shouldGenerateSessionTitle(args: SessionTitlePolicyInput): boolean {
  if (args.hasLabel) return false
  if (args.attemptedInProcess) return false
  if (!args.candidateUserText?.trim()) return false

  const maxMessageCount = args.maxMessageCount ?? DEFAULT_MAX_AUTO_TITLE_MESSAGE_COUNT
  if (args.messageCount != null && args.messageCount > maxMessageCount) return false

  return true
}

