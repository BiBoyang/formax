import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listRecentSessions, readSessionPreview } = vi.hoisted(() => ({
  listRecentSessions: vi.fn(),
  readSessionPreview: vi.fn(),
}))

vi.mock('../repl/sessionSave/reader.js', () => ({
  listRecentSessions,
  readSessionPreview,
}))

import { listResumeDialogSessions, loadResumeDialogPreview } from './resumeDialogService.js'

describe('resumeDialogService', () => {
  beforeEach(() => {
    listRecentSessions.mockReset()
    readSessionPreview.mockReset()
  })

  it('forwards list arguments to listRecentSessions', async () => {
    const sessions = [
      {
        filePath: '/tmp/s1.jsonl',
        meta: { cwd: '/tmp/repo' },
        updatedAt: new Date(),
        messageCount: 1,
        lastUserPrompt: 'hello',
        label: null,
      },
    ]
    listRecentSessions.mockResolvedValueOnce(sessions)

    const out = await listResumeDialogSessions({
      cwd: '/tmp/repo',
      includeAllProjects: true,
      limit: 30,
    })

    expect(out).toBe(sessions)
    expect(listRecentSessions).toHaveBeenCalledWith({
      cwd: '/tmp/repo',
      includeAllProjects: true,
      limit: 30,
    })
  })

  it('forwards preview arguments to readSessionPreview', async () => {
    const preview = [
      { role: 'user', text: 'u1' },
      { role: 'assistant', text: 'a1' },
    ]
    readSessionPreview.mockResolvedValueOnce(preview)

    const out = await loadResumeDialogPreview('/tmp/s1.jsonl', { maxMessages: 5 })

    expect(out).toBe(preview)
    expect(readSessionPreview).toHaveBeenCalledWith('/tmp/s1.jsonl', { maxMessages: 5 })
  })
})
