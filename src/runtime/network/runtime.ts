import { randomBytes } from 'node:crypto'

export type BridgeSecurityOptions = {
  authToken?: string
  allowedOrigins?: string[]
}

export type BridgeRateLimitOptions = {
  windowMs: number
  maxMessages: number
}

export type BridgeRateLimitState = {
  windowStartedAtMs: number
  count: number
}

export type DecodedPathnameResult =
  | { ok: true; pathname: string }
  | { ok: false; statusCode: 400; message: 'Bad Request' }

export function parseTcpPort(value: string, flag: string): number {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid ${flag}: expected integer between 1 and 65535`)
  }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid ${flag}: expected integer between 1 and 65535`)
  }
  return parsed
}

export function formatHostForUrl(host: string): string {
  const normalized = host.trim()
  if (!normalized) return normalized
  if (normalized.startsWith('[') && normalized.endsWith(']')) return normalized
  if (normalized.includes(':')) return `[${normalized}]`
  return normalized
}

export function displayHostForLogs(host: string): string {
  const normalized = host.trim()
  if (normalized === '0.0.0.0') return '127.0.0.1'
  if (normalized === '::') return '[::1]'
  return formatHostForUrl(normalized)
}

export function buildHttpUrl(host: string, port: number): string {
  return `http://${formatHostForUrl(host)}:${port}`
}

export function buildWsUrl(host: string, port: number, secure = false): string {
  return `${secure ? 'wss' : 'ws'}://${formatHostForUrl(host)}:${port}`
}

export function decodeRequestPathname(rawUrl: string | undefined): DecodedPathnameResult {
  try {
    const requestUrl = new URL(rawUrl ?? '/', 'http://localhost')
    return { ok: true, pathname: decodeURIComponent(requestUrl.pathname) }
  } catch {
    return { ok: false, statusCode: 400, message: 'Bad Request' }
  }
}

export function createBridgeAuthToken(): string {
  return randomBytes(24).toString('hex')
}

function normalizeOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin)
    if (!parsed.protocol || !parsed.host) return null
    return `${parsed.protocol}//${parsed.host}`.toLowerCase()
  } catch {
    return null
  }
}

function normalizeAllowedOrigins(origins: string[] | undefined): Set<string> {
  const out = new Set<string>()
  if (!origins) return out
  for (const raw of origins) {
    const normalized = normalizeOrigin(raw)
    if (normalized) out.add(normalized)
  }
  return out
}

function readTokenFromRequestUrl(requestUrl: string | undefined): string | null {
  try {
    const parsed = new URL(requestUrl ?? '/', 'http://localhost')
    const token = parsed.searchParams.get('token')
    return token && token.trim() ? token : null
  } catch {
    return null
  }
}

function readTokenFromAuthorizationHeader(header: string | undefined): string | null {
  if (!header) return null
  const trimmed = header.trim()
  if (!trimmed) return null
  const bearer = /^Bearer\s+(.+)$/i.exec(trimmed)
  if (bearer?.[1]) {
    const token = bearer[1].trim()
    return token
  }
  return trimmed
}

export function authorizeBridgeConnection(args: {
  requestUrl: string | undefined
  originHeader: string | undefined
  authorizationHeader: string | undefined
  security: BridgeSecurityOptions | undefined
}): { ok: true } | { ok: false; reason: 'Unauthorized' | 'Forbidden origin' } {
  const authToken = args.security?.authToken?.trim()
  if (authToken) {
    const requestToken = readTokenFromRequestUrl(args.requestUrl) ?? readTokenFromAuthorizationHeader(args.authorizationHeader)
    if (!requestToken || requestToken !== authToken) {
      return { ok: false, reason: 'Unauthorized' }
    }
  }

  const allowedOrigins = normalizeAllowedOrigins(args.security?.allowedOrigins)
  if (allowedOrigins.size > 0) {
    const normalizedOrigin = args.originHeader ? normalizeOrigin(args.originHeader) : null
    if (!normalizedOrigin || !allowedOrigins.has(normalizedOrigin)) {
      return { ok: false, reason: 'Forbidden origin' }
    }
  }

  return { ok: true }
}

export function evaluateBridgeRateLimit(args: {
  state: BridgeRateLimitState | null
  nowMs: number
  options: BridgeRateLimitOptions
}): { allowed: boolean; state: BridgeRateLimitState } {
  const windowMs = Math.max(100, Math.floor(args.options.windowMs))
  const maxMessages = Math.max(1, Math.floor(args.options.maxMessages))
  const state =
    args.state && args.nowMs - args.state.windowStartedAtMs < windowMs
      ? { ...args.state }
      : { windowStartedAtMs: args.nowMs, count: 0 }

  state.count += 1
  if (state.count > maxMessages) {
    return { allowed: false, state }
  }
  return { allowed: true, state }
}

export function buildLocalUiAllowedOrigins(host: string, uiPort: number): string[] {
  const origins = new Set<string>()
  const addOrigin = (inputHost: string) => {
    const origin = normalizeOrigin(`http://${formatHostForUrl(inputHost)}:${uiPort}`)
    if (origin) origins.add(origin)
  }

  addOrigin('127.0.0.1')
  addOrigin('localhost')
  addOrigin('::1')

  const normalizedHost = host.trim()
  if (normalizedHost && normalizedHost !== '0.0.0.0' && normalizedHost !== '::') {
    addOrigin(normalizedHost)
  }

  return [...origins]
}
