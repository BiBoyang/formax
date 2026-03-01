export const ExitCode = {
  Ok: 0,
  Error: 1,
  Usage: 2,
} as const

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode]

