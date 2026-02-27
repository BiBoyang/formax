import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import React from 'react'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { useSnippetStartLineNumber } from './useSnippetStartLineNumber.js'

function Probe({ filePath, snippet }: { filePath: string; snippet: string }): React.ReactNode {
  const line = useSnippetStartLineNumber({ filePath, snippet })
  return <Text>{String(line)}</Text>
}

function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForFrame(lastFrame: () => string | undefined, text: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (frame.includes(text)) return
    await tick()
  }
  throw new Error(`Timed out waiting for frame to contain: ${text}`)
}

describe('useSnippetStartLineNumber', () => {
  let dir: string

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `snippet-line-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await fs.mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('returns 1 immediately when file path or snippet is missing', () => {
    const v1 = render(<Probe filePath="" snippet="x" />)
    expect(v1.lastFrame()).toContain('1')

    const v2 = render(<Probe filePath="/tmp/x.txt" snippet="" />)
    expect(v2.lastFrame()).toContain('1')
  })

  it('finds snippet start line for normal text files', async () => {
    const filePath = path.join(dir, 'demo.txt')
    await fs.writeFile(filePath, 'a\nb\nc\nd\nneedle\nx\n', 'utf8')

    const { lastFrame } = render(<Probe filePath={filePath} snippet={'needle'} />)
    await waitForFrame(lastFrame, '5')
  })

  it('keeps default line when path is not a file, file is too large, or read fails', async () => {
    const dirPath = path.join(dir, 'not-file')
    await fs.mkdir(dirPath)
    const viewDir = render(<Probe filePath={dirPath} snippet="needle" />)
    await waitForFrame(viewDir.lastFrame, '1')

    const bigPath = path.join(dir, 'big.txt')
    await fs.writeFile(bigPath, 'x'.repeat(600 * 1024), 'utf8')
    const viewBig = render(<Probe filePath={bigPath} snippet="needle" />)
    await waitForFrame(viewBig.lastFrame, '1')

    const missingPath = path.join(dir, 'missing.txt')
    const viewMissing = render(<Probe filePath={missingPath} snippet="needle" />)
    await waitForFrame(viewMissing.lastFrame, '1')
  })
})
