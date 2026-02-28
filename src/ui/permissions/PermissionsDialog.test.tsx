import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PermissionsDialog } from './PermissionsDialog'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'
import {
  addWorkspaceSessionDirectory,
  listWorkspaceSessionDirectories,
  resetWorkspaceSessionForTests,
} from '../../adapters/permissions/workspaceSession.js'

function tick(): Promise<void> {
  // Under full-suite + coverage load (Ink 6 / React 19), input + frames can be batched/delayed.
  // A tiny delay keeps these UI/input tests deterministic.
  return new Promise((resolve) => setTimeout(resolve, 5))
}

async function waitForText(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 15000,
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
  throw new Error(`Timed out waiting for JSON predicate to be true: ${filePath}`)
}

async function waitForRuleInAnySettings(
  filePaths: string[],
  rule: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const fp of filePaths) {
      try {
        const raw = await readFile(fp, 'utf8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed?.permissions?.allow) && parsed.permissions.allow.includes(rule)) return
      } catch {
        // ignore missing/invalid files until timeout
      }
    }
    await tick()
  }
  throw new Error(`Timed out waiting for rule "${rule}" in any settings file:\n${filePaths.join('\n')}`)
}

function isActiveRow(frame: string, rowText: string): boolean {
  return frame
    .split('\n')
    .some((line) => line.includes(rowText) && (line.includes('❯') || line.includes('>')))
}

async function moveDownUntilActiveRow(
  lastFrame: () => string | undefined,
  stdin: { write: (data: string) => void },
  rowText: string,
  maxMoves = 40,
): Promise<void> {
  for (let i = 0; i < maxMoves; i++) {
    const frame = lastFrame() || ''
    if (isActiveRow(frame, rowText)) return
    stdin.write('\u001B[B')
    await tick()
  }
  throw new Error(`Failed to move selection to row: ${rowText}\n\nLast frame:\n${lastFrame() || ''}`)
}

async function pressTabUntilText(
  lastFrame: () => string | undefined,
  stdin: { write: (data: string) => void },
  text: string,
  maxTabs = 8,
): Promise<void> {
  for (let i = 0; i < maxTabs; i++) {
    if ((lastFrame() || '').includes(text)) return
    stdin.write('\t')
    await tick()
    await tick()
  }
  throw new Error(`Failed to reach tab containing: ${text}\n\nLast frame:\n${lastFrame() || ''}`)
}

async function pressEnterUntilText(
  lastFrame: () => string | undefined,
  stdin: { write: (data: string) => void },
  text: string,
  maxAttempts = 5,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    if ((lastFrame() || '').includes(text)) return
    stdin.write('\r')
    await tick()
    await tick()
  }
  throw new Error(`Failed to reach view containing: ${text}\n\nLast frame:\n${lastFrame() || ''}`)
}

async function typeText(
  stdin: { write: (data: string) => void },
  text: string,
): Promise<void> {
  for (const ch of text) {
    stdin.write(ch)
    await tick()
  }
}

