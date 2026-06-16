import type { AppAction } from '../../store'
import type { TranscriptItem } from '../../types'

type PendingTurnMessage = Extract<TranscriptItem, { kind: 'message' }> & {
  role: 'user'
  turnId: string
  clientMessageId: string
  optimistic: true
}

export type PendingTurnDraft = {
  clientMessageId: string
  pendingTurnId: string
  messageId: string
  message: PendingTurnMessage
}

export function createPendingTurnDraft(args: {
  text: string
  clientMessageId: string
  messageId: string
}): PendingTurnDraft {
  const pendingTurnId = `pending-turn:${args.clientMessageId}`
  const message: PendingTurnMessage = {
    kind: 'message',
    id: args.messageId,
    role: 'user',
    text: args.text,
    turnId: pendingTurnId,
    clientMessageId: args.clientMessageId,
    optimistic: true,
  }
  return {
    clientMessageId: args.clientMessageId,
    pendingTurnId,
    messageId: args.messageId,
    message,
  }
}

export function pushPendingTurnDraftActions(
  draft: PendingTurnDraft,
  options?: { activate?: boolean },
): AppAction[] {
  const actions: AppAction[] = [
    {
      type: 'push_message',
      id: draft.messageId,
      role: 'user',
      text: draft.message.text,
      turnId: draft.pendingTurnId,
      clientMessageId: draft.clientMessageId,
      optimistic: true,
    },
  ]
  if (options?.activate) {
    actions.push({ type: 'set_active_turn', turnId: draft.pendingTurnId })
  }
  return actions
}

export function commitPendingTurnDraftAction(
  draft: PendingTurnDraft,
  turnId: string,
): AppAction {
  return {
    type: 'bind_optimistic_user_message_turn',
    clientMessageId: draft.clientMessageId,
    turnId,
    activate: true,
  }
}

export function rollbackPendingTurnDraftActions(draft: PendingTurnDraft): AppAction[] {
  return [
    { type: 'remove_transcript_item', id: draft.messageId },
    { type: 'clear_active_turn_if_matches', turnId: draft.pendingTurnId },
  ]
}
