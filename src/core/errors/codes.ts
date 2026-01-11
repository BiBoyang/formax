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
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

