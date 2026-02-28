import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { InputScopeProvider } from '../../features/repl/inputScopeContext.js'
import { __configDialogTestHooks, ConfigDialog } from './ConfigDialog.js'

function tick(): Promise<void> {
  // Under full-suite + coverage load (Ink 6 / React 19), input + frames can be batched/delayed.
  // A tiny delay keeps these UI/input tests deterministic.
  return new Promise((resolve) => setTimeout(resolve, 5))
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

async function moveCursorToRow(
  lastFrame: () => string | undefined,
  stdin: { write: (data: string) => void },
  rowLabel: string,
  maxMoves = 100,
): Promise<void> {
  // Rows in some sub-screens are prefixed with an index (e.g. "❯ 2. Explanatory").
  // Avoid `\\b` because some labels can end with punctuation, which makes word-boundary matching brittle.
  const re = new RegExp(`❯\\s*(?:\\d+\\.)?\\s*${escapeRegExp(rowLabel)}(?:\\s|$)`)

  const frame0 = lastFrame() || ''
  if (re.test(frame0)) return

  // The initial cursor can drift between tests under React 19 batching and Ink 6 rendering,
  // so allow both downward and upward search to make navigation deterministic.
  for (let i = 0; i < maxMoves; i++) {
    stdin.write('\u001B[B')
    await tick()
    const frame = lastFrame() || ''
    if (re.test(frame)) return
  }

  for (let i = 0; i < maxMoves; i++) {
    stdin.write('\u001B[A')
    await tick()
    const frame = lastFrame() || ''
    if (re.test(frame)) return
  }

  const frame = lastFrame() || ''
  throw new Error(`Failed to move cursor to row: ${rowLabel}\n\nLast frame:\n${frame}`)
}

function expectActiveRowValue(frame: string | undefined, label: string, value: string): void {
  const f = frame || ''
  const re = new RegExp(`❯\\s*${escapeRegExp(label)}\\s+.*\\b${escapeRegExp(value)}\\b`)
  expect(f).toMatch(re)
}

async function waitForActiveRowValue(
  lastFrame: () => string | undefined,
  label: string,
  value: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now()
  const re = new RegExp(`❯\\s*${escapeRegExp(label)}\\s+.*\\b${escapeRegExp(value)}\\b`)
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (re.test(frame)) return
    await tick()
  }
  const finalFrame = lastFrame() || ''
  throw new Error(
    `Timed out waiting for active row value: ${label} = ${value}\n\nLast frame:\n${finalFrame}`,
  )
}

