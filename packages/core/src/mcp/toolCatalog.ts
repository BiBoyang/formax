import type { ToolDefinition } from '../shared/toolContracts.js'
import { buildMcpModelToolName, normalizeMcpServerId, normalizeMcpToolName } from './names.js'
import { stableJsonStringify } from './stableJson.js'
import type { McpToolCatalog, McpToolMetadata } from './types.js'

export type McpServerToolList = {
  serverId: string
  tools: McpToolMetadata[]
}

const DEFAULT_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: true,
}

function compareNormalizedThenRaw(a: string, b: string, normalize: (value: string) => string): number {
  const normalized = compareCodeUnitStrings(normalize(a), normalize(b))
  if (normalized !== 0) return normalized
  return compareCodeUnitStrings(a, b)
}

function compareCodeUnitStrings(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

export function createMcpToolDefinition(serverId: string, tool: McpToolMetadata): ToolDefinition {
  const modelName = buildMcpModelToolName(serverId, tool.name)
  return {
    name: modelName,
    description: tool.description?.trim() || `MCP tool ${tool.name} from ${serverId}`,
    input_schema: tool.inputSchema === undefined ? DEFAULT_INPUT_SCHEMA : tool.inputSchema,
  }
}

function isObjectRootInputSchema(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const type = (value as { type?: unknown }).type
  return type === 'object'
}

export function createMcpToolCatalog(
  serverTools: McpServerToolList[],
  options?: { reservedToolNames?: Iterable<string> },
): McpToolCatalog {
  const reserved = new Set(options?.reservedToolNames ?? [])
  const bindings = new Map<string, McpToolCatalog['bindings'][number]>()
  const diagnostics: McpToolCatalog['diagnostics'] = []

  const ordered = [...serverTools].sort((a, b) => (
    compareNormalizedThenRaw(a.serverId, b.serverId, normalizeMcpServerId)
  ))
  for (const entry of ordered) {
    const tools = [...entry.tools].sort((a, b) => (
      compareNormalizedThenRaw(a.name, b.name, normalizeMcpToolName)
    ))
    for (const tool of tools) {
      const definition = createMcpToolDefinition(entry.serverId, tool)
      const modelName = definition.name
      if (!isObjectRootInputSchema(definition.input_schema)) {
        diagnostics.push({
          type: 'invalid-input-schema',
          modelName,
          dropped: { serverId: entry.serverId, toolName: tool.name },
        })
        continue
      }
      if (reserved.has(modelName)) {
        diagnostics.push({
          type: 'reserved-tool-name',
          modelName,
          dropped: { serverId: entry.serverId, toolName: tool.name },
        })
        continue
      }
      const next = {
        modelName,
        serverId: normalizeMcpServerId(entry.serverId),
        originalServerId: entry.serverId,
        toolName: normalizeMcpToolName(tool.name),
        originalToolName: tool.name,
        definition,
        schemaFingerprint: stableJsonStringify(definition.input_schema),
      }
      const prev = bindings.get(modelName)
      if (prev) {
        diagnostics.push({
          type: 'duplicate-tool-name',
          modelName,
          kept: { serverId: prev.originalServerId, toolName: prev.originalToolName },
          dropped: { serverId: entry.serverId, toolName: tool.name },
        })
        continue
      }
      bindings.set(modelName, next)
    }
  }

  return {
    bindings: Array.from(bindings.values()),
    diagnostics,
  }
}
