import { redactJsonSecrets as redactJsonSecretsImpl, redactTextSecrets as redactTextSecretsImpl } from './redactionImpl.js'

export function redactTextSecrets(...args: Parameters<typeof redactTextSecretsImpl>): ReturnType<typeof redactTextSecretsImpl> {
  return redactTextSecretsImpl(...args)
}

export function redactJsonSecrets(...args: Parameters<typeof redactJsonSecretsImpl>): ReturnType<typeof redactJsonSecretsImpl> {
  return redactJsonSecretsImpl(...args)
}
