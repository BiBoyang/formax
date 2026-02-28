import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { InputScopeProvider } from '../../features/repl/inputScopeContext.js'

type SessionSummary = {
  filePath: string
  meta: { cwd: string; cwdReal?: string; gitBranch?: string }
  updatedAt: Date
  messageCount: number | null
  lastUserPrompt: string | null
  label: string | null
}

const listRecentSessionsMock = vi.fn<
  (args: { cwd: string; includeAllProjects?: boolean; limit?: number }) => Promise<SessionSummary[]>
>()
const readSessionPreviewMock = vi.fn<
  (filePath: string, opts?: { maxMessages?: number }) => Promise<Array<{ role: 'user' | 'assistant'; text: string }>>
>()

vi.mock('../../features/commands/resumeDialogService.js', () => {
  return {
    listResumeDialogSessions: (args: any) => listRecentSessionsMock(args),
    loadResumeDialogPreview: (filePath: string, opts?: any) => readSessionPreviewMock(filePath, opts),
  }
})

import { ResumeDialog } from './ResumeDialog.js'

function tick(ms = 5): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForText(lastFrame: () => string | undefined, text: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (frame.includes(text)) return
    await tick()
  }
  const finalFrame = lastFrame() || ''
  throw new Error(`Timed out waiting for UI to contain: ${text}\n\nLast frame:\n${finalFrame}`)
}

async function waitForNoText(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (!frame.includes(text)) return
    await tick()
  }
  const finalFrame = lastFrame() || ''
  throw new Error(`Timed out waiting for UI to NOT contain: ${text}\n\nLast frame:\n${finalFrame}`)
}

function makeSession(i: number, overrides?: Partial<SessionSummary>): SessionSummary {
  const n = i + 1
  return {
    filePath: `/tmp/session-${n}.jsonl`,
    meta: { cwd: '/tmp/repo', gitBranch: n % 2 === 0 ? 'main' : 'feat/session_save' },
    updatedAt: new Date(Date.now() - n * 1000),
    messageCount: 10 + n,
    lastUserPrompt: n === 1 ? '' : `Prompt ${n}`,
    label: null,
    ...overrides,
  }
}

