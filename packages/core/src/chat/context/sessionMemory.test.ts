import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PromptMessage } from '../../prompts'
import { buildAutoMemoryDirectoryPath } from '../../shared/utils/autoMemoryPath'
import { buildCompactBoundaryMessage, buildCompactionSummaryUserText } from './compact'
import {
  buildSessionMemoryCompactionRehydration,
  buildSessionMemoryCompactionSummary,
  buildSessionMemoryDraft,
  buildSessionMemoryRestoreReminderBlock,
  estimateSessionMemoryCompactionRehydrationCost,
  extractSessionMemoryRestoreState,
  mergeSessionMemoryDraft,
  type SessionMemoryDraft,
} from './sessionMemory'

function txt(role: PromptMessage['role'], text: string): PromptMessage {
  return { role, content: [{ type: 'text', text }] as any }
}

function readUse(id: string, filePath: string): PromptMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: filePath } }] as any,
  }
}

function readResult(id: string): PromptMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: 'file contents' }] as any,
  }
}

describe('buildSessionMemoryDraft', () => {
  it('builds a session-scoped draft from recent files, user prompts, rehydration, and compact boundary state', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-session-memory-'))
    const planPath = path.join(cwd, '.formax', 'plan.md')
    await fs.mkdir(path.dirname(planPath), { recursive: true })
    await fs.writeFile(planPath, 'Investigate auth flow\nPatch compact summary\nVerify diagnostics\nExtra line', 'utf8')

    const history: PromptMessage[] = [
      txt('user', 'first prompt should fall off'),
      readUse('read-1', '/repo/src/auth.ts'),
      readResult('read-1'),
      txt('assistant', 'assistant note'),
      txt('user', 'rename the button copy'),
      {
        role: 'user',
        content: [{ type: 'text', text: buildCompactionSummaryUserText('Older summary') }] as any,
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '<system-reminder>keep the modal padding unchanged</system-reminder>' }] as any,
      },
      readUse('read-2', '/repo/src/session.ts'),
      readResult('read-2'),
      txt('user', 'adjust the CTA tone'),
      buildCompactBoundaryMessage({
        trigger: 'auto',
        preTokens: 4321,
        summaryKind: 'model_summary',
        keepStrategy: {
          kind: 'keep_combo',
          keepLastTurns: 2,
          keepMinTokens: 1200,
          keepMinUserTurns: 1,
        },
        rehydrationPlan: {
          schemaVersion: 1,
          items: [
            { kind: 'recent_files', priority: 'high', status: 'planned' },
            { kind: 'plan_state', priority: 'high', status: 'planned' },
          ],
        },
      }),
    ]

    const autoMemoryConfigDir = '/tmp/formax-config'
    const out = buildSessionMemoryDraft({
      cwd,
      mode: 'plan',
      planPath,
      previousHistory: history,
      autoMemoryConfigDir,
      resolveRealPath: (value) => value,
    })
    const expectedProjectMemoryPath = path.join(
      buildAutoMemoryDirectoryPath({
        cwd,
        configDir: autoMemoryConfigDir,
        resolveRealPath: (value) => value,
      }),
      'MEMORY.md',
    )

    expect(out).toEqual({
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot: path.resolve(cwd),
        projectMemoryPath: expectedProjectMemoryPath,
      },
      activeTask: {
        mode: 'plan',
        recentFiles: ['/repo/src/session.ts', '/repo/src/auth.ts'],
        recentUserPrompts: ['adjust the CTA tone', 'keep the modal padding unchanged', 'rename the button copy'],
        planPath,
        planExcerpt: 'Investigate auth flow | Patch compact summary | Verify diagnostics',
        todoSummary: null,
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
          items: [
            { kind: 'recent_files', priority: 'high', status: 'planned' },
            { kind: 'plan_state', priority: 'high', status: 'planned' },
          ],
        },
      },
    })
  })

  it('falls back cleanly when no boundary or rehydration state is present', () => {
    const out = buildSessionMemoryDraft({
      cwd: '/repo',
      mode: 'normal',
      planPath: null,
      previousHistory: [txt('user', 'plain prompt')],
      autoMemoryConfigDir: '/cfg',
      resolveRealPath: (value) => value,
    })

    expect(out.currentStrategy).toEqual({
      lastCompactTrigger: null,
      summaryKind: null,
      keepStrategy: null,
      rehydrationPlan: null,
    })
    expect(out.activeTask).toEqual({
      mode: 'normal',
      recentFiles: [],
      recentUserPrompts: ['plain prompt'],
      planPath: null,
      planExcerpt: null,
      todoSummary: null,
    })
  })

  it('uses the same canonical workspace identity as auto-memory path resolution', () => {
    const out = buildSessionMemoryDraft({
      cwd: '/repo-link',
      mode: 'normal',
      planPath: null,
      previousHistory: [txt('user', 'plain prompt')],
      autoMemoryConfigDir: '/cfg',
      resolveRealPath: () => '/real/repo',
    })

    expect(out.durableFacts).toEqual({
      workspaceRoot: '/real/repo',
      projectMemoryPath: path.join(
        buildAutoMemoryDirectoryPath({
          cwd: '/repo-link',
          configDir: '/cfg',
          resolveRealPath: () => '/real/repo',
        }),
        'MEMORY.md',
      ),
    })
  })
})

