import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readSessionSummary: vi.fn(),
  detectNewTopicTitleCandidate: vi.fn(),
  generateSessionTitle: vi.fn(),
  persistSessionTitle: vi.fn(),
}))

vi.mock('../repl/sessionSave/reader', () => ({
  readSessionSummary: mocks.readSessionSummary,
}))

vi.mock('./generate', () => ({
  detectNewTopicTitleCandidate: mocks.detectNewTopicTitleCandidate,
  generateSessionTitle: mocks.generateSessionTitle,
}))

vi.mock('./apply', () => ({
  persistSessionTitle: mocks.persistSessionTitle,
}))

import { maybeAutoGenerateSessionTitle } from './index'

describe('maybeAutoGenerateSessionTitle branch guards', () => {
  it('returns null for labeled sessions when topic candidate is empty', async () => {
    mocks.readSessionSummary.mockResolvedValueOnce({
      meta: { sessionId: 's1' },
      label: 'Existing',
      lastUserPrompt: null,
      messageCount: 2,
    })

    const out = await maybeAutoGenerateSessionTitle({
      filePath: '/tmp/session.jsonl',
      cwd: '/tmp',
      attemptedSessionIds: new Set<string>(),
      topicUserText: '   ',
      engine: { runTurn: vi.fn() },
    })

    expect(out).toBeNull()
    expect(mocks.detectNewTopicTitleCandidate).not.toHaveBeenCalled()
  })

  it('returns null when topic key was already checked', async () => {
    mocks.readSessionSummary.mockResolvedValueOnce({
      meta: { sessionId: 's1' },
      label: 'Existing',
      lastUserPrompt: null,
      messageCount: 2,
    })
    const checked = new Set<string>(['s1:new topic'])

    const out = await maybeAutoGenerateSessionTitle({
      filePath: '/tmp/session.jsonl',
      cwd: '/tmp',
      attemptedSessionIds: new Set<string>(),
      checkedTopicPromptKeys: checked,
      topicUserText: 'new topic',
      engine: { runTurn: vi.fn() },
    })

    expect(out).toBeNull()
    expect(mocks.detectNewTopicTitleCandidate).not.toHaveBeenCalled()
  })

  it('returns null for unlabeled sessions when policy disallows rerun', async () => {
    mocks.readSessionSummary.mockResolvedValueOnce({
      meta: { sessionId: 's2' },
      label: null,
      lastUserPrompt: 'from summary',
      messageCount: 1,
    })
    const attempted = new Set<string>(['s2'])

    const out = await maybeAutoGenerateSessionTitle({
      filePath: '/tmp/session.jsonl',
      cwd: '/tmp',
      attemptedSessionIds: attempted,
      engine: { runTurn: vi.fn() },
    })

    expect(out).toBeNull()
    expect(mocks.generateSessionTitle).not.toHaveBeenCalled()
  })
})
