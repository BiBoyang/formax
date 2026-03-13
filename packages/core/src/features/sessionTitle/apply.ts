import { SessionWriter } from '../repl/sessionSave/writer'

export type PersistSessionTitleArgs = {
  label: string
  filePath?: string
  writer?: Pick<SessionWriter, 'appendEvent'>
}

export async function persistSessionTitle(args: PersistSessionTitleArgs): Promise<void> {
  if (args.writer) {
    await args.writer.appendEvent('session_rename', { label: args.label, source: 'auto_title' })
    return
  }

  if (!args.filePath) {
    throw new Error('persistSessionTitle requires either writer or filePath')
  }

  const writer = await SessionWriter.openExisting({ filePath: args.filePath })
  try {
    await writer.appendEvent('session_rename', { label: args.label, source: 'auto_title' })
    await writer.flush()
  } finally {
    await writer.shutdown()
  }
}

