import type { Dispatch, SetStateAction } from 'react'
import type { Msg } from '../../../../shared/toolMessageTypes'

export type LegacyTranscriptMutator = {
  canWrite: boolean
  update: (next: SetStateAction<Msg[]>) => void
}

export function createLegacyTranscriptMutator(args: {
  canWriteLegacyTranscript: boolean
  setMessages: Dispatch<SetStateAction<Msg[]>>
}): LegacyTranscriptMutator {
  return {
    canWrite: args.canWriteLegacyTranscript,
    update: (next) => {
      if (!args.canWriteLegacyTranscript) return
      args.setMessages(next)
    },
  }
}

