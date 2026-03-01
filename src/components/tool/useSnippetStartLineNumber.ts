import { useEffect, useMemo, useState } from 'react'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { findSnippetStartLineNumber } from './snippetStartLine'

export function useSnippetStartLineNumber(args: {
  filePath: string
  snippet: string
}): number {
  const absPath = useMemo(() => {
    if (!args.filePath) return null
    return path.isAbsolute(args.filePath) ? args.filePath : path.resolve(process.cwd(), args.filePath)
  }, [args.filePath])

  const [startLineNumber, setStartLineNumber] = useState(1)

  useEffect(() => {
    let cancelled = false
    setStartLineNumber(1)

    if (!absPath) return
    if (!args.snippet) return

    ;(async () => {
      try {
        const stat = await fsp.stat(absPath)
        if (!stat.isFile()) return
        if (stat.size > 512 * 1024) return

        const text = await fsp.readFile(absPath, 'utf8')
        const found = findSnippetStartLineNumber({ fileText: text, snippet: args.snippet })
        if (cancelled) return
        setStartLineNumber(found ?? 1)
      } catch {
        // ignore
      }
    })()

    return () => {
      cancelled = true
    }
  }, [absPath, args.snippet])

  return startLineNumber
}