describe('ConfigDialog', () => {
  async function withTempConfigDirs<T>(fn: (args: { env: NodeJS.ProcessEnv; cwd: string }) => Promise<T>) {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-config-'))
    const cwd = path.join(base, 'project')
    const configDir = path.join(base, 'user')
    await fs.mkdir(cwd, { recursive: true })
    await fs.mkdir(configDir, { recursive: true })
    const env: NodeJS.ProcessEnv = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    try {
      return await fn({ env, cwd })
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  }

  it(
    'renders default values with sources (Default)',
    async () => {
      await withTempConfigDirs(async ({ env, cwd }) => {
        const onExit = vi.fn()
        const { lastFrame } = render(
          <InputScopeProvider>
            <ConfigDialog onExit={onExit} env={env} cwd={cwd} />
          </InputScopeProvider>,
        )

        await waitForText(lastFrame, 'Settings:')
        await waitForText(lastFrame, 'Configure Formax preferences')
        await waitForText(lastFrame, 'Thinking mode')
        await waitForText(lastFrame, 'Verbose output')
        await waitForText(lastFrame, 'Output style')
        await waitForText(lastFrame, '(Default)')
      })
    },
    20_000,
  )

  it(
    'saving Output style persists to Project and shows Project source',
    async () => {
      await withTempConfigDirs(async ({ env, cwd }) => {
        const onExit = vi.fn()
        const { lastFrame, stdin } = render(
          <InputScopeProvider>
            <ConfigDialog onExit={onExit} env={env} cwd={cwd} />
          </InputScopeProvider>,
        )

        await waitForText(lastFrame, 'Configure Formax preferences')

        // Move to "Output style" (3rd row) and open selection.
        await moveCursorToRow(lastFrame, stdin, 'Output style')
        stdin.write('\r')
        await waitForText(lastFrame, 'Preferred output style')

        // Select "Learning".
        await moveCursorToRow(lastFrame, stdin, 'Learning')
        stdin.write('\r')

        await waitForText(lastFrame, 'Configure Formax preferences')
        await waitForText(lastFrame, 'Output style')
        await waitForText(lastFrame, 'Learning')
        await waitForText(lastFrame, '(Project)')

        const projectConfigPath = path.join(cwd, '.formax', 'config.json')
        const raw = await fs.readFile(projectConfigPath, 'utf8')
        const parsed = JSON.parse(raw)
        expect(parsed.version).toBe(1)
        expect(parsed.ui).toEqual({ outputStyle: 'learning' })
      })
    },
    20_000,
  )

  it(
    'saving Thinking mode persists to User and sparse-write removes defaults',
    async () => {
      await withTempConfigDirs(async ({ env, cwd }) => {
        const onExit = vi.fn()
        const { lastFrame, stdin } = render(
          <InputScopeProvider>
            <ConfigDialog onExit={onExit} env={env} cwd={cwd} />
          </InputScopeProvider>,
        )

        await waitForText(lastFrame, 'Configure Formax preferences')
        await waitForText(lastFrame, 'Thinking mode')

        // Toggle Thinking mode (default true -> false).
        stdin.write('\r')
        await waitForText(lastFrame, 'false')
        await waitForText(lastFrame, '(User)')

        const userConfigPath = path.join(env.FORMAX_CONFIG_DIR || '', 'config.json')
        let raw = await fs.readFile(userConfigPath, 'utf8')
        let parsed = JSON.parse(raw)
        expect(parsed.version).toBe(1)
        expect(parsed.llm).toEqual({ thinkingMode: false })

        // Toggle back to default true => key is removed (sparse write).
        stdin.write('\r')
        await waitForText(lastFrame, 'true')

        raw = await fs.readFile(userConfigPath, 'utf8')
        parsed = JSON.parse(raw)
        expect(parsed.version).toBe(1)
        expect(parsed.llm).toBeUndefined()
      })
    },
    20_000,
  )

  it(
    'reopening reads back persisted values',
    async () => {
      await withTempConfigDirs(async ({ env, cwd }) => {
        const store = createNodeFileStore()

        // Seed both config files.
        await fs.mkdir(path.join(cwd, '.formax'), { recursive: true })
        await store.writeJsonAtomic(path.join(cwd, '.formax', 'config.json'), {
          version: 1,
          ui: { outputStyle: 'explanatory' },
        })
        await store.writeJsonAtomic(path.join(env.FORMAX_CONFIG_DIR || '', 'config.json'), {
          version: 1,
          llm: { thinkingMode: false },
          ui: { verboseOutput: true },
        })

        const onExit = vi.fn()
        const { lastFrame } = render(
          <InputScopeProvider>
            <ConfigDialog onExit={onExit} env={env} cwd={cwd} />
          </InputScopeProvider>,
        )

        await waitForText(lastFrame, 'Configure Formax preferences')
        await waitForText(lastFrame, 'Output style')
        await waitForText(lastFrame, 'Explanatory')
        await waitForText(lastFrame, '(Project)')
        await waitForText(lastFrame, 'Thinking mode')
        await waitForText(lastFrame, 'false')
        await waitForText(lastFrame, '(User)')
        await waitForText(lastFrame, 'Verbose output')
        await waitForText(lastFrame, 'true')
      })
    },
    20_000,
  )

  it(
    'closes on Escape from main list with dismissed exit kind by default',
    async () => {
      const onExit = vi.fn()
      await withTempConfigDirs(async ({ env, cwd }) => {
        const { lastFrame, stdin } = render(
          <InputScopeProvider>
            <ConfigDialog onExit={onExit} env={env} cwd={cwd} />
          </InputScopeProvider>,
        )

        await waitForText(lastFrame, 'Settings:')
        stdin.write('\u001B')
        await tick()

        expect(onExit).toHaveBeenCalledWith({ kind: 'dismissed' })
      })
    },
    20_000,
  )

  it('cycles tabs with Tab', async () => {
    const onExit = vi.fn()
    await withTempConfigDirs(async ({ env, cwd }) => {
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <ConfigDialog onExit={onExit} env={env} cwd={cwd} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Configure Formax preferences')
      stdin.write('\t')
      await waitForText(lastFrame, 'Usage')
      stdin.write('\t')
      await waitForText(lastFrame, 'Status')
      expect(onExit).toHaveBeenCalledTimes(0)
    })
  })

  it('closes output-style sub-view on Esc without exiting overlay', async () => {
    const onExit = vi.fn()
    await withTempConfigDirs(async ({ env, cwd }) => {
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <ConfigDialog onExit={onExit} env={env} cwd={cwd} />
        </InputScopeProvider>,
      )

      await waitForText(lastFrame, 'Configure Formax preferences')
      await moveCursorToRow(lastFrame, stdin, 'Output style')
      stdin.write('\r')
      await waitForText(lastFrame, 'Preferred output style')
      stdin.write('\u001B')
      await waitForNoText(lastFrame, 'Preferred output style')
      expect(onExit).toHaveBeenCalledTimes(0)
    })
  })

  it('shows load and persist errors from injected service', async () => {
    const onExit = vi.fn()
    const service = {
      load: vi
        .fn()
        .mockRejectedValueOnce(new Error('load fail'))
        .mockResolvedValue({
          values: { outputStyle: 'default', thinkingMode: true, verboseOutput: false },
          sources: { outputStyle: 'Default', thinkingMode: 'Default', verboseOutput: 'Default' },
        }),
      persist: vi.fn().mockRejectedValue(new Error('persist fail')),
    }

    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} service={service as any} />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Error: load fail')
    // Trigger a persist attempt on Thinking mode row.
    stdin.write('\r')
    await waitForText(lastFrame, 'Error: persist fail')
  })

  it('handles string-shaped load/persist errors', async () => {
    const onExit = vi.fn()
    const service = {
      load: vi
        .fn()
        .mockRejectedValueOnce('load fail string')
        .mockResolvedValue({
          values: { outputStyle: 'default', thinkingMode: true, verboseOutput: false },
          sources: { outputStyle: 'Default', thinkingMode: 'Default', verboseOutput: 'Default' },
        }),
      persist: vi.fn().mockRejectedValue('persist fail string'),
    }

    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} service={service as any} />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'Error: load fail string')
    stdin.write('\r')
    await waitForText(lastFrame, 'Error: persist fail string')
  })

  it('returns changed exit payload after successful update then Esc', async () => {
    const onExit = vi.fn()
    const service = {
      load: vi.fn().mockResolvedValue({
        values: { outputStyle: 'default', thinkingMode: true, verboseOutput: false },
        sources: { outputStyle: 'Default', thinkingMode: 'Default', verboseOutput: 'Default' },
      }),
      persist: vi.fn().mockResolvedValue(undefined),
    }

    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} service={service as any} />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'Configure Formax preferences')
    stdin.write('\r') // toggle thinking mode true -> false
    await tick()
    stdin.write('\u001B')
    await tick()
    expect(onExit).toHaveBeenCalledWith({ kind: 'changed', message: 'Set thinking mode to false' })
  })

  it('ignores non-handled keys on list view', async () => {
    const onExit = vi.fn()
    await withTempConfigDirs(async ({ env, cwd }) => {
      const { lastFrame, stdin } = render(
        <InputScopeProvider>
          <ConfigDialog onExit={onExit} env={env} cwd={cwd} />
        </InputScopeProvider>,
      )
      await waitForText(lastFrame, 'Configure Formax preferences')
      const before = lastFrame() || ''
      stdin.write('x')
      await tick()
      expect(lastFrame() || '').toContain('Configure Formax preferences')
      expect(onExit).toHaveBeenCalledTimes(0)
      expect(before.length).toBeGreaterThan(0)
    })
  })

  it('handles Enter on status tab (no rows) as a safe no-op', async () => {
    const onExit = vi.fn()
    const service = {
      load: vi.fn().mockResolvedValue({
        values: { outputStyle: 'default', thinkingMode: true, verboseOutput: false },
        sources: { outputStyle: 'Default', thinkingMode: 'Default', verboseOutput: 'Default' },
      }),
      persist: vi.fn().mockResolvedValue(undefined),
    }

    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} service={service as any} />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Configure Formax preferences')
    stdin.write('\t') // usage
    await waitForText(lastFrame, 'Usage')
    await waitForNoText(lastFrame, 'Configure Formax preferences')
    stdin.write('\t') // status
    await waitForText(lastFrame, 'Status')
    await waitForNoText(lastFrame, 'Configure Formax preferences')
    stdin.write('\r')
    await tick()
    await waitForText(lastFrame, 'Status')
    expect(onExit).toHaveBeenCalledTimes(0)
    expect(service.persist).toHaveBeenCalledTimes(0)
  })

  it('confirms output style selection with Space', async () => {
    const onExit = vi.fn()
    const service = {
      load: vi.fn().mockResolvedValue({
        values: { outputStyle: 'default', thinkingMode: true, verboseOutput: false },
        sources: { outputStyle: 'Default', thinkingMode: 'Default', verboseOutput: 'Default' },
      }),
      persist: vi.fn().mockResolvedValue(undefined),
    }

    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} service={service as any} />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Configure Formax preferences')
    await moveCursorToRow(lastFrame, stdin, 'Output style')
    stdin.write('\r')
    await waitForText(lastFrame, 'Preferred output style')
    await moveCursorToRow(lastFrame, stdin, 'Explanatory')
    stdin.write(' ')
    await waitForText(lastFrame, 'Configure Formax preferences')
    expect(service.persist).toHaveBeenCalledWith({ id: 'outputStyle', value: 'explanatory' })
    expect(onExit).toHaveBeenCalledTimes(0)
  })

  it('falls back to Default source label when snapshot omits a source', async () => {
    const onExit = vi.fn()
    const service = {
      load: vi.fn().mockResolvedValue({
        values: { outputStyle: 'default', thinkingMode: true, verboseOutput: false },
        sources: { thinkingMode: 'User', verboseOutput: 'Project' } as any,
      }),
      persist: vi.fn().mockResolvedValue(undefined),
    }

    const { lastFrame } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} service={service as any} />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Configure Formax preferences')
    await waitForText(lastFrame, 'Output style')
    await waitForText(lastFrame, '(Default)')
  })

  it('ignores non-handled keys in output-style selection view', async () => {
    const onExit = vi.fn()
    const service = {
      load: vi.fn().mockResolvedValue({
        values: { outputStyle: 'default', thinkingMode: true, verboseOutput: false },
        sources: { outputStyle: 'Default', thinkingMode: 'Default', verboseOutput: 'Default' },
      }),
      persist: vi.fn().mockResolvedValue(undefined),
    }

    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} service={service as any} />
      </InputScopeProvider>,
    )

    await waitForText(lastFrame, 'Configure Formax preferences')
    await moveCursorToRow(lastFrame, stdin, 'Output style')
    stdin.write('\r')
    await waitForText(lastFrame, 'Preferred output style')
    stdin.write('x')
    await tick()
    await waitForText(lastFrame, 'Preferred output style')
    expect(service.persist).toHaveBeenCalledTimes(0)
    expect(onExit).toHaveBeenCalledTimes(0)
  })

  it('uses row.getValue fallback when service snapshot omits stored value', async () => {
    const onExit = vi.fn()
    const service = {
      load: vi.fn().mockResolvedValue({
        values: { outputStyle: 'default', verboseOutput: false } as any,
        sources: { outputStyle: 'Default', thinkingMode: 'Default', verboseOutput: 'Default' },
      }),
      persist: vi.fn().mockResolvedValue(undefined),
    }
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} service={service as any} />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'Configure Formax preferences')
    await waitForText(lastFrame, 'Thinking mode')
    stdin.write('\r')
    await tick()
    expect(service.persist).toHaveBeenCalledWith({ id: 'thinkingMode', value: false })
  })

  it('uses row.getValue fallback for verboseOutput when value is omitted', async () => {
    const onExit = vi.fn()
    const service = {
      load: vi.fn().mockResolvedValue({
        values: { outputStyle: 'default', thinkingMode: true } as any,
        sources: { outputStyle: 'Default', thinkingMode: 'Default', verboseOutput: 'Default' },
      }),
      persist: vi.fn().mockResolvedValue(undefined),
    }
    const { lastFrame, stdin } = render(
      <InputScopeProvider>
        <ConfigDialog onExit={onExit} service={service as any} />
      </InputScopeProvider>,
    )
    await waitForText(lastFrame, 'Configure Formax preferences')
    stdin.write('\u001B[B')
    await tick()
    stdin.write('\r')
    await tick()
    expect(service.persist).toHaveBeenCalledWith({ id: 'verboseOutput', value: true })
  })

  it('covers dialog helper hooks', () => {
    expect(__configDialogTestHooks.nextTab('config', 1)).toBe('usage')
    expect(__configDialogTestHooks.nextTab('config', -1)).toBe('status')
    expect(__configDialogTestHooks.nextTab('unknown' as any, 1)).toBe('status')

    expect(__configDialogTestHooks.clamp(Number.NaN, 1, 3)).toBe(1)
    expect(__configDialogTestHooks.clamp(0, 1, 3)).toBe(1)
    expect(__configDialogTestHooks.clamp(9, 1, 3)).toBe(3)

    expect(__configDialogTestHooks.formatChangeMessage('outputStyle', 'learning')).toContain('Learning')
    expect(__configDialogTestHooks.formatChangeMessage('outputStyle', 'unknown')).toContain('Default')
    expect(__configDialogTestHooks.formatChangeMessage('thinkingMode', true)).toContain('true')
    expect(__configDialogTestHooks.formatChangeMessage('verboseOutput', true)).toContain('true')

    expect(__configDialogTestHooks.isConfigDialogSettingId('outputStyle')).toBe(true)
    expect(__configDialogTestHooks.isConfigDialogSettingId('x')).toBe(false)
  })
})