describe('PermissionsDialog', () => {
  it('limits long rule lists to 10 rows and shows scroll indicators', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-long-list-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    const allow = Array.from({ length: 20 }, (_, i) => `Rule ${String(i + 1).padStart(2, '0')}`)
    await writeFile(
      path.join(projectConfigDir, 'settings.local.json'),
      JSON.stringify(
        {
          version: 1,
          permissions: {
            allow,
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
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
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Add a new rule')
      await waitForText(lastFrame, 'Rule 01')

      const initial = lastFrame() || ''
      expect(initial).not.toContain('Rule 20')
      expect(initial).toMatch(/\n│\s*↓\s+10\.\s/)

      // Scroll far enough that the list window shifts from 1-10 to 2-11.
      // In some environments, arrow sequences can be dropped/batched, so scroll until the window shifts.
      for (let i = 0; i < 50; i++) {
        stdin.write('\u001B[B')
        await tick()
        const frame = lastFrame() || ''
        if (!frame.includes('Add a new rule...') && /\b11\.\s+Rule 10\b/.test(frame)) break
      }

      await waitForNoText(lastFrame, 'Add a new rule...')
      await waitForText(lastFrame, 'Rule 10')

      const shifted = lastFrame() || ''
      expect(shifted).toMatch(/↑\s+\d+\.\s+Rule \d{2}/)
      expect(shifted).toMatch(/\b11\.\s+Rule 10\b/)

      // Continue scrolling to ensure we show "more above" indicator.
      for (let i = 0; i < 2; i++) {
        stdin.write('\u001B[B')
        await tick()
      }

      const scrolled = lastFrame() || ''
      expect(scrolled).toMatch(/\n│\s*↑\s+\d+\.\s/)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 30000)

  it('filters rules when using / search', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    await writeFile(
      path.join(projectConfigDir, 'settings.local.json'),
      JSON.stringify(
        {
          version: 1,
          permissions: {
            allow: ['WebFetch', 'Bash(ls:*)'],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
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
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Add a new rule')
      await waitForText(lastFrame, "Claude Code won't ask before using allowed tools.")

      // Sanity: arrow navigation works (ensures input wiring is alive)
      stdin.write('\u001B[B')
      await waitForText(lastFrame, 'WebFetch')

      stdin.write('/')
      await waitForText(lastFrame, 'Search:')
      stdin.write('w')
      await tick()
      stdin.write('e')
      await tick()
      stdin.write('b')
      await tick()
      await waitForText(lastFrame, 'Search: ')

      const frame = lastFrame() || ''
      expect(frame).toContain('Search:')
      expect(frame).toContain('WebFetch')
      expect(frame).not.toContain('Bash(ls:*)')

      // Enter should be consumed by the search input (must not trigger list selection/tab changes/close).
      stdin.write('\r')
      await tick()
      expect(lastFrame() || '').toContain('Search:')
      expect(onExit).toHaveBeenCalledTimes(0)

      // Toggle search off
      stdin.write('/')
      await waitForNoText(lastFrame, 'Search:')

      const cleared = lastFrame() || ''
      expect(cleared).not.toContain('Search:')
      expect(cleared).toContain('WebFetch')
      expect(cleared).toContain('Bash(ls:*)')
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 30000)

  it('supports cursor movement and deletion in / search input', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-search-cursor-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    await writeFile(
      path.join(projectConfigDir, 'settings.local.json'),
      JSON.stringify(
        {
          version: 1,
          permissions: {
            allow: ['WebFetch', 'Bash(ls:*)'],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
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
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Add a new rule')

      await waitForText(lastFrame, 'WebFetch')

      stdin.write('/')
      await waitForText(lastFrame, 'Search:')
      await tick()

      for (const ch of 'abcde') {
        stdin.write(ch)
        await tick()
      }
      await waitForText(lastFrame, 'Search: abcde')

      stdin.write('\u001B[D')
      await tick()
      stdin.write('\u001B[D')
      await tick()

      await waitForText(lastFrame, 'Search: abc▏de')

      stdin.write('\x7f')
      await waitForText(lastFrame, 'Search: ab▏de')

      stdin.write('X')
      await waitForText(lastFrame, 'Search: abX▏de')
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 30000)

  it('supports cursor movement when editing rule input', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-cursor-'))
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
          permissions: {
            allow: [],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
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
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await tick()
      await waitForText(lastFrame, 'Add a new rule')

      // Enter Add Rule view
      await pressEnterUntilText(lastFrame, stdin, 'Enter permission rule')
      stdin.write('\u001B[A')
      await tick()
      await waitForText(lastFrame, 'Enter permission rule')

      // Type: abc, move cursor left once, insert X -> abXc
      await typeText(stdin, 'abc')
      await waitForText(lastFrame, 'abc')
      stdin.write('\u001B[D')
      await tick()
      stdin.write('X')
      await tick()

      // Submit (handled by dialog, not TextInput)
      stdin.write('\r')
      await waitForNoText(lastFrame, 'Enter permission rule')

      // Allow now also asks where to save.
      await waitForText(lastFrame, 'Where should this rule be saved?')
      stdin.write('\r') // accept default (project local)
      await waitForNoText(lastFrame, 'Where should this rule be saved?')

      await waitForJsonContains(settingsPath, (parsed) => Array.isArray(parsed?.permissions?.allow) && parsed.permissions.allow.length > 0)

      const persisted = JSON.parse(await readFile(settingsPath, 'utf8'))
      expect(persisted.permissions.allow).toContain('abXc')
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 30000)

  it('supports cursor movement when editing directory input', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-dir-cursor-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })
    await mkdir(path.join(projectRoot, 'abXc'), { recursive: true })

    const settingsPath = path.join(projectConfigDir, 'settings.local.json')
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          version: 1,
          permissions: {
            allow: [],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
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
      const expectedDir = path.join(process.cwd(), 'abXc')
      await mkdir(expectedDir, { recursive: true })
      const onExit = vi.fn()
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await tick()
      await waitForText(lastFrame, 'Add a new rule')

      // Switch to Workspace tab (Allow -> Ask -> Deny -> Workspace)
      await pressTabUntilText(lastFrame, stdin, 'Add directory')

      // Enter Add Directory view
      await pressEnterUntilText(lastFrame, stdin, 'Add directory to workspace')
      stdin.write('\u001B[A')
      await tick()
      await waitForText(lastFrame, 'Add directory to workspace')

      // Type: abc, move cursor left once, insert X -> abXc
      await typeText(stdin, 'abc')
      await waitForText(lastFrame, 'abc')
      stdin.write('\u001B[D')
      await tick()
      stdin.write('X')
      await tick()

      // Submit
      stdin.write('\r')
      await waitForNoText(lastFrame, 'Add directory to workspace')

      // UI wraps long absolute paths; assert on the unique tail instead of the full path.
      await waitForText(lastFrame, path.basename(expectedDir))

      const persisted = JSON.parse(await readFile(settingsPath, 'utf8'))
      expect(persisted.permissions.workspace.additionalDirectories).toEqual([])
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 15000)

  it('supports deleting an existing allow rule via confirmation prompt', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-delete-'))
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
          permissions: {
            allow: ['WebFetch'],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
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
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Add a new rule')
      await waitForText(lastFrame, 'WebFetch')

      // Move to the rule and press enter to delete.
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\r')

      await waitForText(lastFrame, 'Delete allowed tool?')
      await waitForText(lastFrame, 'Are you sure you want to delete this permission rule?')

      // Confirm "Yes" (default selection)
      stdin.write('\r')

      await waitForJsonContains(settingsPath, (parsed) => Array.isArray(parsed?.permissions?.allow) && parsed.permissions.allow.length === 0)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 15000)

  it('allows canceling delete confirmation and keeps the rule', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-delete-cancel-'))
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
          permissions: {
            allow: ['KeepMe'],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
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
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'KeepMe')
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\r')
      await waitForText(lastFrame, 'Delete allowed tool?')

      // non-handled key in confirm view should no-op (covers confirm trailing return)
      stdin.write('x')
      await tick()
      await waitForText(lastFrame, 'Delete allowed tool?')

      // Move to "No" and confirm cancel.
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\r')
      await waitForText(lastFrame, 'KeepMe')
      const persisted = JSON.parse(await readFile(settingsPath, 'utf8'))
      expect(persisted.permissions.allow).toContain('KeepMe')
      expect(onExit).toHaveBeenCalledTimes(0)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 20000)

  it('moves save-scope cursor with arrows before saving a rule', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-save-scope-arrows-'))
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
          permissions: {
            allow: [],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
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
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Add a new rule')
      await pressEnterUntilText(lastFrame, stdin, 'Enter permission rule')
      await typeText(stdin, 'ArrowScoped')
      stdin.write('\r')
      await waitForText(lastFrame, 'Where should this rule be saved?')
      stdin.write('x')
      await tick()
      await waitForText(lastFrame, 'Where should this rule be saved?')
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\r')
      stdin.write('\n')
      await waitForNoText(lastFrame, 'Where should this rule be saved?')

      await waitForRuleInAnySettings(
        [
          path.join(projectConfigDir, 'settings.local.json'),
          path.join(projectConfigDir, 'settings.json'),
          path.join(globalConfigDir, 'settings.json'),
        ],
        'ArrowScoped',
      )
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 30000)

  it('shows the original working directory in the workspace tab', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-workspace-root-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    await writeFile(
      path.join(projectConfigDir, 'settings.local.json'),
      JSON.stringify(
        {
          version: 1,
          permissions: {
            allow: [],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
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
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Add a new rule')
      await waitForText(lastFrame, "Claude Code won't ask before using allowed tools.")

      // Switch to Workspace tab (Allow -> Ask -> Deny -> Workspace)
      stdin.write('\t')
      await waitForText(lastFrame, 'Claude Code will always ask for confirmation before using these tools.')
      stdin.write('\t')
      await waitForText(lastFrame, 'Claude Code will always reject requests to use denied tools.')
      stdin.write('\t')
      await waitForText(lastFrame, 'Claude Code can read files in the workspace, and make edits when auto-accept edits is on.')

      await waitForText(lastFrame, 'Add directory')
      await waitForText(lastFrame, 'Original working directory')
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 30000)


  it('switches tabs with Tab key', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-tabs-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    await writeFile(
      path.join(projectConfigDir, 'settings.local.json'),
      JSON.stringify(
        {
          version: 1,
          permissions: {
            allow: ['AllowOnly'],
            ask: ['AskOnly'],
            deny: ['DenyOnly'],
            workspace: { additionalDirectories: [] },
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
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Add a new rule')
      await waitForText(lastFrame, 'AllowOnly')

      // Should be on Allow tab
      expect(lastFrame()).toContain('Allow')
      expect(lastFrame()).toContain("Claude Code won't ask before using allowed tools.")

      // Switch to Ask tab
      stdin.write('\t')
      await tick()
      await waitForText(lastFrame, 'AskOnly')
      expect(lastFrame()).toContain('always ask')

      // Switch to Deny tab
      stdin.write('\t')
      await tick()
      await waitForText(lastFrame, 'DenyOnly')
      expect(lastFrame()).toContain('always reject')

      // Switch to Workspace tab
      stdin.write('\t')
      await tick()
      await waitForText(lastFrame, 'can read files in the workspace')
      expect(lastFrame()).toContain('can read files in the workspace')

      // Switch back to Allow tab (cyclic)
      stdin.write('\t')
      await tick()
      await waitForText(lastFrame, 'Allow')
      await waitForText(lastFrame, 'AllowOnly')
      expect(lastFrame()).toContain("Claude Code won't ask before using allowed tools.")
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 15000)

  it('supports deleting a workspace session directory via confirmation prompt', async () => {
    resetWorkspaceSessionForTests()

    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-workspace-delete-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })

    await writeFile(
      path.join(projectConfigDir, 'settings.local.json'),
      JSON.stringify(
        {
          version: 1,
          permissions: {
            allow: [],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    process.env.FORMAX_CONFIG_DIR = globalConfigDir
    process.chdir(projectRoot)

    // On macOS, `/var` is a symlink to `/private/var`. `process.cwd()` will
    // typically be the resolved path, so use it as the workspace session key.
    const effectiveProjectRoot = process.cwd()

    const sessionDir = path.join(effectiveProjectRoot, 'session-dir')
    await mkdir(sessionDir, { recursive: true })
    addWorkspaceSessionDirectory(effectiveProjectRoot, sessionDir)

    try {
      const onExit = vi.fn()
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await tick()
      await waitForText(lastFrame, 'Add a new rule')

      // Switch to Workspace tab (avoid assuming each Tab key is consumed)
      await pressTabUntilText(lastFrame, stdin, 'Add directory')
      await waitForText(lastFrame, 'Add directory')
      await waitForText(lastFrame, path.basename(sessionDir))

      // Select the session directory and delete it.
      await moveDownUntilActiveRow(lastFrame, stdin, path.basename(sessionDir))
      stdin.write('\r')

      await waitForText(lastFrame, 'Delete workspace directory?')
      await waitForText(lastFrame, 'Are you sure you want to remove this directory from the workspace?')

      // Confirm "Yes" (default selection)
      stdin.write('\r')
      await tick()

      await waitForNoText(lastFrame, path.basename(sessionDir))
      expect(listWorkspaceSessionDirectories(effectiveProjectRoot)).toHaveLength(0)
    } finally {
      resetWorkspaceSessionForTests()
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 30000)

  it('handles unmount before async load completes', async () => {
    const onExit = vi.fn()
    const { unmount } = render(
      <InputScopeProvider>
        <PermissionsDialog onExit={onExit} />
      </InputScopeProvider>,
    )
    unmount()
    await tick()
    expect(onExit).toHaveBeenCalledTimes(0)
  })

  it('handles Esc on sub-view vs list and ignores non-handled list keys', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-esc-paths-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })
    await writeFile(
      path.join(projectConfigDir, 'settings.local.json'),
      JSON.stringify(
        {
          version: 1,
          permissions: {
            allow: [],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
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
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )
      await waitForText(lastFrame, 'Add a new rule')
      stdin.write('x')
      await tick()
      await waitForText(lastFrame, 'Add a new rule')
      expect(onExit).toHaveBeenCalledTimes(0)

      stdin.write('\r')
      await waitForText(lastFrame, 'Enter permission rule')
      stdin.write('\u001B')
      await waitForNoText(lastFrame, 'Enter permission rule')
      expect(onExit).toHaveBeenCalledTimes(0)

      stdin.write('\u001B')
      await tick()
      expect(onExit).toHaveBeenCalledTimes(1)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 30000)

  it('shows source label when deleting a workspace directory', async () => {
    const originalCwd = process.cwd()
    const originalConfigDir = process.env.FORMAX_CONFIG_DIR

    const repoRoot = await mkdtemp(path.join(tmpdir(), 'formax-permissions-delete-projectlocal-dir-'))
    const projectRoot = path.join(repoRoot, 'repo')
    const projectConfigDir = path.join(projectRoot, '.formax')
    const globalConfigDir = path.join(repoRoot, 'global-formax')

    await mkdir(projectConfigDir, { recursive: true })
    await mkdir(globalConfigDir, { recursive: true })
    await writeFile(
      path.join(projectConfigDir, 'settings.local.json'),
      JSON.stringify(
        {
          version: 1,
          permissions: {
            allow: [],
            ask: [],
            deny: [],
            workspace: { additionalDirectories: [] },
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
      const localDir = path.join(projectRoot, 'local-delete-target')
      await mkdir(localDir, { recursive: true })

      const onExit = vi.fn()
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Add a new rule')
      await pressTabUntilText(lastFrame, stdin, 'Add directory')
      await pressEnterUntilText(lastFrame, stdin, 'Add directory to workspace')
      await typeText(stdin, localDir)
      stdin.write('\r')
      await waitForNoText(lastFrame, 'Add directory to workspace')
      await waitForText(lastFrame, path.basename(localDir))

      // Row 0 is "Add directory", row 1 is the newly added directory.
      stdin.write('\u001B[B')
      await tick()
      stdin.write('\r')
      await waitForText(lastFrame, 'Delete workspace directory?')
      await waitForText(lastFrame, 'From session')
      stdin.write('\u001B')
      await waitForNoText(lastFrame, 'Delete workspace directory?')
      expect(onExit).toHaveBeenCalledTimes(0)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 30000)


})
