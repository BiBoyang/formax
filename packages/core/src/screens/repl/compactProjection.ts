import type { Msg } from '../../shared/toolMessageTypes'

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
  surfaceViewKind: 'ui_scrollback_full' | 'ui_scrollback_compact_slice'
}

export function projectCompactPrimaryTranscript(allMessages: Msg[]): CompactPrimaryProjection {
  const lastCompactBoundaryIndex = findLastCompactBoundaryIndex(allMessages)
  const primaryTranscriptStartIndex = lastCompactBoundaryIndex < 0 ? 0 : lastCompactBoundaryIndex + 1
  const surfaceViewKind = lastCompactBoundaryIndex < 0 ? 'ui_scrollback_full' : 'ui_scrollback_compact_slice'

  const base = allMessages.slice(primaryTranscriptStartIndex)
  if (hasCompactCommandMessage(base)) {
    return {
      lastCompactBoundaryIndex,
      primaryTranscriptStartIndex,
      primaryTranscriptMessages: base,
      surfaceViewKind,
    }
  }

  const compactCommandForPrimary = findLatestCompactCommandBeforeBoundary(allMessages, lastCompactBoundaryIndex)
  if (!compactCommandForPrimary) {
    return {
      lastCompactBoundaryIndex,
      primaryTranscriptStartIndex,
      primaryTranscriptMessages: base,
      surfaceViewKind,
    }
  }

  const compactBannerIndex = base.findIndex((message) => message.ui?.kind === 'compact_banner')
  if (compactBannerIndex < 0) {
    return {
      lastCompactBoundaryIndex,
      primaryTranscriptStartIndex,
      primaryTranscriptMessages: base,
      surfaceViewKind,
    }
  }

  const next = [...base]
  next.splice(compactBannerIndex + 1, 0, compactCommandForPrimary)
  return {
    lastCompactBoundaryIndex,
    primaryTranscriptStartIndex,
    primaryTranscriptMessages: next,
    surfaceViewKind,
  }
}

export const EXPANDED_TRANSCRIPT_RECENT_WINDOW_MESSAGE_COUNT = 20

export type ExpandedTranscriptProjection = {
  expandedTranscriptMessages: Msg[]
  expandedTranscriptHiddenCount: number
  surfaceViewKind: 'ui_scrollback_raw' | 'ui_scrollback_recent_window'
}

type ProjectExpandedTranscriptArgs = {
  allMessages: Msg[]
  expandedViewActive: boolean
  hideHistory: boolean
  recentWindowMessageCount?: number
}

export function projectExpandedTranscript({
  allMessages,
  expandedViewActive,
  hideHistory,
  recentWindowMessageCount = EXPANDED_TRANSCRIPT_RECENT_WINDOW_MESSAGE_COUNT,
}: ProjectExpandedTranscriptArgs): ExpandedTranscriptProjection {
  if (!expandedViewActive) {
    return {
      expandedTranscriptMessages: allMessages,
      expandedTranscriptHiddenCount: 0,
      surfaceViewKind: 'ui_scrollback_raw',
    }
  }

  const expandedTranscriptHiddenCount = Math.max(0, allMessages.length - recentWindowMessageCount)
  if (!hideHistory) {
    return {
      expandedTranscriptMessages: allMessages,
      expandedTranscriptHiddenCount,
      surfaceViewKind: 'ui_scrollback_raw',
    }
  }

  return {
    expandedTranscriptMessages: allMessages.slice(-recentWindowMessageCount),
    expandedTranscriptHiddenCount,
    surfaceViewKind: 'ui_scrollback_recent_window',
  }
}
