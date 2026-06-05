import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../tui/theme'
import type { ConfirmMenuDecision, McpApprovalDecision } from '../../shared/approvalPromptContracts'
import { ConfirmMenu } from '../ui/ConfirmMenu'
import { ApprovalHeader } from '../ui/ApprovalHeader'

export type { McpApprovalDecision } from '../../shared/approvalPromptContracts'

export function McpApprovalPrompt({
  title,
  toolLabel,
  rememberLabel,
  onDecision,
}: {
  title: string
  toolLabel: string
  rememberLabel: string
  onDecision: (decision: McpApprovalDecision) => void
}): React.ReactNode {
  const theme = getTheme()
  const handleDecision = (d: ConfirmMenuDecision): void => {
    if (d.kind === 'cancel') onDecision({ kind: 'cancel' })
    else if (d.kind === 'feedback') onDecision({ kind: 'feedback', feedback: d.feedback })
    else onDecision(d.key === 'approve_remember' ? { kind: 'approve_remember' } : { kind: 'approve' })
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <ApprovalHeader title={title} />

      <Box marginBottom={1}>
        <Text color={theme.secondaryText}>Tool: </Text>
        <Text bold>{toolLabel}</Text>
      </Box>

      <ConfirmMenu
        options={[
          { kind: 'choice', key: 'approve', label: 'Yes' },
          { kind: 'choice', key: 'approve_remember', label: rememberLabel },
          {
            kind: 'feedback',
            key: 'feedback',
            label: '',
            placeholder: 'Type here to tell Claude what to do differently',
          },
        ]}
        onDecision={handleDecision}
        activeColor={theme.permission}
      />

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Esc to cancel</Text>
      </Box>
    </Box>
  )
}
