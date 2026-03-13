export type ConfirmMenuOption =
  | {
      kind: 'choice'
      key: string
      label: string
      dim?: boolean
      emphasis?: { text: string; color?: string; bold?: boolean }
    }
  | { kind: 'feedback'; key: string; label: string; placeholder: string }

export type ConfirmMenuDecision =
  | { kind: 'choice'; key: string }
  | { kind: 'feedback'; key: string; feedback: string }
  | { kind: 'cancel' }

export type EditApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember'; scope: 'session' | 'project' | 'global' }
  | { kind: 'feedback'; feedback: string }
  | { kind: 'cancel' }

export type BashApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember' }
  | { kind: 'feedback'; feedback: string }
  | { kind: 'cancel' }

export type FsReadApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember' }
  | { kind: 'feedback'; feedback: string }
  | { kind: 'cancel' }

export type FsWriteApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember' }
  | { kind: 'feedback'; feedback: string }
  | { kind: 'cancel' }

export type SkillApprovalDecision =
  | { kind: 'approve' }
  | { kind: 'approve_remember' }
  | { kind: 'feedback'; feedback: string }
  | { kind: 'cancel' }
