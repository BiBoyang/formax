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

      // Move the cursor down so the viewport must scroll.
      for (let i = 0; i < 15; i++) {
        stdin.write('\u001B[B')
        await tick()
      }

      await waitForText(lastFrame, '↑ 20')
      await waitForText(lastFrame, 'Prompt 16')

      const frame = lastFrame() || ''
      expect(frame.includes('No prompt')).toBe(false)
    },
    20_000,
  )

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
