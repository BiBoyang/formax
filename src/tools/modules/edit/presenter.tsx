import React from 'react'
import path from 'node:path'
import { Box } from 'ink'
import { formatToolCallParts } from '../../../shared/utils/toolFormatting'
import { isSameFilePath } from '../../../shared/utils/planMode'
import type { ToolPresenter } from '../../../shared/toolPresenterContracts'
import { createToolBlocksPresenter } from '../../../shared/toolPresenterContracts'
import type { Msg } from '../../../shared/toolMessageTypes'
import { PatchPreview } from '../../presenters/PatchPreview'
import { ToolHeaderLine, ToolSubline } from '../../presenters/ToolUiPrimitives'
import { stripCatNPrefixes } from '../../../shared/utils/catN'
import { EditApprovalToolBlock } from './EditApprovalToolBlock'
import { EditPlanFileBlock } from './EditPlanFileBlock'
import { usePlanSession } from '../../../features/repl/planContext'

// Component that renders the complete edit tool UI.
// Handles plan file detection internally since it needs usePlanSession hook.
function EditToolBlock({ message }: { message: Msg }): React.ReactNode {
  const planSession = usePlanSession()
  const planPath = planSession?.getPlanPath() ?? null

  if (!message.toolInfo) return <ToolHeaderLine status="completed" label="Unknown tool" />

  const { name, input, status } = message.toolInfo
  const { toolName, params } = formatToolCallParts(name, input, { preferRelativePaths: true })
  const showParams = Boolean(params && params.trim().length > 0)

  const toolUseId =
    message.toolInfo.toolUseId ||
    (message.id.startsWith('tool-') ? message.id.slice('tool-'.length) : message.id)
  const filePathRaw = String((input as any).file_path || (input as any).path || '')
  const fileName = path.basename(filePathRaw || 'file')

  const isPlanFile = Boolean(planPath && isSameFilePath(filePathRaw, planPath))

  // Plan file special case - render the plan file block
  if (isPlanFile) {
    return (
      <Box flexDirection="column">
        <ToolHeaderLine status={status} label="Updated plan" />
        <EditPlanFileBlock message={message} />
      </Box>
    )
  }

  const filePath = String((input as any).file_path || (input as any).path || '')
  const oldString = (input as any).old_string
  const newString = (input as any).new_string

  const oldTextForPreview = typeof oldString === 'string' ? stripCatNPrefixes(oldString) : ''
  const newTextForPreview = typeof newString === 'string' ? stripCatNPrefixes(newString) : ''

  const previewStartLineNumber = message.toolInfo.patchStartLineNumber

  return (
    <Box flexDirection="column">
      <ToolHeaderLine
        status={status}
        label={toolName}
        params={showParams ? params : null}
      />
      {status === 'running' ? (
        <EditApprovalToolBlock
          toolUseId={toolUseId}
          fileName={fileName}
          filePath={filePath}
          oldText={oldTextForPreview}
          newText={newTextForPreview}
        />
      ) : (
        <Box flexDirection="column">
          <ToolSubline status={status === 'error' ? 'error' : 'completed'}>
            {message.content || (filePath ? `Edited ${filePath}` : 'Edited')}
          </ToolSubline>

          {typeof oldString === 'string' && typeof newString === 'string' ? (
            <Box flexDirection="column" marginTop={1}>
              <PatchPreview oldText={oldTextForPreview} newText={newTextForPreview} startLineNumber={previewStartLineNumber} />
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  )
}

export const EditToolPresenter: ToolPresenter = createToolBlocksPresenter(({ message }: { message: Msg }) => {
  const status = message.toolInfo?.status
  const input = message.toolInfo?.input
  const filePathRaw = String((input as any)?.file_path || (input as any)?.path || '')
  // Avoid briefly rendering an incomplete "⏺ Edit" header while the tool input is still streaming.
  if (status === 'running' && !filePathRaw) {
    return { blocks: [] }
  }
  return {
    blocks: [
      {
        kind: 'custom',
        node: <EditToolBlock message={message} />,
      },
    ],
  }
})
