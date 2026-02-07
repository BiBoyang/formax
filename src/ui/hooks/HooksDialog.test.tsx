import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { InputScopeProvider, useInputScope } from '../../features/repl/inputScopeContext'
import { HooksDialog } from './HooksDialog'

function tick(): Promise<void> {
  // Under full-suite + coverage load (Ink 6 / React 19), input + frames can be batched/delayed.
  // A tiny delay keeps these UI/input tests deterministic.
  return new Promise((resolve) => setTimeout(resolve, 5))
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripAnsi(raw: string): string {
  // Ink snapshots may include ANSI codes (colors/cursor styles). Strip them so assertions
  // match on the visible text only and so failure output doesn't "replay" terminal control codes.
  return (
    raw
      // CSI sequences
      .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
      // OSC sequences
      .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
  )
}

async function moveCursorToItem(
  lastFrame: () => string | undefined,
  stdin: { write: (data: string) => void },
  itemText: string,
  maxMoves = 100,
): Promise<void> {
  const re = new RegExp(`❯\\s*(?:\\d+\\.\\s*)?${escapeRegExp(itemText)}`)
  const frame0 = stripAnsi(lastFrame() || '')
  if (re.test(frame0)) return

  // The initial cursor can drift between tests under React 19 batching and Ink 6 rendering,
  // so allow both downward and upward search to make navigation deterministic.
  for (let i = 0; i < maxMoves; i++) {
    stdin.write('\u001B[B')
    await tick()
    const frame = stripAnsi(lastFrame() || '')
    if (re.test(frame)) return
  }

  for (let i = 0; i < maxMoves; i++) {
    stdin.write('\u001B[A')
    await tick()
    const frame = stripAnsi(lastFrame() || '')
    if (re.test(frame)) return
  }

  const frame = stripAnsi(lastFrame() || '')
  throw new Error(`Failed to move cursor to item: ${itemText}\n\nLast frame:\n${frame}`)
}

async function waitForText(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = stripAnsi(lastFrame() || '')
    if (frame.includes(text)) return
    await tick()
  }
  const finalFrame = stripAnsi(lastFrame() || '')
  throw new Error(`Timed out waiting for UI to contain: ${text}\n\nLast frame:\n${finalFrame}`)
}

async function waitForScope(
  scopes: string[],
  expected: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (scopes[scopes.length - 1] === expected) return
    await tick()
  }
  throw new Error(`Timed out waiting for active scope to be: ${expected}\n\nScopes:\n${scopes.join('\n')}`)
}

