#!/usr/bin/env node

import React from 'react'
import { PassThrough, Writable } from 'node:stream'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createSafeInkStdout, resetInkStaticOutputForStdout } from '../src/utils/inkStreams.js'
import type { RuntimeConfig } from '../src/env/config.js'
import type { ChatEngine } from '../src/chat/engine.js'
import type { PromptBlock, PromptMessage } from '../src/prompts/index.js'

class AnsiScreenModel {
  private readonly cols: number
  private readonly rows: number
  private buffer: string[][]
  private cursorRow = 0
  private cursorCol = 0

  constructor(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
    this.buffer = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ' '))
  }

  private clearAll() {
    for (let row = 0; row < this.rows; row++) {
      this.buffer[row] = Array.from({ length: this.cols }, () => ' ')
    }
    this.cursorRow = 0
    this.cursorCol = 0
  }

  private clearLineFromCursor() {
    const row = this.buffer[this.cursorRow]
    if (!row) return
    for (let col = this.cursorCol; col < this.cols; col++) row[col] = ' '
  }

  private clearEntireLine() {
    const row = this.buffer[this.cursorRow]
    if (!row) return
    for (let col = 0; col < this.cols; col++) row[col] = ' '
  }

  private lineFeed() {
    this.cursorRow++
    this.cursorCol = 0
    if (this.cursorRow < this.rows) return
    this.buffer.shift()
    this.buffer.push(Array.from({ length: this.cols }, () => ' '))
    this.cursorRow = this.rows - 1
  }

  private putChar(ch: string) {
    const row = this.buffer[this.cursorRow]
    if (!row || this.cursorCol >= this.cols) return
    row[this.cursorCol] = ch
    this.cursorCol = Math.min(this.cols - 1, this.cursorCol + 1)
  }

  private parseCsi(data: string, start: number): null | { params: string; final: string; nextIndex: number } {
    let index = start
    while (index < data.length) {
      const ch = data[index]!
      if (ch >= '@' && ch <= '~') {
        return { params: data.slice(start, index), final: ch, nextIndex: index + 1 }
      }
      index++
    }
    return null
  }

  private applyCsi(paramsRaw: string, final: string) {
    const params = paramsRaw.replace(/^\?/, '')
    const parts = params ? params.split(';') : []
    const nums = parts.map((part) => (part ? Number(part) : NaN))

    switch (final) {
      case 'm':
      case 'h':
      case 'l':
        return
      case 'H': {
        const row1 = Number.isFinite(nums[0]) ? (nums[0] as number) : 1
        const col1 = Number.isFinite(nums[1]) ? (nums[1] as number) : 1
        this.cursorRow = Math.max(0, Math.min(this.rows - 1, row1 - 1))
        this.cursorCol = Math.max(0, Math.min(this.cols - 1, col1 - 1))
        return
      }
      case 'A': {
        const n = Number.isFinite(nums[0]) ? (nums[0] as number) : 1
        this.cursorRow = Math.max(0, this.cursorRow - n)
        return
      }
      case 'B': {
        const n = Number.isFinite(nums[0]) ? (nums[0] as number) : 1
        this.cursorRow = Math.min(this.rows - 1, this.cursorRow + n)
        return
      }
      case 'C': {
        const n = Number.isFinite(nums[0]) ? (nums[0] as number) : 1
        this.cursorCol = Math.min(this.cols - 1, this.cursorCol + n)
        return
      }
      case 'D': {
        const n = Number.isFinite(nums[0]) ? (nums[0] as number) : 1
        this.cursorCol = Math.max(0, this.cursorCol - n)
        return
      }
      case 'G': {
        const col1 = Number.isFinite(nums[0]) ? (nums[0] as number) : 1
        this.cursorCol = Math.max(0, Math.min(this.cols - 1, col1 - 1))
        return
      }
      case 'J': {
        const mode = Number.isFinite(nums[0]) ? (nums[0] as number) : 0
        if (mode === 2 || mode === 3) this.clearAll()
        return
      }
      case 'K': {
        const mode = Number.isFinite(nums[0]) ? (nums[0] as number) : 0
        if (mode === 2) this.clearEntireLine()
        else this.clearLineFromCursor()
        return
      }
      default:
        return
    }
  }

  feed(data: string) {
    let index = 0
    while (index < data.length) {
      const ch = data[index]!

      if (ch === '\u001b') {
        const next = data[index + 1]
        if (next === '[') {
          const parsed = this.parseCsi(data, index + 2)
          if (!parsed) {
            index++
            continue
          }
          this.applyCsi(parsed.params, parsed.final)
          index = parsed.nextIndex
          continue
        }
        index += next ? 2 : 1
        continue
      }

      if (ch === '\r') {
        this.cursorCol = 0
        index++
        continue
      }

      if (ch === '\n') {
        this.lineFeed()
        index++
        continue
      }

      if (ch < ' ' || ch === '\u007f') {
        index++
        continue
      }

      this.putChar(ch)
      index++
    }
  }

  toString(): string {
    const lines = this.buffer.map((row) => row.join('').replace(/\s+$/g, ''))
    let end = lines.length
    while (end > 0 && lines[end - 1]!.trim() === '') end--
    return lines.slice(0, end).join('\n')
  }
}

