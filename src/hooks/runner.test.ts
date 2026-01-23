import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCommandHooks } from './runner.js'

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
          matcher: '',
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
    expect(runs[0].matcher).toBe('')
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
          matcher: '',
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
    expect(runs[0].matcher).toBe('')
    expect(runs[0].stderr).toContain('blocked')
  })
})
