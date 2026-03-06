import { getClaudeMdInjectionMeta } from '../../injectedBlocks'
import { getLocalCommandInjectionStats } from './localCommandInjection'
import type { LocalCommandRecord } from '../../../commands/registry'
import type { SessionWriter } from '../../sessionSave/writer'

type SessionEventWriter = Pick<SessionWriter, 'appendEvent'> | null

export function recordCompactRequestedEvent(args: {
  sessionSaveEnabled: boolean
  writer: SessionEventWriter
}): void {
  if (!args.sessionSaveEnabled) return
  void args.writer?.appendEvent('compact_requested')
}

export function recordLocalCommandInjectionEvent(args: {
  sessionSaveEnabled: boolean
  writer: SessionEventWriter
  source: 'slash_local' | 'slash_local_async'
  record: LocalCommandRecord
}): void {
  if (!args.sessionSaveEnabled) return
  const stats = getLocalCommandInjectionStats(args.record)
  void args.writer?.appendEvent('local_command_injection', {
    source: args.source,
    commandName: args.record.commandName,
    ...stats,
  })
}

export function recordClaudeMdInjectionEvent(args: {
  sessionSaveEnabled: boolean
  cwd: string
  env: NodeJS.ProcessEnv
  lastSigRef: { current: string | null }
  writer: SessionEventWriter
}): void {
  if (!args.sessionSaveEnabled) return

  const meta = getClaudeMdInjectionMeta({ cwd: args.cwd, env: args.env })
  if (!meta.global && !meta.project) return

  const sig = JSON.stringify(meta)
  if (args.lastSigRef.current === sig) return

  args.lastSigRef.current = sig
  void args.writer?.appendEvent('claude_md_injection', meta)
}
