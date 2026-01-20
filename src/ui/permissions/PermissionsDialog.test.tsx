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
  throw new Error(`Timed out waiting for UI to contain: ${text}`)
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
  throw new Error(`Timed out waiting for UI to NOT contain: ${text}`)
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
        <InputScopeProvider initialScope="overlay:permissions">
          <PermissionsDialog onExit={onExit} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Add a new rule')

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
        <InputScopeProvider initialScope="overlay:permissions">
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
        <InputScopeProvider initialScope="overlay:permissions">
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
      const onExit = vi.fn()
      const { lastFrame, stdin } = render(
        <InputScopeProvider initialScope="overlay:permissions">
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

      await waitForJsonContains(settingsPath, (parsed) => {
        const dirs = parsed?.permissions?.workspace?.additionalDirectories
        return Array.isArray(dirs) && dirs.some((d: any) => String(d ?? '').endsWith('/abXc'))
      })

      const persisted = JSON.parse(await readFile(settingsPath, 'utf8'))
      expect(persisted.permissions.workspace.additionalDirectories).toContain(expectedDir)
    } finally {
      process.chdir(originalCwd)
      if (originalConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
      else process.env.FORMAX_CONFIG_DIR = originalConfigDir
    }
  }, 15000)
})
