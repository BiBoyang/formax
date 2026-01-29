import React, { useEffect, useMemo, useState } from 'react'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Text, useStdout } from 'ink'
import { getTheme } from '../../utils/theme'
import { PatchPreview } from './PatchPreview'

export function PatchApprovalPreview({
  filePath,
  oldText,
  newText,
}: {
  filePath: string
  oldText: string
  newText: string
}): React.ReactNode {
  const theme = getTheme()
  const { stdout } = useStdout()

  const previewWidth = useMemo(() => Math.max(20, stdout?.columns ?? 80), [stdout?.columns])
  const dashedLine = useMemo(() => '╌'.repeat(previewWidth), [previewWidth])

  const absPath = useMemo(() => {
    if (!filePath) return null
    return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
  }, [filePath])

  const [startLineNumber, setStartLineNumber] = useState(1)

  useEffect(() => {
    let cancelled = false
    setStartLineNumber(1)

    if (!absPath) return
    if (!oldText) return

    ;(async () => {
      try {
        const stat = await fsp.stat(absPath)
        if (!stat.isFile()) return
        if (stat.size > 512 * 1024) return

        const text = await fsp.readFile(absPath, 'utf8')
        const found = findSnippetStartLineNumber({ fileText: text, snippet: oldText })
        if (cancelled) return
        setStartLineNumber(found ?? 1)
      } catch {
        // ignore
      }
    })()

    return () => {
      cancelled = true
    }
  }, [absPath, oldText])

  return (
    <>
      <Text color={theme.secondaryText}>{dashedLine}</Text>
      <PatchPreview oldText={oldText} newText={newText} startLineNumber={startLineNumber} />
      <Text color={theme.secondaryText}>{dashedLine}</Text>
    </>
  )
}

function findSnippetStartLineNumber(args: { fileText: string; snippet: string }): number | null {
  const fileLines = args.fileText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const snippetLines = args.snippet.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  while (snippetLines.length > 0 && snippetLines[snippetLines.length - 1] === '') snippetLines.pop()
  if (snippetLines.length === 0) return null

  const rstrip = (s: string) => s.replace(/\s+$/g, '')

  outer: for (let i = 0; i + snippetLines.length <= fileLines.length; i++) {
    for (let j = 0; j < snippetLines.length; j++) {
      if (rstrip(fileLines[i + j]) !== rstrip(snippetLines[j])) continue outer
    }
    return i + 1
  }

  return null
}
