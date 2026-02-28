import childProcess from 'node:child_process'
import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSystemPrompt } from './system'

describe('buildSystemPrompt', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes cwd note in lite profile', () => {
    const blocks = buildSystemPrompt({ profile: 'lite', cwd: '/repo' })
    expect(blocks.length).toBeGreaterThan(0)
    const firstText = blocks.find((b) => b.type === 'text') as any
    expect(String(firstText?.text || '')).toContain('Current working directory: /repo')
  })

  it('defaults to full profile when profile is omitted', () => {
    const blocks = buildSystemPrompt(undefined, {
      platform: 'test-platform',
      getToday: () => '2020-01-01',
      osType: () => 'TestOS',
      osRelease: () => '1.2.3',
      isGitRepository: () => false,
    })
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    expect(text).toContain('Task tool is available')
  })

  it('lists allowed subagents in lite profile', () => {
    const blocks = buildSystemPrompt({
      profile: 'lite',
      allowedSubagents: [
        { name: 'Explore', description: 'scan codebase' },
        { name: 'Fix', description: '' },
      ],
    })

    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    expect(text).toContain('Available subagents for Task.subagent_type:')
    expect(text).toContain('- Explore: scan codebase')
    expect(text).toContain('- Fix')
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

    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
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

    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    expect(text).toContain('gitStatus: snapshot')
  })

  it('builds git snapshot from runtime git commands when deps are omitted', () => {
    const spawnSyncSpy = vi.spyOn(childProcess, 'spawnSync')
    spawnSyncSpy
      .mockReturnValueOnce({ status: 0, stdout: 'true\n' } as any)
      .mockReturnValueOnce({ status: 0, stdout: 'main\n' } as any)
      .mockReturnValueOnce({ status: 0, stdout: ' M src/file.ts\n' } as any)
      .mockReturnValueOnce({
        status: 0,
        stdout: `abcdef0 ${'x'.repeat(160)}\n1234567 short\n`,
      } as any)

    const blocks = buildSystemPrompt({ profile: 'full', cwd: '/repo', model: 'runtime-model' })
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')

    expect(text).toContain('Is directory a git repo: Yes')
    expect(text).toContain('Current branch: main')
    expect(text).toContain('(dirty)')
    expect(text).toContain('Recent commits:')
    expect(text).toContain('…')
    expect(spawnSyncSpy).toHaveBeenCalled()
  })

  it('falls back to fs git detection and handles git command failures', () => {
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 1, stdout: '' } as any)
    vi.spyOn(fs, 'existsSync').mockImplementation((target) => String(target).endsWith('/repo/.git'))

    const blocks = buildSystemPrompt({ profile: 'full', cwd: '/repo', model: 'fallback-model' })
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    expect(text).toContain('Is directory a git repo: Yes')
    expect(text).toContain('Status:')
  })

  it('handles spawn exceptions and fs.existsSync exceptions safely', () => {
    vi.spyOn(childProcess, 'spawnSync').mockImplementation(() => {
      throw new Error('spawn failed')
    })
    vi.spyOn(fs, 'existsSync').mockImplementation(() => {
      throw new Error('fs failed')
    })

    const blocks = buildSystemPrompt({ profile: 'full', cwd: '/repo', model: 'error-model' })
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    expect(text).toContain('Is directory a git repo: No')
    expect(text).not.toContain('Current branch:')
  })

  it('does not crash when injected deps throw', () => {
    expect(() =>
      buildSystemPrompt(
        { profile: 'full', cwd: '/repo' },
        {
          getToday: () => '2020-01-01',
          osType: () => 'TestOS',
          osRelease: () => '1.2.3',
          platform: 'test-platform',
          isGitRepository: () => true,
          buildGitSnapshot: () => {
            throw new Error('boom')
          },
        },
      ),
    ).not.toThrow()
  })

  it('renders full task notes with configured subagents and custom app name', () => {
    const blocks = buildSystemPrompt(
      {
        profile: 'full',
        appName: '  CustomApp  ',
        cwd: '/repo',
        allowedSubagents: [{ name: 'Explore', description: 'Inspect implementation' }],
      },
      {
        platform: 'test-platform',
        getToday: () => '2020-01-01',
        osType: () => 'TestOS',
        osRelease: () => '1.2.3',
        isGitRepository: () => false,
      },
    )

    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    expect(text).toContain('/help: Get help with using CustomApp')
    expect(text).toContain('Available subagents for Task.subagent_type:')
    expect(text).toContain('- Explore: Inspect implementation')
  })

  it('handles full profile subagent entries without descriptions', () => {
    const blocks = buildSystemPrompt(
      {
        profile: 'full',
        allowedSubagents: [
          { name: 'Explore', description: 'Inspect implementation' },
          { name: 'Fix', description: '' },
        ],
      },
      {
        platform: 'test-platform',
        getToday: () => '2020-01-01',
        osType: () => 'TestOS',
        osRelease: () => '1.2.3',
        isGitRepository: () => false,
      },
    )

    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    expect(text).toContain('- Fix')
  })

  it('uses process cwd fallback and reuses cached env snapshot without deps', () => {
    const spawnSyncSpy = vi.spyOn(childProcess, 'spawnSync')
    spawnSyncSpy.mockReturnValue({ status: 0, stdout: '' } as any)
    vi.spyOn(process, 'cwd').mockReturnValue('/cached-cwd')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)

    const first = buildSystemPrompt({ profile: 'full', cwd: '   ', model: 'cached-model' })
    const second = buildSystemPrompt({ profile: 'full', cwd: '   ', model: 'cached-model' })
    const firstText = first
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    const secondText = second
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    expect(firstText).toContain('Working directory: /cached-cwd')
    expect(secondText).toContain('Working directory: /cached-cwd')
    expect(spawnSyncSpy).toHaveBeenCalledTimes(1)
  })

  it('returns null when git spawn reports error or has empty stdout', () => {
    const spawnSyncSpy = vi.spyOn(childProcess, 'spawnSync')
    spawnSyncSpy.mockReturnValueOnce({ status: 0, error: new Error('git error') } as any).mockReturnValueOnce({
      status: 0,
      stdout: undefined,
    } as any)
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)

    const blocks = buildSystemPrompt({ profile: 'full', cwd: '/repo', model: 'spawn-error-model' })
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    expect(text).toContain('Is directory a git repo: No')
  })

  it('falls back to process.cwd when full profile cwd is omitted', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/process-cwd')
    const blocks = buildSystemPrompt(
      { profile: 'full' },
      {
        platform: 'test-platform',
        getToday: () => '2020-01-01',
        osType: () => 'TestOS',
        osRelease: () => '1.2.3',
        isGitRepository: () => false,
      },
    )

    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    expect(text).toContain('Working directory: /process-cwd')
  })

  it('executes empty-trim cwd fallback branch safely', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('')
    const blocks = buildSystemPrompt(
      { profile: 'full' },
      {
        platform: 'test-platform',
        getToday: () => '2020-01-01',
        osType: () => 'TestOS',
        osRelease: () => '1.2.3',
        isGitRepository: () => false,
      },
    )
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    expect(text).toContain('Working directory:')
  })
})
