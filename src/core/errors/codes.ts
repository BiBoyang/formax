export const ErrorCode = {
  Unknown: 'UNKNOWN',
  InvalidConfig: 'INVALID_CONFIG',
  InvalidAuth: 'INVALID_AUTH',
  SetupRequired: 'SETUP_REQUIRED',
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  NetworkError: 'NETWORK_ERROR',
  Timeout: 'TIMEOUT',
  FsPermission: 'FS_PERMISSION',
  ApprovalRequired: 'APPROVAL_REQUIRED',
  PolicyDenied: 'POLICY_DENIED',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]
