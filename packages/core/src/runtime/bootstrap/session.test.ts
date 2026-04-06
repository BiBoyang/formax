import { beforeEach, describe, expect, it, vi } from 'vitest'

const findLatestSessionFile = vi.fn()
const readSessionFile = vi.fn()
const readSessionMemoryFile = vi.fn()

vi.mock('../../features/repl/sessionSave/index.js', () => ({
  findLatestSessionFile,
  readSessionFile,
}))

vi.mock('../../features/repl/sessionSave/sessionMemorySidecar.js', () => ({
  readSessionMemoryFile: (sessionFilePath: string) => readSessionMemoryFile(sessionFilePath),
  writeSessionMemoryFile: vi.fn(),
}))

describe('resolveInitialSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readSessionMemoryFile.mockResolvedValue(null)
  })

  it('returns continuation history after the latest compact boundary', async () => {
    findLatestSessionFile.mockResolvedValue('/tmp/latest-session.jsonl')
    readSessionFile.mockResolvedValue({
      messages: [{ id: 'ui-1', role: 'assistant', content: 'hello', timestamp: new Date() }],
      history: [
        { role: 'user', content: [{ type: 'text', text: 'old user before boundary' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          meta: {
            compactBoundary: {
              schemaVersion: 1,
              trigger: 'manual',
              preTokens: 1200,
              summaryKind: 'model_summary',
            },
          },
        },
        { role: 'user', content: [{ type: 'text', text: 'restored summary' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'preserved assistant' }] },
      ],
    })

    const { resolveInitialSession } = await import('./session.js')
    const resolved = await resolveInitialSession({
      cwd: '/repo',
      env: process.env,
      resumeLast: true,
    })

    expect(resolved?.filePath).toBe('/tmp/latest-session.jsonl')
    expect(resolved?.messages).toHaveLength(1)
    expect(resolved?.history).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'restored summary' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'preserved assistant' }] },
    ])
  })

  it('best-effort refreshes rolling session memory for resumeLast restores', async () => {
    findLatestSessionFile.mockResolvedValue('/tmp/latest-session.jsonl')
    readSessionFile.mockResolvedValue({
      messages: [],
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'persisted assistant' }] }],
    })
    const persistSessionMemoryForRestore = vi.fn(async () => undefined)

    const { resolveInitialSession } = await import('./session.js')
    const resolved = await resolveInitialSession({
      cwd: '/repo',
      env: process.env,
      resumeLast: true,
      mode: 'acceptEdits',
      planPath: '/repo/.formax/plan.md',
      persistSessionMemoryForRestore,
    })

    expect(resolved?.filePath).toBe('/tmp/latest-session.jsonl')
    expect(persistSessionMemoryForRestore).toHaveBeenCalledWith({
      sessionFilePath: '/tmp/latest-session.jsonl',
      cwd: '/repo',
      mode: 'acceptEdits',
      planPath: '/repo/.formax/plan.md',
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'persisted assistant' }] }],
    })
  })

  it('reuses sidecar mode and planPath when resumeLast restore falls back to default context', async () => {
    findLatestSessionFile.mockResolvedValue('/tmp/latest-session.jsonl')
    readSessionFile.mockResolvedValue({
      messages: [],
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'persisted assistant' }] }],
    })
    readSessionMemoryFile.mockResolvedValue({
      activeTask: {
        mode: 'plan',
        planPath: '/repo/.formax/rolling-plan.md',
      },
    })
    const persistSessionMemoryForRestore = vi.fn(async () => undefined)

    const { resolveInitialSession } = await import('./session.js')
    await resolveInitialSession({
      cwd: '/repo',
      env: process.env,
      resumeLast: true,
      persistSessionMemoryForRestore,
    })

    expect(persistSessionMemoryForRestore).toHaveBeenCalledWith({
      sessionFilePath: '/tmp/latest-session.jsonl',
      cwd: '/repo',
      mode: 'plan',
      planPath: '/repo/.formax/rolling-plan.md',
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'persisted assistant' }] }],
    })
  })
})
