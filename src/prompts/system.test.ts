import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from './system'

describe('buildSystemPrompt', () => {
  it('includes cwd note in lite profile', () => {
    const blocks = buildSystemPrompt({ profile: 'lite', cwd: '/repo' })
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks[0]?.text).toContain('Current working directory: /repo')
  })

  it('includes a deterministic env snapshot in full profile when deps are provided', () => {
    const blocks = buildSystemPrompt(
      { profile: 'full', cwd: '/repo', model: 'm' },
      {
        platform: 'test-platform',
        getToday: () => '2020-01-01',
        osType: () => 'TestOS',
        osRelease: () => '1.2.3',
        isGitRepository: () => false,
      },
    )

    const text = blocks.map((b) => b.text).join('\n')
    expect(text).toContain('Working directory: /repo')
    expect(text).toContain('Is directory a git repo: No')
    expect(text).toContain('Platform: test-platform')
    expect(text).toContain('OS Version: TestOS 1.2.3')
    expect(text).toContain("Today's date: 2020-01-01")
    expect(text).toContain('Model ID: m')
  })

  it('includes git snapshot when the repo is detected', () => {
    const blocks = buildSystemPrompt(
      { profile: 'full', cwd: '/repo' },
      {
        getToday: () => '2020-01-01',
        osType: () => 'TestOS',
        osRelease: () => '1.2.3',
        platform: 'test-platform',
        isGitRepository: () => true,
        buildGitSnapshot: () => 'gitStatus: snapshot',
      },
    )

    const text = blocks.map((b) => b.text).join('\n')
    expect(text).toContain('gitStatus: snapshot')
  })
})

