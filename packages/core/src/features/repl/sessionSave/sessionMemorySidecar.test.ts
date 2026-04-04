import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SessionMemoryDraft } from '../../../chat/context/sessionMemory'
import {
  getSessionMemoryFilePath,
  readSessionMemoryFile,
  writeSessionMemoryFile,
} from './sessionMemorySidecar'

function createDraft(): SessionMemoryDraft {
  return {
    schemaVersion: 1,
    durableFacts: {
      workspaceRoot: '/repo',
      projectMemoryPath: '/repo/.formax/memory/MEMORY.md',
    },
    activeTask: {
      mode: 'plan',
      recentFiles: ['/repo/src/auth.ts'],
      recentUserPrompts: ['fix auth redirect'],
      planPath: '/repo/.formax/plan.md',
      planExcerpt: 'Investigate auth flow',
      todoSummary: 'todo summary',
    },
    currentStrategy: {
      lastCompactTrigger: 'auto',
      summaryKind: 'model_summary',
      keepStrategy: {
        kind: 'keep_combo',
        keepLastTurns: 2,
        keepMinTokens: 1200,
        keepMinUserTurns: 1,
      },
      rehydrationPlan: {
        schemaVersion: 1,
        items: [{ kind: 'recent_files', priority: 'high', status: 'planned' }],
      },
    },
  }
}

describe('sessionMemorySidecar', () => {
  it('derives a stable sibling sidecar path from the session jsonl path', () => {
    expect(getSessionMemoryFilePath('/tmp/session.jsonl')).toBe('/tmp/session.memory.json')
    expect(getSessionMemoryFilePath('/tmp/session-file')).toBe('/tmp/session-file.memory.json')
  })

  it('writes and reads rolling session memory sidecar payloads', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-session-memory-sidecar-'))
    const sessionFilePath = path.join(dir, 'session-1.jsonl')
    await fs.writeFile(sessionFilePath, '', 'utf8')

    await writeSessionMemoryFile({
      sessionFilePath,
      draft: createDraft(),
    })

    const restored = await readSessionMemoryFile(sessionFilePath)
    expect(restored).toEqual(createDraft())
  })

  it('returns null when the sidecar does not exist', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-session-memory-sidecar-miss-'))
    expect(await readSessionMemoryFile(path.join(dir, 'missing.jsonl'))).toBeNull()
  })
})
