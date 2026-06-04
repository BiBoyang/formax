const MCP_TOOL_PREFIX = 'mcp__'
const FALLBACK_SERVER_ID = 'server'
const FALLBACK_TOOL_NAME = 'tool'

function normalizePart(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const compact = normalized.replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  return compact || fallback
}

export function normalizeMcpServerId(serverId: string): string {
  return normalizePart(serverId, FALLBACK_SERVER_ID)
}

export function normalizeMcpToolName(toolName: string): string {
  return normalizePart(toolName, FALLBACK_TOOL_NAME)
}

export function buildMcpModelToolName(serverId: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${normalizeMcpServerId(serverId)}__${normalizeMcpToolName(toolName)}`
}

export function isMcpModelToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX) && name.slice(MCP_TOOL_PREFIX.length).includes('__')
}

export function parseMcpModelToolName(
  name: string,
): { serverId: string; toolName: string } | null {
  if (!isMcpModelToolName(name)) return null
  const rest = name.slice(MCP_TOOL_PREFIX.length)
  const separator = rest.indexOf('__')
  if (separator <= 0 || separator >= rest.length - 2) return null
  return {
    serverId: rest.slice(0, separator),
    toolName: rest.slice(separator + 2),
  }
}
