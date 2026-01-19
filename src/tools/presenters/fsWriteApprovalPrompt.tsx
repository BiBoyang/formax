import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'
import { ConfirmMenu, type ConfirmMenuDecision } from '../../components/ui/ConfirmMenu.js'

export type FsWriteApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember' }
  | { kind: 'feedback'; feedback: string }
  | { kind: 'cancel' }

export function FsWriteApprovalPrompt({
  title,
  onDecision,
}: {
  title: string
  onDecision: (decision: FsWriteApprovalDecision) => void
}): React.ReactNode {
  const theme = getTheme()
  const handleDecision = (d: ConfirmMenuDecision): void => {
    if (d.kind === 'cancel') onDecision({ kind: 'cancel' })
    else if (d.kind === 'feedback') onDecision({ kind: 'feedback', feedback: d.feedback })
    else if (d.key === 'approve') onDecision({ kind: 'approve' })
    else if (d.key === 'approve_remember') onDecision({ kind: 'approve_remember' })
    else if (d.key === 'cancel') onDecision({ kind: 'cancel' })
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginBottom={1}>
        <Text bold>{title}</Text>
      </Box>

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
          { kind: 'choice', key: 'cancel', label: 'Cancel', dim: true },
        ]}
        onDecision={handleDecision}
      />

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>Esc to interrupt</Text>
      </Box>
    </Box>
  )
}
