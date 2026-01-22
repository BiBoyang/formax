import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PermissionsDialog } from './PermissionsDialog'
import { InputScopeProvider } from '../../features/repl/inputScopeContext'

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

async function waitForNoText(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 5000,
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
  timeoutMs = 5000,
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

      for (let i = 0; i < 12; i++) {
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
  }, 15000)

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
  }, 15000)

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

      stdin.write('\u001B[D')
      await tick()
      stdin.write('\u001B[D')
      await tick()

      expect(lastFrame()).toContain('abc▏de')

      stdin.write('\x7f')
      await tick()
      expect(lastFrame()).toContain('ab▏de')

      stdin.write('X')
      await tick()
      expect(lastFrame()).toContain('abX▏de')
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 15000)

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
      stdin.write('\r')
      await waitForText(lastFrame, 'Enter permission rule')
      await tick()

      // Type: abc, move cursor left once, insert X -> abXc
      stdin.write('a')
      await tick()
      stdin.write('b')
      await tick()
      stdin.write('c')
      await tick()
      stdin.write('\u001B[D')
      await tick()
      stdin.write('X')
      await tick()

      // Submit (handled by dialog, not TextInput)
      stdin.write('\r')
      await waitForNoText(lastFrame, 'Enter permission rule')

      // Allow now also asks where to save.
      await waitForText(lastFrame, 'Where should this rule be saved?')
      // Sanity: arrow navigation works on this view.
      stdin.write('\u001B[B')
      await tick()
      await waitForText(lastFrame, '❯ 2.')
      // Move back to the default option (project local) before confirming.
      stdin.write('\u001B[A')
      await tick()
      await waitForText(lastFrame, '❯ 1.')
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
  }, 15000)

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
      stdin.write('\t')
      await tick()
      stdin.write('\t')
      await tick()
      stdin.write('\t')
      await tick()

      // Enter Add Directory view
      stdin.write('\r')
      await waitForText(lastFrame, 'Add directory to workspace')
      await tick()

      // Type: abc, move cursor left once, insert X -> abXc
      stdin.write('a')
      await tick()
      stdin.write('b')
      await tick()
      stdin.write('c')
      await tick()
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

      await tick()
      await waitForText(lastFrame, 'Add a new rule')

      // Switch to Workspace tab (Allow -> Ask -> Deny -> Workspace)
      stdin.write('\t')
      await tick()
      stdin.write('\t')
      await tick()
      stdin.write('\t')
      await tick()

      await waitForText(lastFrame, 'Add directory')
      await waitForText(lastFrame, 'Original working directory')
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 15000)


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

      // Should be on Allow tab
      expect(lastFrame()).toContain('Allow')

      // Switch to Ask tab
      stdin.write('\t')
      await tick()
      await waitForText(lastFrame, 'Ask')

      // Switch to Deny tab
      stdin.write('\t')
      await tick()
      await waitForText(lastFrame, 'Deny')

      // Switch to Workspace tab
      stdin.write('\t')
      await tick()
      await waitForText(lastFrame, 'Workspace')

      // Switch back to Allow tab (cyclic)
      stdin.write('\t')
      await tick()
      await waitForText(lastFrame, 'Allow')
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 15000)


})
