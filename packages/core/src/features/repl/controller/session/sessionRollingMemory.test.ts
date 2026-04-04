import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatHistory } from '../../../../chat/engine'
import { buildCompactBoundaryMessage } from '../../../../chat/context/compact'
import { readSessionMemoryFile } from '../../sessionSave/sessionMemorySidecar'
import { persistRollingSessionMemory } from './sessionRollingMemory'

describe('persistRollingSessionMemory', () => {
  it('writes the latest session memory draft beside the session file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-rolling-memory-'))
    const sessionFilePath = path.join(dir, 'session-1.jsonl')
    const planPath = path.join(dir, 'plan.md')
    await fs.writeFile(sessionFilePath, '', 'utf8')
    await fs.writeFile(planPath, 'Investigate auth flow\nPatch compact summary\nVerify diagnostics\n', 'utf8')

    const history: ChatHistory = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/src/auth.ts' } }] as any,
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'file contents' }] as any,
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'fix auth redirect' }] as any,
      },
      buildCompactBoundaryMessage({
        trigger: 'auto',
        preTokens: 3210,
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
      }),
    ]

    await persistRollingSessionMemory({
      sessionFilePath,
      cwd: dir,
      mode: 'plan',
      planPath,
      history,
    })

    const restored = await readSessionMemoryFile(sessionFilePath)
    const workspaceRoot = await fs.realpath(dir).catch(() => dir)
    expect(restored).toMatchObject({
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot,
      },
      activeTask: {
        mode: 'plan',
        recentFiles: ['/repo/src/auth.ts'],
        recentUserPrompts: ['fix auth redirect'],
        planPath,
      },
      currentStrategy: {
        lastCompactTrigger: 'auto',
        summaryKind: 'model_summary',
      },
    })
  })

  it('serializes concurrent refreshes so the newest draft wins', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-rolling-memory-queue-'))
    const sessionFilePath = path.join(dir, 'session-2.jsonl')
    await fs.writeFile(sessionFilePath, '', 'utf8')

    const firstHistory: ChatHistory = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'first prompt' }] as any,
      },
    ]
    const secondHistory: ChatHistory = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'second prompt' }] as any,
      },
    ]

    await Promise.all([
      persistRollingSessionMemory({
        sessionFilePath,
        cwd: dir,
        mode: 'normal',
        planPath: null,
        history: firstHistory,
      }),
      persistRollingSessionMemory({
        sessionFilePath,
        cwd: dir,
        mode: 'acceptEdits',
        planPath: null,
        history: secondHistory,
      }),
    ])

    const restored = await readSessionMemoryFile(sessionFilePath)
    expect(restored?.activeTask.mode).toBe('acceptEdits')
    expect(restored?.activeTask.recentUserPrompts).toEqual(['second prompt'])
  })
})
