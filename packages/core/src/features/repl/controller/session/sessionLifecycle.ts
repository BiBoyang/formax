import type { MutableRefObject } from 'react'
import type { ChatHistory } from '../../../../chat/engine'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { SessionWriter } from '../../sessionSave/writer'

export type SessionWriterRefs = {
  sessionWriterRef: MutableRefObject<SessionWriter | null>
  sessionWriterInitPromiseRef: MutableRefObject<Promise<void> | null>
  lastPersistedSigByMsgIdRef: MutableRefObject<Map<string, string>>
  lastPersistedMsgByIdRef: MutableRefObject<Map<string, Msg>>
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

export function buildPersistedMsgRefMap(messages: Msg[]): Map<string, Msg> {
  const map = new Map<string, Msg>()
  for (const msg of messages) {
    if (!shouldPersistUiMsg(msg)) continue
    map.set(msg.id, msg)
  }
  return map
}

export function persistStableMessagesFromSnapshot(args: {
  writer: Pick<SessionWriter, 'appendStableMsg'> | null
  messages: Msg[]
  lastPersistedSigByMsgIdRef: MutableRefObject<Map<string, string>>
  lastPersistedMsgByIdRef: MutableRefObject<Map<string, Msg>>
}): void {
  const writer = args.writer
  if (!writer) return

  const liveStableIds = new Set<string>()
  for (const msg of args.messages) {
    if (!shouldPersistUiMsg(msg)) continue
    liveStableIds.add(msg.id)

    const prevMsgRef = args.lastPersistedMsgByIdRef.current.get(msg.id)
    if (prevMsgRef === msg) continue

    const sig = JSON.stringify(msg)
    args.lastPersistedMsgByIdRef.current.set(msg.id, msg)
    const prevSig = args.lastPersistedSigByMsgIdRef.current.get(msg.id)
    if (prevSig === sig) continue

    args.lastPersistedSigByMsgIdRef.current.set(msg.id, sig)
    void writer.appendStableMsg(msg)
  }

  for (const id of args.lastPersistedSigByMsgIdRef.current.keys()) {
    if (liveStableIds.has(id)) continue
    args.lastPersistedSigByMsgIdRef.current.delete(id)
    args.lastPersistedMsgByIdRef.current.delete(id)
  }
}

export function persistDirtyStableMessages(args: {
  writer: Pick<SessionWriter, 'appendStableMsg'> | null
  dirtyMessageIdsRef: MutableRefObject<Set<string>>
  messageByIdRef: MutableRefObject<Map<string, Msg>>
  lastPersistedSigByMsgIdRef: MutableRefObject<Map<string, string>>
  lastPersistedMsgByIdRef: MutableRefObject<Map<string, Msg>>
}): void {
  const writer = args.writer
  if (!writer) return
  if (args.dirtyMessageIdsRef.current.size === 0) return

  const dirtyIds = Array.from(args.dirtyMessageIdsRef.current)
  args.dirtyMessageIdsRef.current.clear()

  for (const id of dirtyIds) {
    const msg = args.messageByIdRef.current.get(id)
    if (!msg || !shouldPersistUiMsg(msg)) {
      args.lastPersistedSigByMsgIdRef.current.delete(id)
      args.lastPersistedMsgByIdRef.current.delete(id)
      continue
    }

    const prevMsgRef = args.lastPersistedMsgByIdRef.current.get(id)
    if (prevMsgRef === msg) continue

    const sig = JSON.stringify(msg)
    args.lastPersistedMsgByIdRef.current.set(id, msg)
    const prevSig = args.lastPersistedSigByMsgIdRef.current.get(id)
    if (prevSig === sig) continue

    args.lastPersistedSigByMsgIdRef.current.set(id, sig)
    void writer.appendStableMsg(msg)
  }
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
  args.refs.lastPersistedMsgByIdRef.current = new Map()
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
  args.refs.lastPersistedMsgByIdRef.current = buildPersistedMsgRefMap(args.initialSession?.messages ?? [])
  await writer.appendEvent('resume')
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
