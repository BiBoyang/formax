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

type JsonObject = Record<string, unknown>

type SchemaRootCompatibility = 'object' | 'non-object' | 'unknown'

const OBJECT_SCHEMA_HINT_KEYS = [
  'additionalProperties',
  'dependentRequired',
  'dependentSchemas',
  'maxProperties',
  'minProperties',
  'patternProperties',
  'properties',
  'propertyNames',
  'required',
  'unevaluatedProperties',
] as const

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
    input_schema: normalizeInputSchemaForModel(tool.inputSchema),
  }
}

function normalizeInputSchemaForModel(value: unknown): unknown {
  if (value === undefined || value === true) return DEFAULT_INPUT_SCHEMA
  if (!isJsonObject(value)) return value
  return analyzeObjectRootCompatibility(value, value, new Set()) === 'unknown'
    ? normalizeUnknownObjectRootSchema(value)
    : value
}

function normalizeUnknownObjectRootSchema(value: JsonObject): unknown {
  if (Array.isArray(value.type) && value.type.includes('object')) {
    return {
      ...value,
      type: 'object',
    }
  }
  return DEFAULT_INPUT_SCHEMA
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

function resolveLocalJsonPointer(root: JsonObject, ref: string): unknown {
  if (ref === '#') return root
  if (!ref.startsWith('#/')) return undefined
  let current: unknown = root
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = decodeJsonPointerSegment(rawSegment)
    if (!isJsonObject(current) && !Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function hasObjectSchemaHint(schema: JsonObject): boolean {
  return OBJECT_SCHEMA_HINT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(schema, key))
}

function analyzeObjectRootCompatibility(
  value: unknown,
  root: JsonObject,
  seenRefs: Set<string>,
): SchemaRootCompatibility {
  if (value === true) return 'unknown'
  if (value === false) return 'non-object'
  if (!isJsonObject(value)) return 'unknown'

  const type = value.type
  if (type === 'object') return 'object'
  if (Array.isArray(type)) {
    if (!type.includes('object')) return 'non-object'
    return type.every((item) => item === 'object') ? 'object' : 'unknown'
  }
  if (type !== undefined) return 'non-object'

  const ref = value.$ref
  if (typeof ref === 'string') {
    if (seenRefs.has(ref)) return 'non-object'
    const resolved = resolveLocalJsonPointer(root, ref)
    if (resolved === undefined) return 'non-object'
    return analyzeObjectRootCompatibility(resolved, root, new Set([...seenRefs, ref]))
  }

  if (hasObjectSchemaHint(value)) return 'object'

  if (Object.prototype.hasOwnProperty.call(value, 'const')) {
    return isJsonObject(value.const) ? 'object' : 'non-object'
  }

  if (Array.isArray(value.enum)) {
    return value.enum.length > 0 && value.enum.every((item) => isJsonObject(item))
      ? 'object'
      : 'non-object'
  }

  const allOf = value.allOf
  if (Array.isArray(allOf)) {
    let hasObjectBranch = false
    for (const branch of allOf) {
      const branchCompatibility = analyzeObjectRootCompatibility(branch, root, seenRefs)
      if (branchCompatibility === 'non-object') return 'non-object'
      if (branchCompatibility === 'object') hasObjectBranch = true
    }
    return hasObjectBranch ? 'object' : 'unknown'
  }

  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = value[key]
    if (!Array.isArray(branches) || branches.length === 0) continue
    return branches.every((branch) => (
      analyzeObjectRootCompatibility(branch, root, seenRefs) !== 'non-object'
    ))
      ? branches.some((branch) => analyzeObjectRootCompatibility(branch, root, seenRefs) === 'object')
        ? 'object'
        : 'unknown'
      : 'non-object'
  }

  return 'unknown'
}

function isObjectRootInputSchema(value: unknown): value is Record<string, unknown> {
  if (!isJsonObject(value)) return false
  return analyzeObjectRootCompatibility(value, value, new Set()) !== 'non-object'
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
