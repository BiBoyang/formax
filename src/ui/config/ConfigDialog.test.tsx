import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { InputScopeProvider } from '../../features/repl/inputScopeContext.js'
import { ConfigDialog } from './ConfigDialog.js'

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
            <ConfigDialog onExit={onExit} env={env} cwd={cwd} fileStore={createNodeFileStore()} />
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
        const store = createNodeFileStore()
        const { lastFrame, stdin } = render(
          <InputScopeProvider>
            <ConfigDialog onExit={onExit} env={env} cwd={cwd} fileStore={store} />
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
        const store = createNodeFileStore()
        const { lastFrame, stdin } = render(
          <InputScopeProvider>
            <ConfigDialog onExit={onExit} env={env} cwd={cwd} fileStore={store} />
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
            <ConfigDialog onExit={onExit} env={env} cwd={cwd} fileStore={store} />
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
      const store = createNodeFileStore()
      await withTempConfigDirs(async ({ env, cwd }) => {
        const { lastFrame, stdin } = render(
          <InputScopeProvider>
            <ConfigDialog onExit={onExit} env={env} cwd={cwd} fileStore={store} />
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
})
