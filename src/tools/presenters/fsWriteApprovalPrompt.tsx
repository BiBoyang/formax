import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'
import type { ConfirmMenuDecision, FsWriteApprovalDecision } from '../../shared/approvalPromptContracts'
import { ConfirmMenu } from './ConfirmMenu'
import { ApprovalHeader } from './ApprovalHeader'

export type { FsWriteApprovalDecision } from '../../shared/approvalPromptContracts'

export function FsWriteApprovalPrompt({
  title,
  variant = 'header',
  onDecision,
}: {
  title: string
  variant?: 'header' | 'inline'
  onDecision: (decision: FsWriteApprovalDecision) => void
}): React.ReactNode {
  const theme = getTheme()
  const handleDecision = (d: ConfirmMenuDecision): void => {
    if (d.kind === 'cancel') onDecision({ kind: 'cancel' })
    else if (d.kind === 'feedback') onDecision({ kind: 'feedback', feedback: d.feedback })
    else onDecision(d.key === 'approve_remember' ? { kind: 'approve_remember' } : { kind: 'approve' })
  }

  return (
    <Box flexDirection="column" marginTop={variant === 'header' ? 1 : 0}>
      {variant === 'header' ? <ApprovalHeader title={title} /> : null}

      <ConfirmMenu
        options={[
          { kind: 'choice', key: 'approve', label: 'Yes' },
          { kind: 'choice', key: 'approve_remember', label: 'Yes, allow all edits during this session (shift+tab)' },
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
