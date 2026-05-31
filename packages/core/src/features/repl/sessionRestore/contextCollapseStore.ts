import {
  findLatestCompactBoundaryIndex,
  fingerprintCompactBoundaryMessage,
} from '../../../chat/context/compact'
import {
  buildContextCollapseStoreSnapshot,
  createContextCollapseCommittedEntry,
  setContextCollapseStoreActiveCompactBoundaryFingerprint,
  type ContextCollapseCommittedEntry,
  type ContextCollapseStoreSnapshot,
} from '../../../chat/context/contextCollapseStore'
import type { ContextCollapseMeta } from '../../../chat/context/contextCollapse'
import type { PromptMessage } from '../../../prompts'
import {
  readContextCollapseSessionRecordsFromSession,
  readContextCollapseSessionRecordsFromSessionSync,
  type ContextCollapseCommittedEventDto,
  type ContextCollapseSessionRecordDto,
} from '../sessionSave/contextCollapseStoreEvents'

function readActiveCompactBoundaryFingerprint(record: ContextCollapseSessionRecordDto): string | null | undefined {
  if (record.type !== 'history_state') return undefined
  const messages = record.messages as PromptMessage[]
  const boundaryIndex = findLatestCompactBoundaryIndex(messages)
  if (boundaryIndex < 0) return undefined
  return fingerprintCompactBoundaryMessage(messages[boundaryIndex]!)
}

function toContextCollapseCommittedEntry(dto: ContextCollapseCommittedEventDto): ContextCollapseCommittedEntry {
  return createContextCollapseCommittedEntry({
    id: dto.id,
    createdAtMs: dto.createdAtMs,
    source: 'request_collapse',
    collapsedRange: dto.collapsedRange,
    compactBoundaryFingerprint: dto.compactBoundaryFingerprint,
    recapMessage: dto.recapMessage as PromptMessage,
    metadata: dto.metadata as ContextCollapseMeta,
  })
}

export function buildContextCollapseStoreSnapshotFromSessionRecords(
  records: ContextCollapseSessionRecordDto[],
): ContextCollapseStoreSnapshot {
  let snapshot = buildContextCollapseStoreSnapshot({ entries: [] })

  for (const record of records) {
    const nextActiveCompactBoundaryFingerprint = readActiveCompactBoundaryFingerprint(record)
    if (nextActiveCompactBoundaryFingerprint !== undefined) {
      snapshot = setContextCollapseStoreActiveCompactBoundaryFingerprint({
        snapshot,
        activeCompactBoundaryFingerprint: nextActiveCompactBoundaryFingerprint,
      })
    }
    if (record.type !== 'context_collapse_committed') continue
    snapshot = buildContextCollapseStoreSnapshot({
      entries: [...snapshot.entries, toContextCollapseCommittedEntry(record)],
      activeCompactBoundaryFingerprint: snapshot.activeCompactBoundaryFingerprint,
    })
  }

  return snapshot
}

export async function readContextCollapseStoreSnapshotFromSession(args: {
  filePath: string
}): Promise<ContextCollapseStoreSnapshot> {
  const records = await readContextCollapseSessionRecordsFromSession({ filePath: args.filePath })
  return buildContextCollapseStoreSnapshotFromSessionRecords(records)
}

export function readContextCollapseStoreSnapshotFromSessionSync(args: {
  filePath: string
}): ContextCollapseStoreSnapshot {
  return buildContextCollapseStoreSnapshotFromSessionRecords(
    readContextCollapseSessionRecordsFromSessionSync({ filePath: args.filePath }),
  )
}