class FakeStdout extends Writable {
  public readonly isTTY = true
  public readonly columns = 120
  public readonly rows = 40

  constructor(private readonly screen: AnsiScreenModel) {
    super()
  }

  _write(chunk: any, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    this.screen.feed(text)
    cb()
  }
}

class FakeStdin extends PassThrough {
  public readonly isTTY = true
  public isRaw = false

  setRawMode(mode: boolean) {
    this.isRaw = mode
    return this
  }

  ref() {
    return this
  }

  unref() {
    return this
  }

  resume() {
    return this
  }

  pause() {
    return this
  }
}

function getUserText(msg: PromptMessage): string {
  const content = msg.content as unknown
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const promptBlock = block as PromptBlock
      return promptBlock.type === 'text' ? String((promptBlock as { text?: unknown }).text ?? '') : ''
    })
    .join('')
}

const cfg: RuntimeConfig = {
  llm: {
    provider: 'anthropic',
    baseUrl: '',
    apiKey: '',
    model: 'surface-screen-model-stub',
    timeoutMs: 600000,
    thinkingMode: true,
  },
  paths: {
    logsDir: '',
    subagentsDir: '',
    planDir: '',
  },
  context: {
    effectiveContextWindowPercent: 0.95,
    autoCompactTokenLimitPercent: 0.9,
    baselineTokens: 12000,
    compactKeepLastTurns: 4,
    enableAutoCompact: true,
    autoCompactMinTurnsBetweenRuns: 8,
  },
  ui: {
    assistantTextMode: 'stream',
    promptProfile: 'lite',
    showContextMeter: true,
    showAutoCompactNotice: true,
    outputStyle: 'default',
    verboseOutput: false,
  },
}

