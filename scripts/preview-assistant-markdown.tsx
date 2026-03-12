#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import React, { useEffect } from 'react'
import { Box } from 'ink'
import { render } from 'ink'
import { AssistantMarkdownBlock } from '../src/components/ui/AssistantMarkdownBlock.js'

type CliOptions = {
  filePath: string
  linePrefix: string
}

function parseArgs(argv: string[]): CliOptions {
  let filePath = ''
  let linePrefix = '⏺ '

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token) continue

    if (token === '--help' || token === '-h') {
      printHelpAndExit()
    } else if (token === '--prefix') {
      const value = argv[i + 1]
      if (typeof value !== 'string') throw new Error('--prefix requires a value')
      linePrefix = value
      i += 1
    } else if (token === '--no-prefix') {
      linePrefix = ''
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}`)
    } else if (!filePath) {
      filePath = token
    } else {
      throw new Error(`Unexpected argument: ${token}`)
    }
  }

  if (!filePath) {
    throw new Error('Missing markdown file path')
  }

  return { filePath, linePrefix }
}

function printHelpAndExit(): never {
  const lines = [
    'Usage: bun run md:preview -- <markdown-file> [--prefix "<text>" | --no-prefix]',
    '',
    'Examples:',
    '  bun run md:preview -- docs/baselines/markdown-tui-render-fixture.md',
    '  bun run md:preview -- docs/baselines/markdown-tui-render-fixture.md --no-prefix',
    '  bun run md:preview -- docs/baselines/markdown-tui-render-fixture.md --prefix "  "',
  ]
  console.log(lines.join('\n'))
  process.exit(0)
}

function PreviewApp({
  markdown,
  linePrefix,
  onDone,
}: {
  markdown: string
  linePrefix: string
  onDone: () => void
}): React.ReactNode {
  useEffect(() => {
    const timer = setTimeout(onDone, 0)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <Box flexDirection="column">
      <AssistantMarkdownBlock markdown={markdown} linePrefix={linePrefix} />
    </Box>
  )
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const absPath = path.resolve(process.cwd(), options.filePath)
  const markdown = await fs.readFile(absPath, 'utf8')

  await new Promise<void>((resolve) => {
    const instance = render(
      <PreviewApp
        markdown={markdown}
        linePrefix={options.linePrefix}
        onDone={() => {
          instance.unmount()
          resolve()
        }}
      />,
      {
        stdout: process.stdout,
        stdin: process.stdin,
        exitOnCtrlC: true,
        patchConsole: false,
      },
    )
  })
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`md preview failed: ${message}`)
  process.exit(1)
})

