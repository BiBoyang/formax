import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import { HooksDialog } from './HooksDialog'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForText(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (frame.includes(text)) return
    await tick()
  }
  const finalFrame = lastFrame() || ''
  throw new Error(`Timed out waiting for UI to contain: ${text}\n\nLast frame:\n${finalFrame}`)
}

async function waitForJsonContains(
  filePath: string,
  predicate: (parsed: any) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (predicate(parsed)) return
    await tick()
  }
  const raw = await readFile(filePath, 'utf8')
  throw new Error(`Timed out waiting for JSON predicate to be true: ${filePath}\n\nLast JSON:\n${raw}`)
}

describe('HooksDialog', () => {
  it('shows wildcard (*) matcher rules even when hooks are empty', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-hooks-wildcard-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    const settingsPath = path.join(projectConfigDir, 'settings.local.json')
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          version: 1,
          hooks: {
            PreToolUse: [{ matcher: '*', hooks: [] }],
            PermissionRequest: [],
            PostToolUse: [],
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    try {
      const onExit = vi.fn()
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <HooksDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Hooks')
      await waitForText(lastFrame, 'PreToolUse')
      await tick()

      stdin.write('\r')
      await waitForText(lastFrame, 'PreToolUse - Tool Matchers')
      await waitForText(lastFrame, '[Local] *')
      await waitForText(lastFrame, '0 hooks')

      // Select wildcard matcher (cursor 0 is "+ Add new matcher…")
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\r')
      await waitForText(lastFrame, 'PreToolUse - Matcher: *')
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)

  it('supports cursor movement and deletion when entering hook commands', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-hooks-editing-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    const settingsPath = path.join(projectConfigDir, 'settings.local.json')
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          version: 1,
          hooks: {
            PreToolUse: [{ matcher: 'Bash', hooks: [] }],
            PermissionRequest: [],
            PostToolUse: [],
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    try {
      const onExit = vi.fn()
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <HooksDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Hooks')
      await waitForText(lastFrame, 'PreToolUse')
      await tick()

      stdin.write('\r')
      await waitForText(lastFrame, 'PreToolUse - Tool Matchers')
      await waitForText(lastFrame, '[Local] Bash')
      await tick()

      // Enter Bash matcher
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\r')
      await waitForText(lastFrame, 'PreToolUse - Matcher: Bash')
      await tick()

      // Enter "Add new hook" and type with edits in the middle
      stdin.write('\r')
      await waitForText(lastFrame, 'Add new hook')
      await tick()

      stdin.write('12345')
      await tick()
      stdin.write('\u001B[D')
      stdin.write('\u001B[D')
      await tick()
      // Ink test harness cannot distinguish forward-delete vs backspace (both map to key.delete).
      // We still verify "edit in the middle": delete one char, then insert one char at the cursor.
      stdin.write('\x7f')
      await tick()
      stdin.write('9')
      await tick()
      stdin.write('\r')

      await waitForText(lastFrame, 'Save hook configuration')
      await waitForText(lastFrame, 'Command: 12945')

      // Save to project local
      stdin.write('\r')

      await waitForJsonContains(settingsPath, (parsed) => {
        const pre = parsed?.hooks?.PreToolUse
        if (!Array.isArray(pre)) return false
        const bashRule = pre.find((r: any) => r?.matcher === 'Bash')
        const hooks = bashRule?.hooks
        return Array.isArray(hooks) && hooks.some((h: any) => h?.type === 'command' && h?.command === '12945')
      })
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)

  it('adds and deletes a hook while preserving other settings fields', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-hooks-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    const settingsPath = path.join(projectConfigDir, 'settings.local.json')
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          version: 1,
          keepMe: { ok: true },
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'python3 .formax/hooks/pre_tool_use_test.py' }],
              },
            ],
            PermissionRequest: [],
            PostToolUse: [],
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    try {
      const onExit = vi.fn()
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <HooksDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Hooks')
      await waitForText(lastFrame, 'PreToolUse')
      await tick()

      // Enter PreToolUse (first enabled event)
      stdin.write('\r')
      await waitForText(lastFrame, 'PreToolUse - Tool Matchers')
      await waitForText(lastFrame, '[Local] Bash')
      await waitForText(lastFrame, '1 hook')
      await tick()

      // Enter Bash matcher (cursor 0 is "+ Add new matcher…")
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\r')
      await waitForText(lastFrame, 'PreToolUse - Matcher: Bash')
      await waitForText(lastFrame, 'python3 .formax/hooks/pre_tool_use_test.py')

      // Add new hook
      stdin.write('\r')
      await waitForText(lastFrame, 'Add new hook')
      await waitForText(lastFrame, 'Event: PreToolUse - Before tool execution')
      await tick()

      const newCmd = 'python3 .formax/hooks/new_hook.py'
      stdin.write(newCmd)
      await tick()
      stdin.write('\r')
      await waitForText(lastFrame, 'Save hook configuration')
      await waitForText(lastFrame, newCmd)
      await waitForText(lastFrame, 'Event: PreToolUse - Before tool execution')

      // Save to project local
      stdin.write('\r')

      await waitForJsonContains(settingsPath, (parsed) => {
        const pre = parsed?.hooks?.PreToolUse
        if (!Array.isArray(pre)) return false
        const bashRule = pre.find((r: any) => r?.matcher === 'Bash')
        const hooks = bashRule?.hooks
        return Array.isArray(hooks) && hooks.some((h: any) => h?.type === 'command' && h?.command === newCmd)
      })

      const rawAfterSave = await readFile(settingsPath, 'utf8')
      const parsedAfterSave = JSON.parse(rawAfterSave)
      expect(parsedAfterSave.keepMe).toEqual({ ok: true })

      // Delete the new hook: move cursor to it (add row + old hook + new hook)
      await waitForText(lastFrame, newCmd)
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\r')
      await waitForText(lastFrame, 'Delete hook?')
      await waitForText(lastFrame, 'Event: PreToolUse')
      await waitForText(lastFrame, 'Matcher: Bash')
      await waitForText(lastFrame, 'Local settings (.formax/settings.local.json)')
      await waitForText(lastFrame, 'This will remove the hook configuration from your settings.')
      await tick()

      const deleteFrame = lastFrame() || ''
      expect(deleteFrame).toMatch(/❯\s*1\.\s*Yes[\s\S]*\n[\s\S]*2\.\s*No/)
      stdin.write('\r')

      await waitForJsonContains(settingsPath, (parsed) => {
        const pre = parsed?.hooks?.PreToolUse
        if (!Array.isArray(pre)) return true
        const bashRule = pre.find((r: any) => r?.matcher === 'Bash')
        const hooks = bashRule?.hooks
        if (!Array.isArray(hooks)) return true
        return !hooks.some((h: any) => h?.type === 'command' && h?.command === newCmd)
      })
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)

  it('skips matcher screens for matcher-less events and saves without matcher field', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-hooks-matcherless-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    const settingsPath = path.join(projectConfigDir, 'settings.local.json')
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          version: 1,
          hooks: {
            UserPromptSubmit: [],
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    try {
      const onExit = vi.fn()
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <HooksDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Hooks')
      await waitForText(lastFrame, 'UserPromptSubmit')
      await tick()

      // Move cursor to UserPromptSubmit (4th enabled event)
      stdin.write('\u001B[B')
      stdin.write('\u001B[B')
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\r')

      // Should go straight to hook list (no matcher list)
      await waitForText(lastFrame, '+ Add new hook…')
      expect(lastFrame() || '').not.toContain('Tool Matchers')

      // Add new hook
      stdin.write('\r')
      await waitForText(lastFrame, 'Add new hook')
      expect(lastFrame() || '').not.toContain('Matcher:')
      await tick()

      const cmd = 'python3 .formax/hooks/user_prompt_submit_probe.py'
      stdin.write(cmd)
      await tick()
      stdin.write('\r')

      await waitForText(lastFrame, 'Save hook configuration')
      await waitForText(lastFrame, cmd)
      expect(lastFrame() || '').not.toContain('Matcher:')

      // Save to project local (default cursor 0)
      stdin.write('\r')

      await waitForJsonContains(settingsPath, (parsed) => {
        const rules = parsed?.hooks?.UserPromptSubmit
        if (!Array.isArray(rules)) return false
        const rule = rules.find((r: any) => r && typeof r === 'object' && !Array.isArray(r) && !('matcher' in r))
        const hooks = rule?.hooks
        return Array.isArray(hooks) && hooks.some((h: any) => h?.type === 'command' && h?.command === cmd)
      })

      // Delete the hook we just added (move cursor to entry)
      await waitForText(lastFrame, cmd)
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\r')
      await waitForText(lastFrame, 'Delete hook?')
      await waitForText(lastFrame, `Event: UserPromptSubmit`)
      expect(lastFrame() || '').not.toContain('Matcher:')
      stdin.write('\r')

      await waitForJsonContains(settingsPath, (parsed) => {
        const rules = parsed?.hooks?.UserPromptSubmit
        if (!Array.isArray(rules)) return true
        for (const r of rules) {
          if (!r || typeof r !== 'object' || Array.isArray(r)) continue
          const hooks = (r as any).hooks
          if (!Array.isArray(hooks)) continue
          if (hooks.some((h: any) => h?.type === 'command' && h?.command === cmd)) return false
        }
        return true
      })
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)
})
