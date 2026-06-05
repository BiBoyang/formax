import { z } from 'zod'
import { normalizeMcpServerId } from './names.js'
import type { McpConfig, McpServerConfig } from './types.js'

const StringRecordSchema = z.record(z.string(), z.string())

const McpStdioServerConfigSchema = z.object({
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: StringRecordSchema.optional(),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
  enabled: z.boolean().default(true),
}).strict()

const McpHttpServerConfigSchema = z.object({
  type: z.literal('http'),
  url: z.string().url().refine((value) => {
    try {
      const protocol = new URL(value).protocol
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  }, 'Expected http or https URL'),
  headers: StringRecordSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
  enabled: z.boolean().default(true),
}).strict()

export const McpServerConfigSchema = z.discriminatedUnion('type', [
  McpStdioServerConfigSchema,
  McpHttpServerConfigSchema,
])

export const McpConfigSchema = z.object({
  servers: z.record(z.string(), McpServerConfigSchema),
}).strict()

export type ParseMcpConfigResult =
  | { ok: true; config: McpConfig }
  | { ok: false; issues: string[] }

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
    return `${path}${issue.message}`
  })
}

export function parseMcpConfig(input: unknown): ParseMcpConfigResult {
  const parsed = McpConfigSchema.safeParse(input)
  if (parsed.success) {
    const normalizedServers: Record<string, McpServerConfig> = {}
    const rawIdsByNormalized = new Map<string, string>()
    const issues: string[] = []
    for (const [rawId, server] of Object.entries(parsed.data.servers)) {
      const normalizedId = normalizeMcpServerId(rawId)
      const existingRawId = rawIdsByNormalized.get(normalizedId)
      if (existingRawId && existingRawId !== rawId) {
        issues.push(`servers.${rawId}: server id collides with ${existingRawId} after normalization to ${normalizedId}`)
        continue
      }
      rawIdsByNormalized.set(normalizedId, rawId)
      normalizedServers[normalizedId] = server as McpServerConfig
    }
    if (issues.length > 0) return { ok: false, issues }
    return { ok: true, config: { servers: normalizedServers } }
  }
  return { ok: false, issues: zodIssues(parsed.error) }
}

export function parseMcpConfigFromFormaxConfig(input: unknown): ParseMcpConfigResult {
  if (!input || typeof input !== 'object') return { ok: true, config: { servers: {} } }
  const maybeMcp = (input as { mcp?: unknown }).mcp
  if (maybeMcp === undefined) return { ok: true, config: { servers: {} } }
  return parseMcpConfig(maybeMcp)
}

export function listEnabledMcpServers(config: McpConfig): Array<[string, McpServerConfig]> {
  return Object.entries(config.servers).filter(([, server]) => server.enabled)
}