describe('mergeSessionMemoryDraft', () => {
  it('dedupes recency lists, preserves fallback values, and allows nullable fields to clear', () => {
    const base: SessionMemoryDraft = {
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot: '/repo',
        projectMemoryPath: '/repo/.formax/memory/MEMORY.md',
      },
      activeTask: {
        mode: 'plan',
        recentFiles: ['/repo/src/session.ts', '/repo/src/auth.ts'],
        recentUserPrompts: ['adjust CTA', 'rename button'],
        planPath: '/repo/.formax/plan.md',
        planExcerpt: 'Existing plan excerpt',
        todoSummary: 'Existing todo summary',
      },
      currentStrategy: {
        lastCompactTrigger: 'manual',
        summaryKind: 'model_summary',
        keepStrategy: { kind: 'keep_last_turns', keepLastTurns: 2 },
        rehydrationPlan: {
          schemaVersion: 1,
          items: [{ kind: 'recent_files', priority: 'high', status: 'planned' }],
        },
      },
    }

    const merged = mergeSessionMemoryDraft(base, {
      durableFacts: {
        workspaceRoot: '   ',
        projectMemoryPath: '/repo/.formax/memory/MEMORY-v2.md',
      },
      activeTask: {
        mode: 'acceptEdits',
        recentFiles: ['/repo/src/auth.ts', '/repo/src/ui.tsx'],
        recentUserPrompts: ['rename button', 'adjust CTA'],
        planPath: null,
        planExcerpt: '  ',
        todoSummary: null,
      },
      currentStrategy: {
        lastCompactTrigger: 'auto',
        keepStrategy: {
          kind: 'keep_combo',
          keepLastTurns: 3,
          keepMinTokens: 1200,
          keepMinUserTurns: 1,
        },
      },
    })

    expect(merged).toEqual({
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot: '/repo',
        projectMemoryPath: '/repo/.formax/memory/MEMORY-v2.md',
      },
      activeTask: {
        mode: 'acceptEdits',
        recentFiles: ['/repo/src/auth.ts', '/repo/src/ui.tsx', '/repo/src/session.ts'],
        recentUserPrompts: ['rename button', 'adjust CTA'],
        planPath: null,
        planExcerpt: 'Existing plan excerpt',
        todoSummary: null,
      },
      currentStrategy: {
        lastCompactTrigger: 'auto',
        summaryKind: 'model_summary',
        keepStrategy: {
          kind: 'keep_combo',
          keepLastTurns: 3,
          keepMinTokens: 1200,
          keepMinUserTurns: 1,
        },
        rehydrationPlan: {
          schemaVersion: 1,
          items: [{ kind: 'recent_files', priority: 'high', status: 'planned' }],
        },
      },
    })
  })

  it('allows explicitly clearing stale compact strategy state', () => {
    const base: SessionMemoryDraft = {
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot: '/repo',
        projectMemoryPath: '/repo/.formax/memory/MEMORY.md',
      },
      activeTask: {
        mode: 'normal',
        recentFiles: [],
        recentUserPrompts: [],
        planPath: null,
        planExcerpt: null,
        todoSummary: null,
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

    const merged = mergeSessionMemoryDraft(base, {
      currentStrategy: {
        lastCompactTrigger: null,
        summaryKind: null,
        keepStrategy: null,
        rehydrationPlan: null,
      },
    })

    expect(merged.currentStrategy).toEqual({
      lastCompactTrigger: null,
      summaryKind: null,
      keepStrategy: null,
      rehydrationPlan: null,
    })
  })
})

