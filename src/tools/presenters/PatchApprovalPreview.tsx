import React, { useMemo } from 'react'
import path from 'node:path'
import { Text, useStdout } from 'ink'
import { getTheme } from '../../shared/utils/theme'
import { PatchPreview } from '../../components/tool/PatchPreview'
import { useSnippetStartLineNumber } from './useSnippetStartLineNumber'

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
    if (!filePath) return ''
    return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
  }, [filePath])

  const startLineNumber = useSnippetStartLineNumber({ filePath: absPath, snippet: oldText })

  return (
    <>
      <Text color={theme.secondaryText}>{dashedLine}</Text>
      <PatchPreview oldText={oldText} newText={newText} startLineNumber={startLineNumber} />
      <Text color={theme.secondaryText}>{dashedLine}</Text>
    </>
  )
}