async function waitForScreen(
  screen: AnsiScreenModel,
  predicate: (text: string) => boolean,
  label: string,
  timeoutMs = 10000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const text = screen.toString()
    if (predicate(text)) return text
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for screen: ${label}\n${screen.toString()}`)
}

async function waitForStableScreen(
  screen: AnsiScreenModel,
  label: string,
  idleMs = 250,
  timeoutMs = 12000,
): Promise<string> {
  const start = Date.now()
  let last = screen.toString()
  let lastChangeAt = Date.now()

  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    const next = screen.toString()
    if (next !== last) {
      last = next
      lastChangeAt = Date.now()
      continue
    }
    if (Date.now() - lastChangeAt >= idleMs) return next
  }

  throw new Error(`Timed out waiting for stable screen: ${label}\n${screen.toString()}`)
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let start = 0
  while (true) {
    const next = haystack.indexOf(needle, start)
    if (next === -1) return count
    count++
    start = next + needle.length
  }
}

function assertFinalScreen(args: { screenText: string; label: string }) {
  const { screenText, label } = args
  const modelCount = countOccurrences(screenText, 'Model:')
  const compactBannerCount = countOccurrences(screenText, 'Conversation compacted · ctrl+o for history')
  const compactSublineCount = countOccurrences(screenText, 'Compacted (ctrl+o to see full summary)')

  if (modelCount !== 1 || compactBannerCount !== 1 || compactSublineCount !== 1) {
    throw new Error(
      `[${label}] Unexpected final screen counts: Model=${modelCount}, compactBanner=${compactBannerCount}, compactSubline=${compactSublineCount}\n\n${screenText}`,
    )
  }
}

async function main() {
  const prevForceStatic = process.env.FORMAX_FORCE_INK_STATIC
  const prevConfigDir = process.env.FORMAX_CONFIG_DIR
  const prevCi = process.env.CI
  const prevContinuousIntegration = process.env.CONTINUOUS_INTEGRATION
  const tmpConfigDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-surface-screen-model-'))

  // Ink's CI mode suppresses dynamic frame writes. This smoke test needs full
  // terminal frame output to drive the ANSI screen model deterministically.
  delete process.env.CI
  delete process.env.CONTINUOUS_INTEGRATION

  const [{ render }, { REPL }, { InputScopeProvider }] = await Promise.all([
    import('ink'),
    import('../src/screens/REPL.js'),
    import('../src/features/repl/inputScopeContext.js'),
  ])

  process.env.FORMAX_FORCE_INK_STATIC = '1'
  process.env.FORMAX_CONFIG_DIR = tmpConfigDir

  const engine: ChatEngine = {
    async runTurn({ history, user, onEvent }) {
      const userText = getUserText(user)
      const isCompact = /Summarize the conversation/i.test(userText)
      const assistantText = isCompact ? 'SUMMARY' : `ECHO:${userText}`

      if (isCompact) {
        onEvent({ type: 'thinking_delta', thinking: 'compact-thought' })
        onEvent({ type: 'thinking_stop' })
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
      onEvent({ type: 'assistant_delta', text: assistantText })
      onEvent({ type: 'complete' })

      return [
        ...history,
        user,
        { role: 'assistant', content: [{ type: 'text', text: assistantText }] as PromptBlock[] },
      ]
    },
  }

  const screen = new AnsiScreenModel(120, 40)
  const stdout = new FakeStdout(screen)
  const safeStdout = createSafeInkStdout(stdout as any)
  const stdin = new FakeStdin()
  let instance: { clear: () => void; unmount: () => void } | null = null

  const onClearTerminal = async () => {
    await resetInkStaticOutputForStdout(safeStdout as any)
    instance?.clear()
    safeStdout.write('\u001b[2J\u001b[3J\u001b[H')
  }

  try {
    instance = render(
      <InputScopeProvider initialScope="repl">
        <REPL engine={engine} tools={[]} cfg={cfg} onClearTerminal={onClearTerminal} />
      </InputScopeProvider>,
      {
        exitOnCtrlC: false,
        stdout: safeStdout as any,
        stdin: stdin as any,
      },
    )

    await waitForScreen(screen, (text) => text.includes('Try "fix typecheck errors"'), 'initial prompt')

    const sendAndWaitEcho = async (text: string, label: string) => {
      stdin.write(text)
      await new Promise((resolve) => setTimeout(resolve, 15))
      stdin.write('\r')
      await waitForScreen(screen, (screenText) => screenText.includes(`ECHO:${text}`), label)
    }

    stdin.write('\u000f')
    await waitForScreen(screen, (text) => text.includes('Showing detailed transcript · ctrl+o to toggle'), 'open expanded')

    stdin.write('\u000f')
    await waitForScreen(
      screen,
      (text) => text.includes('? for shortcuts') && !text.includes('Showing detailed transcript · ctrl+o to toggle'),
      'close expanded',
    )

    await sendAndWaitEcho('1', 'echo 1')
    await sendAndWaitEcho('2', 'echo 2')

    const compactCommand = '/compact summarize this briefly'
    stdin.write(compactCommand)
    await new Promise((resolve) => setTimeout(resolve, 15))
    stdin.write('\r')
    await waitForScreen(
      screen,
      (text) => text.includes(`> ${compactCommand}`) && text.includes('Compacting conversation'),
      'compact in progress',
      12000,
    )
    const compactScreen = await waitForScreen(
      screen,
      (text) =>
        text.includes('Conversation compacted · ctrl+o for history') &&
        text.includes(`> ${compactCommand}`) &&
        text.includes('Compacted (ctrl+o to see full summary)'),
      'compact layout',
      12000,
    )
    const compactBannerIndex = compactScreen.indexOf('Conversation compacted · ctrl+o for history')
    const compactCommandIndex = compactScreen.indexOf(`> ${compactCommand}`, compactBannerIndex)
    const compactFinalSublineIndex = compactScreen.indexOf(
      'Compacted (ctrl+o to see full summary)',
      compactCommandIndex,
    )
    if (
      compactBannerIndex < 0 ||
      compactCommandIndex < 0 ||
      compactFinalSublineIndex < 0 ||
      compactBannerIndex > compactCommandIndex ||
      compactCommandIndex > compactFinalSublineIndex
    ) {
      throw new Error(`[compact-layout-order] Expected banner -> /compact -> compact subline order\n\n${compactScreen}`)
    }

    stdin.write('\u000f')
    const expandedAfterCompactScreen = await waitForScreen(
      screen,
      (text) =>
        text.includes('Showing detailed transcript · ctrl+o to toggle') &&
        text.includes('Conversation compacted · ctrl+o for history') &&
        text.includes('SUMMARY') &&
        text.includes(`> ${compactCommand}`) &&
        text.includes('Compacted (ctrl+o to see full summary)'),
      'open expanded after compact',
    )
    if (expandedAfterCompactScreen.includes('compact-thought')) {
      throw new Error(`[expanded-after-compact] compact thinking should not be rendered\n\n${expandedAfterCompactScreen}`)
    }
    const bannerIndex = expandedAfterCompactScreen.indexOf('Conversation compacted · ctrl+o for history')
    const summaryIndex = expandedAfterCompactScreen.indexOf('SUMMARY', bannerIndex)
    const compactCmdIndex = expandedAfterCompactScreen.indexOf(`> ${compactCommand}`, summaryIndex)
    const compactSublineIndex = expandedAfterCompactScreen.indexOf(
      'Compacted (ctrl+o to see full summary)',
      compactCmdIndex,
    )
    if (
      bannerIndex < 0 ||
      summaryIndex < 0 ||
      compactCmdIndex < 0 ||
      compactSublineIndex < 0 ||
      bannerIndex > summaryIndex ||
      summaryIndex > compactCmdIndex ||
      compactCmdIndex > compactSublineIndex
    ) {
      throw new Error(
        `[expanded-after-compact-order] Expected banner -> summary -> /compact -> compact subline order\n\n${expandedAfterCompactScreen}`,
      )
    }

    stdin.write('\u000f')
    await waitForScreen(
      screen,
      (text) => text.includes('? for shortcuts') && !text.includes('Showing detailed transcript · ctrl+o to toggle'),
      'close expanded after compact',
    )

    const finalScreen = screen.toString()
    assertFinalScreen({ screenText: finalScreen, label: 'baseline-sequence' })

    for (let i = 0; i < 20; i++) {
      stdin.write('\u000f')
      await new Promise((resolve) => setTimeout(resolve, 8))
    }
    await waitForScreen(
      screen,
      (text) => text.includes('? for shortcuts') && !text.includes('Showing detailed transcript · ctrl+o to toggle'),
      'rapid-ctrl-o-return-primary',
    )
    await waitForStableScreen(screen, 'rapid-ctrl-o-settle')

    const rapidToggleScreen = screen.toString()
    assertFinalScreen({ screenText: rapidToggleScreen, label: 'rapid-ctrl-o-x20' })

    await sendAndWaitEcho('rapid', 'rapid-echo')

    for (let i = 0; i < 12; i++) {
      await sendAndWaitEcho(`bulk-${i}`, `bulk-echo-${i}`)
    }

    stdin.write('\u000f')
    await waitForScreen(screen, (text) => text.includes('Showing detailed transcript · ctrl+o to toggle'), 'open-expanded-ctrl-e')
    await waitForScreen(screen, (text) => text.includes('Ctrl+E to hide '), 'ctrl-e-hint-hide')

    stdin.write('\u0005') // ctrl+e
    await waitForScreen(screen, (text) => text.includes('Ctrl+E to show '), 'ctrl-e-show-history')

    stdin.write('\u0005') // ctrl+e again
    await waitForScreen(screen, (text) => text.includes('Ctrl+E to hide '), 'ctrl-e-hide-history')

    stdin.write('\u000f')
    await waitForScreen(
      screen,
      (text) => text.includes('? for shortcuts') && !text.includes('Showing detailed transcript · ctrl+o to toggle'),
      'close-expanded-after-ctrl-e',
    )
    await waitForStableScreen(screen, 'close-expanded-after-ctrl-e-settle')

    const finalAfterCtrlE = screen.toString()
    if (finalAfterCtrlE.includes('Showing detailed transcript · ctrl+o to toggle')) {
      throw new Error(`[ctrl-e-return-primary] Expanded footer should not remain in primary view\n\n${finalAfterCtrlE}`)
    }
    if (!finalAfterCtrlE.includes('? for shortcuts')) {
      throw new Error(`[ctrl-e-return-primary] Primary footer hint missing\n\n${finalAfterCtrlE}`)
    }

    await sendAndWaitEcho('after-ctrl-e', 'after-ctrl-e-echo')

    process.stdout.write('ok: surface screen model smoke passed\n')
  } finally {
    instance?.unmount()
    if (prevForceStatic === undefined) delete process.env.FORMAX_FORCE_INK_STATIC
    else process.env.FORMAX_FORCE_INK_STATIC = prevForceStatic
    if (prevConfigDir === undefined) delete process.env.FORMAX_CONFIG_DIR
    else process.env.FORMAX_CONFIG_DIR = prevConfigDir
    if (prevCi === undefined) delete process.env.CI
    else process.env.CI = prevCi
    if (prevContinuousIntegration === undefined) delete process.env.CONTINUOUS_INTEGRATION
    else process.env.CONTINUOUS_INTEGRATION = prevContinuousIntegration
    await fsp.rm(tmpConfigDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