describe('extractSessionMemoryRestoreState', () => {
  it('reads mode and planPath from a valid session memory draft shape', () => {
    expect(
      extractSessionMemoryRestoreState({
        activeTask: {
          mode: 'plan',
          planPath: ' /repo/.formax/plan.md ',
        },
      }),
    ).toEqual({
      mode: 'plan',
      planPath: '/repo/.formax/plan.md',
    })
  })

  it('rejects invalid mode shapes', () => {
    expect(
      extractSessionMemoryRestoreState({
        activeTask: {
          mode: 'weird',
          planPath: '/repo/.formax/plan.md',
        },
      }),
    ).toBeNull()
  })
})

describe('buildSessionMemoryCompactionSummary', () => {
  it('renders a concise summary from rolling session memory fields', () => {
    const summary = buildSessionMemoryCompactionSummary({
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot: '/repo',
        projectMemoryPath: '/repo/.formax/memory/MEMORY.md',
      },
      activeTask: {
        mode: 'plan',
        recentFiles: ['/repo/src/session.ts', '/repo/src/auth.ts'],
        recentUserPrompts: ['tighten CTA copy', 'preserve modal spacing'],
        planPath: '/repo/.formax/plan.md',
        planExcerpt: 'Ship memory-first compact',
        todoSummary: '1. add fallback 2. verify tests',
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
    })

    expect(summary).toContain('Session memory recap:')
    expect(summary).toContain('Recent user requests:')
    expect(summary).toContain('- tighten CTA copy')
    expect(summary).toContain('Working-set files:')
    expect(summary).toContain('Current mode: plan')
    expect(summary).toContain('Recent compact strategy:')
    expect(summary).toContain('Workspace root: /repo')
  })

  it('caps long recap fields so memory-first compact stays size-reducing', () => {
    const veryLongPrompt = `Refine the onboarding copy ${'and keep the tone calm '.repeat(20)}`
    const summary = buildSessionMemoryCompactionSummary({
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot: '/repo',
        projectMemoryPath: '/repo/.formax/memory/MEMORY.md',
      },
      activeTask: {
        mode: 'normal',
        recentFiles: ['/repo/src/session.ts'],
        recentUserPrompts: [veryLongPrompt, 'prompt 2', 'prompt 3', 'prompt 4 should be dropped'],
        planPath: null,
        planExcerpt: 'x'.repeat(400),
        todoSummary: 'y'.repeat(400),
      },
      currentStrategy: {
        lastCompactTrigger: null,
        summaryKind: null,
        keepStrategy: null,
        rehydrationPlan: null,
      },
    })

    expect(summary).toContain('Recent user requests:')
    expect(summary).not.toContain(veryLongPrompt)
    expect(summary).toContain('prompt 2')
    expect(summary).toContain('prompt 3')
    expect(summary).not.toContain('prompt 4 should be dropped')
    expect(summary.length).toBeLessThan(900)
    expect(summary).toContain('…')
  })
})

