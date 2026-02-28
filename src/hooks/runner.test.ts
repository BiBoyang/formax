import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCommandHooks, summarizeHookRuns } from './runner.js'

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
}

describe('runCommandHooks', () => {
  it('captures stdout JSON on exitCode 0', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-runner-'))
    const scriptPath = path.join(tmp, 'hook.js')
    await writeText(
      scriptPath,
      [
        'let s = ""',
        'process.stdin.on("data", c => s += c)',
        'process.stdin.on("end", () => {',
        '  const out = { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "ok" } }',
        '  process.stdout.write(JSON.stringify(out))',
        '})',
      ].join('\n'),
    )

    const runs = await runCommandHooks({
      hooks: [
        {
          source: 'projectLocal',
          matcher: '*',
          command: `node "${scriptPath}"`,
          timeoutMs: null,
        },
      ],
      payload: { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {}, cwd: tmp },
      cwd: tmp,
      env: { ...process.env },
    })

    expect(runs).toHaveLength(1)
    expect(runs[0].exitCode).toBe(0)
    expect(runs[0].source).toBe('projectLocal')
    expect(runs[0].matcher).toBe('*')
    expect(runs[0].parsedJson).toBeTruthy()
  })

  it('captures stderr on exitCode 2 (blocking)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-runner-'))
    const scriptPath = path.join(tmp, 'hook.js')
    await writeText(
      scriptPath,
      ['process.stderr.write("blocked")', 'process.exit(2)'].join('\n'),
    )

    const runs = await runCommandHooks({
      hooks: [
        {
          source: 'projectLocal',
          matcher: '*',
          command: `node "${scriptPath}"`,
          timeoutMs: null,
        },
      ],
      payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, cwd: tmp },
      cwd: tmp,
      env: { ...process.env },
    })

    expect(runs).toHaveLength(1)
    expect(runs[0].exitCode).toBe(2)
    expect(runs[0].source).toBe('projectLocal')
    expect(runs[0].matcher).toBe('*')
    expect(runs[0].stderr).toContain('blocked')
  })

  it('returns empty array when hooks list is empty', async () => {
    const runs = await runCommandHooks({
      hooks: [],
      payload: {},
      cwd: process.cwd(),
      env: { ...process.env },
    })

    expect(runs).toEqual([])
  })

  it('returns aborted result when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const runs = await runCommandHooks({
      hooks: [
        {
          source: 'projectLocal',
          matcher: '*',
          command: 'node -e "setTimeout(() => {}, 50)"',
          timeoutMs: null,
        },
      ],
      payload: {},
      cwd: process.cwd(),
      env: { ...process.env },
      signal: controller.signal,
    })

    expect(runs[0].exitCode).toBeNull()
    expect(runs[0].stderr).toBe('aborted')
  })

  it('aborts a running hook when signal is triggered after start', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 10)

    const runs = await runCommandHooks({
      hooks: [
        {
          source: 'projectLocal',
          matcher: '*',
          command: 'node -e "setTimeout(() => process.exit(0), 100)"',
          timeoutMs: null,
        },
      ],
      payload: {},
      cwd: process.cwd(),
      env: { ...process.env },
      signal: controller.signal,
    })

    expect(runs).toHaveLength(1)
    expect(runs[0].exitCode).not.toBe(0)
  })

  it('marks hook run as timed out', async () => {
    const runs = await runCommandHooks({
      hooks: [
        {
          source: 'projectLocal',
          matcher: '*',
          command: 'node -e "setTimeout(() => process.exit(0), 100)"',
          timeoutMs: 10,
        },
      ],
      payload: {},
      cwd: process.cwd(),
      env: { ...process.env },
    })

    expect(runs[0].timedOut).toBe(true)
  })

  it('truncates oversized output and appends truncation suffix once', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-hooks-runner-'))
    const scriptPath = path.join(tmp, 'hook.js')
    await writeText(
      scriptPath,
      [
        'const suffix = "\\n…(truncated)"',
        'process.stdout.write("x".repeat(30500) + suffix)',
      ].join('\n'),
    )

    const runs = await runCommandHooks({
      hooks: [
        {
          source: 'projectLocal',
          matcher: '*',
          command: `node "${scriptPath}"`,
          timeoutMs: null,
        },
      ],
      payload: {},
      cwd: tmp,
      env: { ...process.env },
    })

    expect(runs[0].stdoutTruncated).toBe(true)
    expect(runs[0].stdout.endsWith('\n…(truncated)')).toBe(true)
  })

  it('appends truncation suffix when oversized output does not already end with it', async () => {
    const runs = await runCommandHooks({
      hooks: [
        {
          source: 'projectLocal',
          matcher: '*',
          command: `node -e "process.stdout.write('x'.repeat(30500))"`,
          timeoutMs: null,
        },
      ],
      payload: {},
      cwd: process.cwd(),
      env: { ...process.env },
    })

    expect(runs[0].stdoutTruncated).toBe(true)
    expect(runs[0].stdout.endsWith('\n…(truncated)')).toBe(true)
  })

  it('does not parse invalid JSON even when exitCode is 0', async () => {
    const runs = await runCommandHooks({
      hooks: [
        {
          source: 'projectLocal',
          matcher: '*',
          command: 'node -e "process.stdout.write(\'not-json\')"',
          timeoutMs: 0,
        },
      ],
      payload: {},
      cwd: process.cwd(),
      env: { ...process.env },
      concurrency: 1,
      defaultTimeoutMs: 1,
    })

    expect(runs[0].exitCode).toBe(0)
    expect(runs[0].parsedJson).toBeNull()
  })

  it('treats empty stdout as non-json result', async () => {
    const runs = await runCommandHooks({
      hooks: [
        {
          source: 'projectLocal',
          matcher: '*',
          command: 'node -e ""',
          timeoutMs: null,
        },
      ],
      payload: {},
      cwd: process.cwd(),
      env: { ...process.env },
    })

    expect(runs[0].exitCode).toBe(0)
    expect(runs[0].stdout).toBe('')
    expect(runs[0].parsedJson).toBeNull()
  })

  it('resolves hook run when child process emits spawn error', async () => {
    const runs = await runCommandHooks({
      hooks: [
        {
          source: 'projectLocal',
          matcher: '*',
          command: 'node -e "process.exit(0)"',
          timeoutMs: null,
        },
      ],
      payload: {},
      cwd: '/definitely/not/existing/formax-hooks-cwd',
      env: { ...process.env },
    })

    expect(runs).toHaveLength(1)
    expect(runs[0].exitCode).toBeNull()
  })
})

describe('summarizeHookRuns', () => {
  it('splits blocked and failed runs by exit code', () => {
    const summary = summarizeHookRuns([
      { exitCode: 0 } as any,
      { exitCode: 2 } as any,
      { exitCode: 1 } as any,
      { exitCode: null } as any,
    ])

    expect(summary.blocked).toHaveLength(1)
    expect(summary.failed).toHaveLength(2)
    expect(summary.blocked[0].exitCode).toBe(2)
  })
})
