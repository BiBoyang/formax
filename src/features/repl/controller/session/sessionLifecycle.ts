import type { MutableRefObject } from 'react'
import type { ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../components/tool/ToolMessage'
import { SessionWriter } from '../../sessionSave/writer'

export type SessionWriterRefs = {
  sessionWriterRef: MutableRefObject<SessionWriter | null>
  sessionWriterInitPromiseRef: MutableRefObject<Promise<void> | null>
  lastPersistedSigByMsgIdRef: MutableRefObject<Map<string, string>>
}

export function shouldPersistUiMsg(msg: Msg): boolean {
  if (msg.isStreaming) return false
  if (msg.role === 'tool' && msg.toolInfo?.status === 'running') return false
  return true
}

export function buildPersistedSigMap(messages: Msg[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const msg of messages) {
    if (!shouldPersistUiMsg(msg)) continue
    map.set(msg.id, JSON.stringify(msg))
  }
  return map
}

export async function startNewSessionWriter(args: {
  sessionSaveEnabled: boolean
  cwd: string
  env: NodeJS.ProcessEnv
  model: string
  historyRef: MutableRefObject<ChatHistory>
  refs: SessionWriterRefs
}): Promise<void> {
  if (!args.sessionSaveEnabled) return
  const { writer } = await SessionWriter.createNew({
    cwd: args.cwd,
    env: args.env,
    model: args.model,
  })
  args.refs.sessionWriterRef.current = writer
  args.refs.lastPersistedSigByMsgIdRef.current = new Map()
  await writer.appendHistorySnapshot(args.historyRef.current)
}

export async function openInitialSessionWriter(args: {
  sessionSaveEnabled: boolean
  initialSession?: { filePath?: string; messages?: Msg[] }
  historyRef: MutableRefObject<ChatHistory>
  refs: SessionWriterRefs
  startNewWriter: () => Promise<void>
}): Promise<void> {
  if (!args.sessionSaveEnabled) return
  if (args.refs.sessionWriterRef.current) return
  const filePath = args.initialSession?.filePath
  if (!filePath) {
    await args.startNewWriter()
    return
  }

  const writer = await SessionWriter.openExisting({ filePath })
  args.refs.sessionWriterRef.current = writer
  args.refs.lastPersistedSigByMsgIdRef.current = buildPersistedSigMap(args.initialSession?.messages ?? [])
  await writer.appendEvent('resume')
  await writer.appendHistorySnapshot(args.historyRef.current)
}

export async function shutdownSessionWriter(refs: SessionWriterRefs): Promise<void> {
  const writer = refs.sessionWriterRef.current
  refs.sessionWriterRef.current = null
  if (!writer) return
  await writer.shutdown()
}

export async function ensureSessionWriter(args: {
  sessionSaveEnabled: boolean
  refs: SessionWriterRefs
  openInitialWriter: () => Promise<void>
}): Promise<void> {
  if (!args.sessionSaveEnabled) return
  if (args.refs.sessionWriterRef.current) return
  const inflight = args.refs.sessionWriterInitPromiseRef.current
  if (inflight) {
    await inflight
    return
  }
  const promise = args.openInitialWriter().finally(() => {
    if (args.refs.sessionWriterInitPromiseRef.current === promise) {
      args.refs.sessionWriterInitPromiseRef.current = null
    }
  })
  args.refs.sessionWriterInitPromiseRef.current = promise
  await promise
}