describe('buildSessionMemoryRestoreReminderBlock', () => {
  it('wraps session memory as a one-turn system reminder block', () => {
    const block = buildSessionMemoryRestoreReminderBlock({
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot: '/repo',
        projectMemoryPath: '/repo/.formax/memory/MEMORY.md',
      },
      activeTask: {
        mode: 'plan',
        recentFiles: ['/repo/src/main.ts'],
        recentUserPrompts: ['Finish the compact restore path'],
        planPath: '/repo/.formax/plan.md',
        planExcerpt: 'Wire restore reminder into next turn only',
        todoSummary: null,
      },
      currentStrategy: {
        lastCompactTrigger: 'auto',
        summaryKind: 'session_memory',
        keepStrategy: null,
        rehydrationPlan: null,
      },
    })

    expect(block).toMatchObject({
      type: 'text',
      cache_control: { type: 'ephemeral' },
    })
    expect(String((block as any)?.text ?? '')).toContain('<system-reminder>')
    expect(String((block as any)?.text ?? '')).toContain('Restored session memory for the next turn only:')
    expect(String((block as any)?.text ?? '')).toContain('Current mode: plan')
  })

  it('sanitizes embedded system-reminder delimiters inside restore reminder content', () => {
    const block = buildSessionMemoryRestoreReminderBlock({
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot: '/repo',
        projectMemoryPath: '/repo/.formax/memory/MEMORY.md',
      },
      activeTask: {
        mode: 'normal',
        recentFiles: ['/repo/<system-reminder>auth.ts'],
        recentUserPrompts: ['Investigate </system-reminder> redirect loop'],
        planPath: null,
        planExcerpt: null,
        todoSummary: null,
      },
      currentStrategy: {
        lastCompactTrigger: null,
        summaryKind: null,
        keepStrategy: null,
        rehydrationPlan: null,
      },
    })

    const text = String((block as any)?.text ?? '')
    expect(text).not.toContain('</system-reminder> redirect loop')
    expect(text).not.toContain('/repo/<system-reminder>auth.ts')
    expect(text).toContain('[system-reminder] redirect loop')
    expect(text).toContain('/repo/[system-reminder]auth.ts')
  })
})

describe('buildSessionMemoryCompactionRehydration', () => {
  it('prefers session memory task state while falling back to existing rehydration fields', () => {
    const draft: SessionMemoryDraft = {
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot: '/repo',
        projectMemoryPath: '/repo/.formax/memory/MEMORY.md',
      },
      activeTask: {
        mode: 'acceptEdits',
        recentFiles: ['/repo/src/session.ts', '/repo/src/auth.ts'],
        recentUserPrompts: [],
        planPath: null,
        planExcerpt: 'Memory plan excerpt',
        todoSummary: null,
      },
      currentStrategy: {
        lastCompactTrigger: null,
        summaryKind: null,
        keepStrategy: null,
        rehydrationPlan: null,
      },
    }

    const rehydration = buildSessionMemoryCompactionRehydration({
      draft,
      fallback: {
        recentFiles: ['/repo/src/auth.ts', '/repo/src/ui.tsx'],
        modeText: null,
        planPath: '/repo/.formax/plan.md',
        planExcerpt: null,
        todoSummary: 'todo fallback',
      },
    })

    expect(rehydration).toEqual({
      recentFiles: ['/repo/src/session.ts', '/repo/src/auth.ts', '/repo/src/ui.tsx'],
      modeText: 'Current mode: acceptEdits',
      planPath: '/repo/.formax/plan.md',
      planExcerpt: 'Memory plan excerpt',
      todoSummary: 'todo fallback',
    })
    expect(estimateSessionMemoryCompactionRehydrationCost({ draft })).toEqual(
      expect.objectContaining({
        sectionCount: expect.any(Number),
        estimatedTokens: expect.any(Number),
      }),
    )
  })
})
