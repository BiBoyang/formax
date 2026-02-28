import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme'
import { ConfirmMenu, type ConfirmMenuDecision } from './ConfirmMenu'
import { ApprovalHeader } from './ApprovalHeader'

export type SkillApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember' }
  | { kind: 'feedback'; feedback: string }
  | { kind: 'cancel' }

export function SkillApprovalPrompt({
  title,
  rememberLabel,
  onDecision,
}: {
  title: string
  rememberLabel: string
  onDecision: (decision: SkillApprovalDecision) => void
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