async function waitForJsonContains(
  filePath: string,
  predicate: (parsed: any) => boolean,
  timeoutMs = 15000,
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

async function typeText(
  stdin: { write: (data: string) => void },
  text: string,
): Promise<void> {
  // `stdin.write(text)` can be treated as a "paste" burst; under Ink 6 + React 19 this can be
  // timing-sensitive in tests. Typing characters with tiny delays keeps it deterministic.
  for (const ch of text) {
    stdin.write(ch)
    await tick()
  }
}

function ActiveScopeSpy({ onScope }: { onScope: (s: string) => void }): React.ReactNode {
  const { activeScope } = useInputScope()
  const onScopeRef = React.useRef(onScope)
  onScopeRef.current = onScope
  React.useEffect(() => {
    onScopeRef.current(activeScope)
  }, [activeScope])
  return null
}

describe('HooksDialog', () => {
  it('uses matcher screen for SessionStart and normalizes matcher selection', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-hooks-sessionstart-'))
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
            SessionStart: [{ matcher: 'CLEAR', hooks: [{ type: 'command', command: 'echo clear-only' }] }],
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
      await moveCursorToItem(lastFrame, stdin, 'SessionStart')
      stdin.write('\r')

      await waitForText(lastFrame, 'SessionStart - Tool Matchers')
      await waitForText(lastFrame, '[Local] clear')
      await moveCursorToItem(lastFrame, stdin, '[Local] clear')
      stdin.write('\r')
      await waitForText(lastFrame, 'SessionStart - Matcher: clear')

      // Add a hook through save flow and ensure matcher is persisted.
      stdin.write('\r')
      await waitForText(lastFrame, 'Add new hook')
      for (let i = 0; i < 3; i += 1) await tick()
      await typeText(stdin, 'echo sessionstart-new')
      await waitForText(lastFrame, 'echo sessionstart-new')
      stdin.write('\r')
      await waitForText(lastFrame, 'Save hook configuration')
      stdin.write('\r')

      await waitForJsonContains(settingsPath, (parsed) => {
        const rules = parsed?.hooks?.SessionStart
        if (!Array.isArray(rules)) return false
        const rule = rules.find((entry: any) => entry?.matcher === 'clear')
        if (!rule) return false
        const hooks = rule?.hooks
        return Array.isArray(hooks) && hooks.some((hook: any) => hook?.command === 'echo sessionstart-new')
      })
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)

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
      await moveCursorToItem(lastFrame, stdin, '[Local] *')
      stdin.write('\r')
      await waitForText(lastFrame, 'PreToolUse - Matcher: *')
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 40000)

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
      const scopes: string[] = []
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <ActiveScopeSpy onScope={(s) => scopes.push(s)} />
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
      await moveCursorToItem(lastFrame, stdin, '[Local] Bash')
      stdin.write('\r')
      await waitForText(lastFrame, 'PreToolUse - Matcher: Bash')
      await tick()

      // Enter "Add new hook" and type with edits in the middle
      stdin.write('\r')
      await waitForText(lastFrame, 'Add new hook')
      await tick()
      await waitForScope(scopes, 'prompt:hooks-input')

      await typeText(stdin, '12345')
      await waitForText(lastFrame, '12345')
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

      const firstOverlayIdx = scopes.indexOf('overlay:hooks')
      expect(firstOverlayIdx).toBeGreaterThanOrEqual(0)
      expect(scopes.slice(firstOverlayIdx + 1)).not.toContain('repl')

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

  it('does not drop burst input when adding a hook command', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-hooks-burst-input-'))
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
      const scopes: string[] = []
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <ActiveScopeSpy onScope={(s) => scopes.push(s)} />
          <HooksDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Hooks')
      await waitForText(lastFrame, 'PreToolUse')
      await tick()

      // Enter PreToolUse event
      stdin.write('\r')
      await waitForText(lastFrame, 'PreToolUse - Tool Matchers')
      await waitForText(lastFrame, '[Local] Bash')
      await tick()

      // Enter Bash matcher (avoid assuming a single ↓ is always consumed under load)
      await moveCursorToItem(lastFrame, stdin, '[Local] Bash')
      stdin.write('\r')
      await waitForText(lastFrame, 'PreToolUse - Matcher: Bash')
      await tick()

      // Enter "Add new hook"
      stdin.write('\r')
      await waitForText(lastFrame, 'Add new hook')
      await waitForText(lastFrame, 'Command:')
      await tick()
      await waitForScope(scopes, 'prompt:hooks-input')

      // Burst typing: simulate a single buffered chunk arriving in one read.
      // (Ink/React scheduling can make per-keystroke synchronous writes flaky.)
      stdin.write('abc')
      // Don't assert the inline UI representation here; ink-testing-library can show intermediate
      // layout artifacts under burst input, but the persisted value must still be correct.

      // Confirm and ensure the saved summary contains the command.
      stdin.write('\r')
      await waitForText(lastFrame, 'Save hook configuration')
      await waitForText(lastFrame, 'Command: abc')

      const firstOverlayIdx = scopes.indexOf('overlay:hooks')
      expect(firstOverlayIdx).toBeGreaterThanOrEqual(0)
      expect(scopes.slice(firstOverlayIdx + 1)).not.toContain('repl')
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

      // Delete the new hook: navigate to the new command entry deterministically.
      await waitForText(lastFrame, newCmd)
      await moveCursorToItem(lastFrame, stdin, newCmd)
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

      await moveCursorToItem(lastFrame, stdin, 'UserPromptSubmit')
      stdin.write('\r')

      // Should go straight to hook list (no matcher list)
      await waitForText(lastFrame, '+ Add new hook…')
      expect(lastFrame() || '').not.toContain('Tool Matchers')

      // Add new hook
      stdin.write('\r')
      await waitForText(lastFrame, 'Add new hook')
      expect(lastFrame() || '').not.toContain('Matcher:')
      // Let the input scope activate before typing, otherwise ink-testing-library can drop the first
      // chunk under full-suite + coverage load.
      for (let i = 0; i < 3; i += 1) await tick()

      const cmd = 'python3 .formax/hooks/user_prompt_submit_probe.py'
      for (const ch of cmd) {
        stdin.write(ch)
        await tick()
      }
      await waitForText(lastFrame, cmd)
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
      await waitForText(lastFrame, '+ Add new hook…')
      await moveCursorToItem(lastFrame, stdin, cmd)
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

  it('skips matcher screens for Stop and saves without matcher field', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-hooks-stop-'))
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
            Stop: [],
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
      const scopes: string[] = []
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <ActiveScopeSpy onScope={(s) => scopes.push(s)} />
          <HooksDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Hooks')
      await tick()

      await moveCursorToItem(lastFrame, stdin, 'Stop')
      stdin.write('\r')

      await waitForText(lastFrame, '+ Add new hook…')
      expect(lastFrame() || '').not.toContain('Tool Matchers')

      stdin.write('\r')
      await waitForText(lastFrame, 'Add new hook')
      expect(lastFrame() || '').not.toContain('Matcher:')
      await tick()
      await waitForScope(scopes, 'prompt:hooks-input')

      const cmd = 'python3 .formax/hooks/stop_probe.py'
      await typeText(stdin, cmd)
      await waitForText(lastFrame, cmd)
      stdin.write('\r')

      await waitForText(lastFrame, 'Save hook configuration')
      expect(lastFrame() || '').not.toContain('Matcher:')

      stdin.write('\r')

      await waitForJsonContains(settingsPath, (parsed) => {
        const rules = parsed?.hooks?.Stop
        if (!Array.isArray(rules)) return false
        const rule = rules.find((r: any) => r && typeof r === 'object' && !Array.isArray(r) && !('matcher' in r))
        const hooks = rule?.hooks
        return Array.isArray(hooks) && hooks.some((h: any) => h?.type === 'command' && h?.command === cmd)
      })

      // Wait for the dialog to reload from disk and render the newly saved hook.
      await waitForText(lastFrame, cmd)
      await waitForText(lastFrame, '+ Add new hook…')
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\r')
      await waitForText(lastFrame, 'Delete hook?')
      await waitForText(lastFrame, `Event: Stop`)
      expect(lastFrame() || '').not.toContain('Matcher:')
      stdin.write('\r')

      await waitForJsonContains(settingsPath, (parsed) => {
        const rules = parsed?.hooks?.Stop
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
