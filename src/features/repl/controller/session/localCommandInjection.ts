import type { PromptBlock } from '../../../../prompts'
import type { ConfigDialogExit } from '../../../../ui/config/ConfigDialog.js'
import type { SessionWriter } from '../../sessionSave/writer'
import type { LocalCommandRecord } from '../../../commands/registry'
import { buildLocalCommandInjectedBlocks } from '../../injectedBlocks'

function blockTextLength(block: PromptBlock): number {
  const text = (block as { text?: unknown }).text
  return typeof text === 'string' ? text.length : 0
}

export function getLocalCommandInjectionStats(rec: LocalCommandRecord): {
  stdoutChars: number
  stdoutBytes: number
  injectedChars: number
  injectedBlocks: number
} {
  const blocks = buildLocalCommandInjectedBlocks(rec)
  const injectedChars = blocks.reduce((sum, block) => sum + blockTextLength(block), 0)
  return {
    stdoutChars: rec.stdout.length,
    stdoutBytes: Buffer.byteLength(rec.stdout, 'utf8'),
    injectedChars,
    injectedBlocks: blocks.length,
  }
}

export function applyConfigExitInjection(args: {
  exit: ConfigDialogExit
  sessionSaveEnabled: boolean
  writer: Pick<SessionWriter, 'appendEvent'> | null
  pendingInjectedBlocksRef: { current: PromptBlock[] }
}): void {
  const { exit } = args
  if (args.sessionSaveEnabled) {
    const payload = exit.kind === 'dismissed' ? { kind: exit.kind } : { kind: exit.kind, message: exit.message }
    void args.writer?.appendEvent('config_exit', {
      ...payload,
    })
  }

  if (exit.kind !== 'changed' || !exit.message.startsWith('Set output style to ')) return

  const rec: LocalCommandRecord = {
    commandName: '/config',
    commandMessage: 'config',
    commandArgs: '',
    stdout: exit.message,
  }
  const stats = getLocalCommandInjectionStats(rec)
  const styleLabel = exit.message.replace(/^Set output style to\s+/, '').trim()
  const styleId = styleLabel.toLowerCase()

  if (args.sessionSaveEnabled) {
    void args.writer?.appendEvent('output_style_changed', {
      style: styleId,
      label: styleLabel,
      ...stats,
    })
    void args.writer?.appendEvent('local_command_injection', {
      source: 'config_output_style',
      commandName: rec.commandName,
      ...stats,
    })
  }

  args.pendingInjectedBlocksRef.current.push(...buildLocalCommandInjectedBlocks(rec))
}
