function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function childPath(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`
  return `${path}.${key}`
}

function decodeJsonPointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

function resolveLocalRef(rootSchema: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  const parts = ref
    .slice(2)
    .split('/')
    .map((part) => decodeJsonPointerToken(part))

  let current: unknown = rootSchema
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
      continue
    }
    if (!isPlainObject(current)) return undefined
    current = current[part]
  }

  return current
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    for (let idx = 0; idx < left.length; idx += 1) {
      if (!deepEqual(left[idx], right[idx])) return false
    }
    return true
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    for (const key of leftKeys) {
      if (!rightKeys.includes(key)) return false
      if (!deepEqual(left[key], right[key])) return false
    }
    return true
  }

  return false
}

type JsonPrimitiveType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

const JSON_PRIMITIVE_TYPES: JsonPrimitiveType[] = [
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]

function matchesPrimitiveType(type: JsonPrimitiveType, value: unknown): boolean {
  if (type === 'object') return isPlainObject(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'boolean') return typeof value === 'boolean'
  return value === null
}

function normalizeTypes(rawType: unknown): JsonPrimitiveType[] | null | 'invalid' {
  if (typeof rawType === 'string') {
    if (!JSON_PRIMITIVE_TYPES.includes(rawType as JsonPrimitiveType)) return 'invalid'
    return [rawType as JsonPrimitiveType]
  }
  if (Array.isArray(rawType)) {
    const types: JsonPrimitiveType[] = []
    for (const item of rawType) {
      if (typeof item !== 'string') return 'invalid'
      if (!JSON_PRIMITIVE_TYPES.includes(item as JsonPrimitiveType)) return 'invalid'
      types.push(item as JsonPrimitiveType)
    }
    return types
  }
  return null
}

function validateJsonValue(args: {
  rootSchema: Record<string, unknown>
  schema: unknown
  value: unknown
  path: string
  depth: number
}): string | null {
  if (args.depth > 64) return `${args.path} schema nesting is too deep`
  if (!isPlainObject(args.schema)) return `${args.path} schema must be an object`
  const schema = args.schema

  if (typeof schema.$ref === 'string') {
    const resolved = resolveLocalRef(args.rootSchema, schema.$ref)
    if (resolved === undefined) {
      return `${args.path} unresolved $ref: ${schema.$ref}`
    }
    return validateJsonValue({
      ...args,
      schema: resolved,
      depth: args.depth + 1,
    })
  }

  if ('const' in schema && !deepEqual(args.value, schema.const)) {
    return `${args.path} must equal const value`
  }

  if ('enum' in schema) {
    if (!Array.isArray(schema.enum)) return `${args.path} schema enum must be an array`
    const hit = schema.enum.some((item) => deepEqual(item, args.value))
    if (!hit) return `${args.path} must match one of enum values`
  }

  if ('anyOf' in schema) {
    if (!Array.isArray(schema.anyOf)) return `${args.path} schema anyOf must be an array`
    const ok = schema.anyOf.some((candidate) => {
      return (
        validateJsonValue({
          rootSchema: args.rootSchema,
          schema: candidate,
          value: args.value,
          path: args.path,
          depth: args.depth + 1,
        }) == null
      )
    })
    if (!ok) return `${args.path} must match at least one anyOf schema`
  }

  if ('oneOf' in schema) {
    if (!Array.isArray(schema.oneOf)) return `${args.path} schema oneOf must be an array`
    let matched = 0
    for (const candidate of schema.oneOf) {
      const err = validateJsonValue({
        rootSchema: args.rootSchema,
        schema: candidate,
        value: args.value,
        path: args.path,
        depth: args.depth + 1,
      })
      if (err == null) matched += 1
      if (matched > 1) break
    }
    if (matched !== 1) return `${args.path} must match exactly one oneOf schema`
  }

  if ('allOf' in schema) {
    if (!Array.isArray(schema.allOf)) return `${args.path} schema allOf must be an array`
    for (const candidate of schema.allOf) {
      const err = validateJsonValue({
        rootSchema: args.rootSchema,
        schema: candidate,
        value: args.value,
        path: args.path,
        depth: args.depth + 1,
      })
      if (err) return err
    }
  }

  const allowedTypes = normalizeTypes(schema.type)
  if (allowedTypes === 'invalid') {
    return `${args.path} schema type must use supported JSON Schema primitive types`
  }
  if (schema.type !== undefined && !allowedTypes) {
    return `${args.path} schema type must be a string or string[]`
  }
  if (allowedTypes && !allowedTypes.some((type) => matchesPrimitiveType(type, args.value))) {
    return `${args.path} must match schema type`
  }

  if ('minLength' in schema) {
    const minLength = schema.minLength
    if (!isNonNegativeInteger(minLength)) {
      return `${args.path} schema minLength must be a nonnegative integer`
    }
    if (typeof args.value === 'string' && args.value.length < minLength) {
      return `${args.path} must have length >= ${minLength}`
    }
  }

  if ('maxLength' in schema) {
    const maxLength = schema.maxLength
    if (!isNonNegativeInteger(maxLength)) {
      return `${args.path} schema maxLength must be a nonnegative integer`
    }
    if (typeof args.value === 'string' && args.value.length > maxLength) {
      return `${args.path} must have length <= ${maxLength}`
    }
  }

  if ('pattern' in schema) {
    if (typeof schema.pattern !== 'string') {
      return `${args.path} schema pattern must be a string`
    }
    let regex: RegExp
    try {
      regex = new RegExp(schema.pattern)
    } catch {
      return `${args.path} schema pattern must be a valid regular expression`
    }
    if (typeof args.value === 'string' && !regex.test(args.value)) {
      return `${args.path} must match pattern ${schema.pattern}`
    }
  }

  if ('minimum' in schema) {
    const minimum = schema.minimum
    if (!isFiniteNumber(minimum)) {
      return `${args.path} schema minimum must be a finite number`
    }
    if (isFiniteNumber(args.value) && args.value < minimum) {
      return `${args.path} must be >= ${minimum}`
    }
  }

  if ('maximum' in schema) {
    const maximum = schema.maximum
    if (!isFiniteNumber(maximum)) {
      return `${args.path} schema maximum must be a finite number`
    }
    if (isFiniteNumber(args.value) && args.value > maximum) {
      return `${args.path} must be <= ${maximum}`
    }
  }

  if ('exclusiveMinimum' in schema) {
    const exclusiveMinimum = schema.exclusiveMinimum
    if (!isFiniteNumber(exclusiveMinimum)) {
      return `${args.path} schema exclusiveMinimum must be a finite number`
    }
    if (isFiniteNumber(args.value) && !(args.value > exclusiveMinimum)) {
      return `${args.path} must be > ${exclusiveMinimum}`
    }
  }

  if ('exclusiveMaximum' in schema) {
    const exclusiveMaximum = schema.exclusiveMaximum
    if (!isFiniteNumber(exclusiveMaximum)) {
      return `${args.path} schema exclusiveMaximum must be a finite number`
    }
    if (isFiniteNumber(args.value) && !(args.value < exclusiveMaximum)) {
      return `${args.path} must be < ${exclusiveMaximum}`
    }
  }

  if ('minItems' in schema) {
    const minItems = schema.minItems
    if (!isNonNegativeInteger(minItems)) {
      return `${args.path} schema minItems must be a nonnegative integer`
    }
    if (Array.isArray(args.value) && args.value.length < minItems) {
      return `${args.path} must contain at least ${minItems} items`
    }
  }

  if ('maxItems' in schema) {
    const maxItems = schema.maxItems
    if (!isNonNegativeInteger(maxItems)) {
      return `${args.path} schema maxItems must be a nonnegative integer`
    }
    if (Array.isArray(args.value) && args.value.length > maxItems) {
      return `${args.path} must contain at most ${maxItems} items`
    }
  }

  if ('minProperties' in schema) {
    const minProperties = schema.minProperties
    if (!isNonNegativeInteger(minProperties)) {
      return `${args.path} schema minProperties must be a nonnegative integer`
    }
    if (isPlainObject(args.value) && Object.keys(args.value).length < minProperties) {
      return `${args.path} must contain at least ${minProperties} properties`
    }
  }

  if ('maxProperties' in schema) {
    const maxProperties = schema.maxProperties
    if (!isNonNegativeInteger(maxProperties)) {
      return `${args.path} schema maxProperties must be a nonnegative integer`
    }
    if (isPlainObject(args.value) && Object.keys(args.value).length > maxProperties) {
      return `${args.path} must contain at most ${maxProperties} properties`
    }
  }

  const shouldValidateObject =
    (allowedTypes?.includes('object') ?? false) ||
    (!allowedTypes && ('properties' in schema || 'required' in schema || 'additionalProperties' in schema))

  if (shouldValidateObject) {
    if (!isPlainObject(args.value)) return `${args.path} must be an object`
    const valueObject = args.value
    const properties = isPlainObject(schema.properties) ? schema.properties : {}

    if ('required' in schema) {
      if (!Array.isArray(schema.required)) return `${args.path} schema required must be a string[]`
      for (const key of schema.required) {
        if (typeof key !== 'string') return `${args.path} schema required must contain only strings`
        if (!(key in valueObject)) return `${childPath(args.path, key)} is required`
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!(key in valueObject)) continue
      const err = validateJsonValue({
        rootSchema: args.rootSchema,
        schema: propertySchema,
        value: valueObject[key],
        path: childPath(args.path, key),
        depth: args.depth + 1,
      })
      if (err) return err
    }

    const additionalProperties = schema.additionalProperties
    if (additionalProperties === false) {
      for (const key of Object.keys(valueObject)) {
        if (!(key in properties)) return `${childPath(args.path, key)} is not allowed`
      }
    } else if (isPlainObject(additionalProperties)) {
      for (const [key, propValue] of Object.entries(valueObject)) {
        if (key in properties) continue
        const err = validateJsonValue({
          rootSchema: args.rootSchema,
          schema: additionalProperties,
          value: propValue,
          path: childPath(args.path, key),
          depth: args.depth + 1,
        })
        if (err) return err
      }
    } else if (
      additionalProperties !== undefined &&
      additionalProperties !== true
    ) {
      return `${args.path} schema additionalProperties must be boolean or schema object`
    }
  }

  const shouldValidateArray =
    (allowedTypes?.includes('array') ?? false) || (!allowedTypes && 'items' in schema)

  if (shouldValidateArray) {
    if (!Array.isArray(args.value)) return `${args.path} must be an array`
    const itemsSchema = schema.items
    if (itemsSchema === undefined) return null

    if (Array.isArray(itemsSchema)) {
      for (let idx = 0; idx < Math.min(itemsSchema.length, args.value.length); idx += 1) {
        const err = validateJsonValue({
          rootSchema: args.rootSchema,
          schema: itemsSchema[idx],
          value: args.value[idx],
          path: childPath(args.path, idx),
          depth: args.depth + 1,
        })
        if (err) return err
      }
      return null
    }

    if (!isPlainObject(itemsSchema)) return `${args.path} schema items must be schema object or schema array`
    for (let idx = 0; idx < args.value.length; idx += 1) {
      const err = validateJsonValue({
        rootSchema: args.rootSchema,
        schema: itemsSchema,
        value: args.value[idx],
        path: childPath(args.path, idx),
        depth: args.depth + 1,
      })
      if (err) return err
    }
  }

  return null
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()
  const trimmed = text.trim()
  if (trimmed) {
    candidates.push(trimmed)
    seen.add(trimmed)
  }

  const fenceRegex = /```(?:json|JSON)?\s*([\s\S]*?)```/g
  for (const match of trimmed.matchAll(fenceRegex)) {
    const candidate = String(match[1] || '').trim()
    if (!candidate || seen.has(candidate)) continue
    candidates.push(candidate)
    seen.add(candidate)
  }

  return candidates
}

function parseJsonFromText(text: string): { value: unknown; error: string | null } {
  const candidates = extractJsonCandidates(text)
  if (candidates.length === 0) {
    return {
      value: null,
      error: 'Model returned empty output for structured_output',
    }
  }

  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      return { value: JSON.parse(candidate), error: null }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    value: null,
    error: `Failed to parse model output as JSON: ${errors.join(' | ')}`,
  }
}

export type StructuredOutputParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

export function validateStructuredOutputValue(args: {
  schema: Record<string, unknown>
  value: unknown
}): StructuredOutputParseResult {
  const validationError = validateJsonValue({
    rootSchema: args.schema,
    schema: args.schema,
    value: args.value,
    path: '$',
    depth: 0,
  })

  if (validationError) {
    return {
      ok: false,
      error: `Structured output failed schema validation: ${validationError}`,
    }
  }

  return {
    ok: true,
    value: args.value,
  }
}

export function parseAndValidateStructuredOutput(args: {
  schema: Record<string, unknown>
  text: string
}): StructuredOutputParseResult {
  const parsed = parseJsonFromText(args.text)
  if (parsed.error) {
    return {
      ok: false,
      error: parsed.error,
    }
  }

  return validateStructuredOutputValue({
    schema: args.schema,
    value: parsed.value,
  })
}

export function buildStructuredOutputSystemPrompt(schema: Record<string, unknown>): string {
  const schemaText = JSON.stringify(schema, null, 2)
  return [
    'Return your final answer as JSON that matches the required JSON Schema.',
    'Do not include markdown code fences.',
    'Do not include any prose before or after the JSON.',
    `Required JSON Schema:\n${schemaText}`,
  ].join('\n\n')
}

export function buildStructuredOutputRetryPrompt(args: {
  schema: Record<string, unknown>
  validationError: string
}): string {
  const schemaText = JSON.stringify(args.schema, null, 2)
  return [
    'Your previous response did not match the required JSON Schema.',
    `Validation error: ${args.validationError}`,
    'Return ONLY valid JSON and nothing else.',
    `Required JSON Schema:\n${schemaText}`,
  ].join('\n\n')
}
