import { useCallback } from 'react'
import type { PromptBlock } from '../../../../prompts'
import type { ConfigDialogExit } from '../../../../shared/replDialogContracts.js'
import type { SessionWriter } from '../../sessionSave/writer'
import { applyConfigExitInjection } from './localCommandInjection'

function useConfigDialogInjection(args: {
  closeConfigDialog: (exit: ConfigDialogExit) => void
  sessionSaveEnabled: boolean
  writerRef: { current: SessionWriter | null }
  pendingInjectedBlocksRef: { current: PromptBlock[] }
}): {
  closeConfigDialogWithInjection: (exit: ConfigDialogExit) => void
} {
  const closeConfigDialogWithInjection = useCallback(
    (exit: ConfigDialogExit) => {
      args.closeConfigDialog(exit)
      applyConfigExitInjection({
        exit,
        sessionSaveEnabled: args.sessionSaveEnabled,
        writer: args.writerRef.current,
        pendingInjectedBlocksRef: args.pendingInjectedBlocksRef,
      })
    },
    [args.closeConfigDialog, args.pendingInjectedBlocksRef, args.sessionSaveEnabled, args.writerRef],
  )

  return { closeConfigDialogWithInjection }
}

export {
  useConfigDialogInjection,
}
