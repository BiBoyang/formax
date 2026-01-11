import { ErrorCode } from '../errors/codes.js'
import type { ProviderId } from '../config/schema.js'
import type { ConnectionTestError } from './types.js'

export type SetupHint = {
  title: string
  lines: string[]
}

export function getConnectionTestHint(args: {
  provider: ProviderId
  baseUrl: string
  error: ConnectionTestError
}): SetupHint | null {
  const baseUrl = String(args.baseUrl || '').trim()

  if (args.error.code === ErrorCode.Unauthorized) {
    return {
      title: 'How to fix',
      lines: [
        'Verify the API key you pasted is correct (no extra spaces).',
        'If you recently rotated keys, generate a new key and try again.',
      ],
    }
  }

  if (args.error.code === ErrorCode.Forbidden) {
    return {
      title: 'How to fix',
      lines: [
        'Your key was accepted, but the provider denied access.',
        'Check your account/org settings and billing status.',
      ],
    }
  }

  if (args.error.code === ErrorCode.Timeout) {
    return {
      title: 'How to fix',
      lines: [
        baseUrl ? `Verify the base URL is reachable: ${baseUrl}` : 'Verify the base URL is reachable.',
        'If you are behind a proxy/VPN/firewall, make sure HTTPS access is allowed.',
      ],
    }
  }

  if (args.error.code === ErrorCode.NetworkError) {
    return {
      title: 'How to fix',
      lines: [
        baseUrl ? `Verify the base URL is correct and reachable: ${baseUrl}` : 'Verify the base URL is correct and reachable.',
        'If you see DNS/TLS errors, check your network and system certificates.',
      ],
    }
  }

  return null
}

