import type { AppAction } from '../../store'
import type { PendingTurnOwner } from '../../types'

export type PendingTurnDraft = {
  requestId: string
  clientMessageId: string
  pendingTurnId: string
  messageId: string
  text: string
  createdAtMs: number
}

export function createPendingTurnDraft(args: {
  text: string
  requestId: string
  clientMessageId: string
  messageId: string
  createdAtMs: number
}): PendingTurnDraft {
  const pendingTurnId = `pending-turn:${args.clientMessageId}`
  return {
    requestId: args.requestId,
    clientMessageId: args.clientMessageId,
    pendingTurnId,
    messageId: args.messageId,
    text: args.text,
    createdAtMs: args.createdAtMs,
  }
}

export function startPendingTurnDraftAction(
  draft: PendingTurnDraft,
  args: { owner: PendingTurnOwner; activate?: boolean },
): AppAction {
  return {
    type: 'start_pending_turn',
    requestId: draft.requestId,
    clientMessageId: draft.clientMessageId,
    messageId: draft.messageId,
    text: draft.text,
    owner: args.owner,
    createdAtMs: draft.createdAtMs,
    activate: args.activate,
  }
}

export function materializePendingTurnDraftThreadAction(
  draft: PendingTurnDraft,
  threadId: string,
): AppAction {
  return {
    type: 'materialize_pending_turn_thread',
    requestId: draft.requestId,
    clientMessageId: draft.clientMessageId,
    threadId,
  }
}

export function commitPendingTurnDraftAction(
  draft: PendingTurnDraft,
  turnId: string,
  threadId?: string | null,
): AppAction {
  return {
    type: 'commit_pending_turn',
    requestId: draft.requestId,
    clientMessageId: draft.clientMessageId,
    turnId,
    threadId,
    activate: true,
  }
}

export function rollbackPendingTurnDraftAction(draft: PendingTurnDraft): AppAction {
  return {
    type: 'rollback_pending_turn',
    requestId: draft.requestId,
    clientMessageId: draft.clientMessageId,
  }
}
