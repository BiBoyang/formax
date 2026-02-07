import type { Msg } from '../../components/tool/ToolMessage'

export function isCompactSlashCommandText(text: string): boolean {
  return /^\/compact(?:\s|$)/i.test(text.trim())
}

function findLastCompactBoundaryIndex(messages: Msg[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.ui?.kind === 'compact_boundary') return index
  }
  return -1
}

function findLatestCompactCommandBeforeBoundary(messages: Msg[], boundaryIndex: number): Msg | null {
  if (boundaryIndex <= 0) return null

  for (let index = boundaryIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index]
    if (!candidate || candidate.role !== 'user') continue
    if (typeof candidate.content !== 'string') continue
    if (isCompactSlashCommandText(candidate.content)) return candidate
  }

  return null
}

function hasCompactCommandMessage(messages: Msg[]): boolean {
  return messages.some(
    (message) =>
      message.role === 'user' &&
      typeof message.content === 'string' &&
      isCompactSlashCommandText(message.content),
  )
}

export type CompactPrimaryProjection = {
  lastCompactBoundaryIndex: number
  primaryTranscriptStartIndex: number
  primaryTranscriptMessages: Msg[]
}

export function projectCompactPrimaryTranscript(allMessages: Msg[]): CompactPrimaryProjection {
  const lastCompactBoundaryIndex = findLastCompactBoundaryIndex(allMessages)
  const primaryTranscriptStartIndex = lastCompactBoundaryIndex < 0 ? 0 : lastCompactBoundaryIndex + 1

  const base = allMessages.slice(primaryTranscriptStartIndex)
  if (hasCompactCommandMessage(base)) {
    return {
      lastCompactBoundaryIndex,
      primaryTranscriptStartIndex,
      primaryTranscriptMessages: base,
    }
  }

  const compactCommandForPrimary = findLatestCompactCommandBeforeBoundary(allMessages, lastCompactBoundaryIndex)
  if (!compactCommandForPrimary) {
    return {
      lastCompactBoundaryIndex,
      primaryTranscriptStartIndex,
      primaryTranscriptMessages: base,
    }
  }

  const compactBannerIndex = base.findIndex((message) => message.ui?.kind === 'compact_banner')
  if (compactBannerIndex < 0) {
    return {
      lastCompactBoundaryIndex,
      primaryTranscriptStartIndex,
      primaryTranscriptMessages: base,
    }
  }

  const next = [...base]
  next.splice(compactBannerIndex + 1, 0, compactCommandForPrimary)
  return {
    lastCompactBoundaryIndex,
    primaryTranscriptStartIndex,
    primaryTranscriptMessages: next,
  }
}