describe('ResumeDialog', () => {
  beforeEach(() => {
    listRecentSessionsMock.mockReset()
    readSessionPreviewMock.mockReset()
  })

  it(
    'renders CC-like header and help line',
    async () => {
      listRecentSessionsMock.mockResolvedValue([makeSession(0)])
      readSessionPreviewMock.mockResolvedValue([])

      const onExit = vi.fn()
      const onResume = vi.fn()
      const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})

      const { lastFrame } = render(
        <InputScopeProvider>
          <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Resume Session')
      // Help line can wrap depending on terminal width; check stable fragments.
      await waitForText(lastFrame, 'A to show all projects')
      await waitForText(lastFrame, 'Esc to')
    },
    20_000,
  )

  it('handles load failures and shows error text', async () => {
    listRecentSessionsMock.mockRejectedValue(new Error('load failed'))
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'Error: load failed')
  })

  it('handles string-shaped load failures', async () => {
    listRecentSessionsMock.mockRejectedValue('load failed string')
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'Error: load failed string')
  })

  it('shows empty state when no sessions are available', async () => {
    listRecentSessionsMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'No sessions found.')
  })

  it('ignores rename hotkey when there is no selected session', async () => {
    listRecentSessionsMock.mockResolvedValue([])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'No sessions found.')
    stdin.write('R')
    await tick()
    await waitForNoText(lastFrame, 'Rename:')
    expect(onRename).toHaveBeenCalledTimes(0)
    expect(onExit).toHaveBeenCalledTimes(0)
  })

  it(
    'shows a 15-row window and scrolls down (1–15 → 2–16)',
    async () => {
      listRecentSessionsMock.mockResolvedValue(Array.from({ length: 20 }, (_, i) => makeSession(i)))
      readSessionPreviewMock.mockResolvedValue([])

      const onExit = vi.fn()
      const onResume = vi.fn()
      const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})

      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Resume Session')
      await waitForText(lastFrame, '↓ 20')
      await waitForText(lastFrame, 'No prompt')
      await waitForText(lastFrame, 'Prompt 2')

      // Move down until the viewport scrolls (escape chunks can be coalesced/split).
      for (let i = 0; i < 40; i++) {
        stdin.write('\u001B[B')
        await tick()
        const frame = lastFrame() || ''
        if (frame.includes('↑ 20') && frame.includes('Prompt 16')) break
      }

      await waitForText(lastFrame, '↑ 20')
      await waitForText(lastFrame, 'Prompt 16')

      const frame = lastFrame() || ''
      expect(frame.includes('No prompt')).toBe(false)
    },
    20_000,
  )

  it('toggles include-all-projects via "A" and reloads list', async () => {
    listRecentSessionsMock
      .mockResolvedValueOnce([makeSession(0)])
      .mockResolvedValueOnce([makeSession(1, { label: 'Cross project session' })])
    readSessionPreviewMock.mockResolvedValue([])

    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})

    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Resume Session')
    stdin.write('A')
    await waitForText(lastFrame, 'Cross project session')
    expect(listRecentSessionsMock).toHaveBeenCalledTimes(2)
    expect(listRecentSessionsMock.mock.calls[1]?.[0]).toMatchObject({ includeAllProjects: true })
  })

  it('toggles branch display via "B"', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0, { label: 'Labeled session' })])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})

    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Labeled session')
    await waitForText(lastFrame, 'feat/session_save')
    stdin.write('B')
    await waitForNoText(lastFrame, 'feat/session_save')
  })

  it(
    'supports search mode via "/" and exits search on Esc',
    async () => {
      listRecentSessionsMock.mockResolvedValue(Array.from({ length: 10 }, (_, i) => makeSession(i)))
      readSessionPreviewMock.mockResolvedValue([])

      const onExit = vi.fn()
      const onResume = vi.fn()
      const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})

      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Resume Session')

      stdin.write('/')
      await waitForText(lastFrame, 'Search:')

      stdin.write('Prompt 9')
      await waitForText(lastFrame, 'Prompt 9')

      // Escape exits search (does not dismiss the dialog).
      stdin.write('\u001B')
      for (let i = 0; i < 50; i++) {
        await tick()
        const frame = lastFrame() || ''
        if (!frame.includes('Search:')) break
      }

      const frame = lastFrame() || ''
      expect(frame.includes('Search:')).toBe(false)
      expect(onExit).not.toHaveBeenCalled()
    },
    20_000,
  )

  it('shows preview unavailable text when preview loading fails', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0, { lastUserPrompt: 'preview target' })])
    readSessionPreviewMock.mockRejectedValue('preview load fail')
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})

    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'preview target')
    stdin.write('P')
    await waitForText(lastFrame, 'Preview unavailable: preview load fail')
  })

  it('shows preview unavailable text when preview loading throws Error', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0, { lastUserPrompt: 'preview error target' })])
    readSessionPreviewMock.mockRejectedValue(new Error('preview load error'))
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'preview error target')
    stdin.write('P')
    await waitForText(lastFrame, 'Preview unavailable: preview load error')
  })

  it('keeps preview empty when preview is toggled with no selected session', async () => {
    listRecentSessionsMock.mockResolvedValue([])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'No sessions found.')
    stdin.write('P')
    await tick()
    await waitForText(lastFrame, 'No sessions found.')
    expect(readSessionPreviewMock).toHaveBeenCalledTimes(0)
  })

  it('resumes selected session on Enter', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0)])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn<(filePath: string) => void>()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'Resume Session')
    await waitForText(lastFrame, 'No prompt')
    stdin.write('\r')
    stdin.write('\n')
    await tick()
    expect(onResume).toHaveBeenCalledWith('/tmp/session-1.jsonl')
  })

  it('ignores Enter when there is no selected session', async () => {
    listRecentSessionsMock.mockResolvedValue([])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn<(filePath: string) => void>()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'No sessions found.')
    stdin.write('\r')
    await tick()
    expect(onResume).toHaveBeenCalledTimes(0)
    expect(onExit).toHaveBeenCalledTimes(0)
  })

  it(
    'supports preview mode via "P"',
    async () => {
      listRecentSessionsMock.mockResolvedValue([makeSession(0, { lastUserPrompt: 'hello' })])
      readSessionPreviewMock.mockResolvedValue([
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'ok' },
      ])

      const onExit = vi.fn()
      const onResume = vi.fn()
      const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})

      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Resume Session')
      await waitForText(lastFrame, 'hello')

      stdin.write('P')
      await tick()
      await waitForText(lastFrame, '> hi')
      await waitForText(lastFrame, '⏺ ok')
    },
    20_000,
  )

  it('exits rename mode without calling onRename when submitted label is blank', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0, { lastUserPrompt: 'blank rename target' })])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'blank rename target')
    stdin.write('R')
    await waitForText(lastFrame, 'Rename:')
    for (let i = 0; i < 80; i++) stdin.write('\u007F')
    stdin.write('\r')
    for (let i = 0; i < 20; i++) await tick(5)
    await waitForNoText(lastFrame, 'Rename:')
    expect(onRename).toHaveBeenCalledTimes(0)
    expect(onExit).toHaveBeenCalledTimes(0)
  })

  it('exits search when pressing "/" again while searching', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0), makeSession(1)])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Resume Session')
    stdin.write('/')
    await waitForText(lastFrame, 'Search:')
    stdin.write('/')
    await waitForNoText(lastFrame, 'Search:')
    expect(onExit).not.toHaveBeenCalled()
  })

  it('ignores list-navigation keys while in search mode', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0), makeSession(1)])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Resume Session')
    stdin.write('/')
    await waitForText(lastFrame, 'Search:')
    stdin.write('\u001B[B')
    await tick()
    await waitForText(lastFrame, 'Search:')
    expect(onExit).not.toHaveBeenCalled()
  })

  it('exits rename mode on Esc without dismissing the dialog', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0, { lastUserPrompt: 'rename target' })])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'rename target')
    stdin.write('R')
    await waitForText(lastFrame, 'Rename:')
    stdin.write('\u001B')
    for (let i = 0; i < 20; i++) await tick(5)
    await waitForNoText(lastFrame, 'Rename:')
    expect(onExit).not.toHaveBeenCalled()
    expect(onRename).not.toHaveBeenCalled()
  })

  it('ignores non-escape keys while renaming (handled by TextInput)', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0, { lastUserPrompt: 'rename ignore target' })])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'rename ignore target')
    stdin.write('R')
    await waitForText(lastFrame, 'Rename:')
    stdin.write('\u001B[A')
    await tick()
    await waitForText(lastFrame, 'Rename:')
    expect(onExit).toHaveBeenCalledTimes(0)
    expect(onResume).toHaveBeenCalledTimes(0)
  })

  it('dismisses dialog on Esc from list view', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0)])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'Resume Session')
    stdin.write('\u001B')
    for (let i = 0; i < 20; i++) await tick(5)
    expect(onExit).toHaveBeenCalledWith({ kind: 'dismissed' })
  })

  it('does not dismiss on partial ESC chunk while waiting for arrow sequence completion', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0)])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'Resume Session')
    stdin.write('\u001B')
    await tick(10)
    expect(onExit).toHaveBeenCalledTimes(0)
  })

  it('cancels pending escape fallback when another key arrives', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0)])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'Resume Session')
    stdin.write('\u001B')
    stdin.write('A')
    for (let i = 0; i < 20; i++) await tick(5)
    expect(onExit).toHaveBeenCalledTimes(0)
    expect(listRecentSessionsMock.mock.calls.at(-1)?.[0]).toMatchObject({ includeAllProjects: true })
  })

  it('ignores pending split arrow fragment chunk', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0)])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'Resume Session')
    stdin.write('\u001B[')
    await tick()
    expect(onExit).toHaveBeenCalledTimes(0)
    expect(onResume).toHaveBeenCalledTimes(0)
  })

  it('renders details without branch suffix when session has no gitBranch', async () => {
    listRecentSessionsMock.mockResolvedValue([
      makeSession(0, { label: 'No branch item', meta: { cwd: '/tmp/repo' } }),
    ])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'No branch item')
    await waitForNoText(lastFrame, 'feat/session_save')
    await waitForNoText(lastFrame, 'main')
  })

  it('renders fallback message count text when messageCount is null', async () => {
    listRecentSessionsMock.mockResolvedValue([makeSession(0, { messageCount: null, label: 'Null count item' })])
    readSessionPreviewMock.mockResolvedValue([])
    const onExit = vi.fn()
    const onResume = vi.fn()
    const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})
    const { lastFrame } = render(
      <InputScopeProvider>
        <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'Null count item')
    await waitForText(lastFrame, '? messages')
  })

  it(
    'supports rename mode via "R" and calls onRename',
    async () => {
      listRecentSessionsMock.mockResolvedValue([makeSession(0, { lastUserPrompt: 'hello' })])

      const onExit = vi.fn()
      const onResume = vi.fn()
      const onRename = vi.fn<(filePath: string, label: string) => Promise<void>>(async () => {})

      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <ResumeDialog onExit={onExit} onResume={onResume} onRename={onRename} cwd="/tmp/repo" />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Resume Session')
      await waitForText(lastFrame, 'hello')

      stdin.write('R')
      await waitForText(lastFrame, 'Rename:')

      stdin.write('My session')
      stdin.write('\r')

      // rename is async; give it a moment to flush.
      for (let i = 0; i < 50; i++) await tick()

      expect(onRename).toHaveBeenCalledTimes(1)
      expect(onRename.mock.calls[0]?.[0]).toBe('/tmp/session-1.jsonl')
      expect(onRename.mock.calls[0]?.[1]).toContain('My session')
    },
    20_000,
  )
})
