import fsp from 'node:fs/promises'
import path from 'node:path'

import { AnthropicStreamClient } from '../src/streaming/anthropic/StreamClient.js'
import type { ToolHandler } from '../src/tools/executor/index.js'
import { ToolRegistry } from '../src/tools/registry.js'
import { registerBuiltinToolModules } from '../src/tools/modules/index.js'
import { createAskUserQuestionToolModule } from '../src/tools/modules/askUserQuestion/index.js'
import { createKillShellToolModule } from '../src/tools/modules/killShell/index.js'
import { createTaskToolModule } from '../src/tools/modules/task/index.js'
import { createTaskOutputToolModule } from '../src/tools/modules/taskOutput/index.js'
import { createWebFetchToolModule } from '../src/tools/modules/webFetch/index.js'
import { patchTaskToolForSubagents } from '../src/tools/patches/taskSubagent.js'
import { TaskManager } from '../src/tools/runtime/taskManager.js'
import { createUserInputManager } from '../src/tools/runtime/userInputManager.js'
import type { ToolDefinition } from '../src/tools/types.js'

type SchemaShape = {
  properties: Set<string>
  required: Set<string>
  additionalProperties: unknown
}

type ToolsFile = { tools?: ToolDefinition[] }

async function main(): Promise<void> {
  const refPathArg = process.argv[2] || 'proxy/tools-copy.json'
  const refPath = path.resolve(process.cwd(), refPathArg)

  const registry = buildRegistryForSpecs()
  const specs = await registry.listSpecs()
  const implemented = new Map(specs.map((t) => [t.name, t]))

  const raw = await fsp.readFile(refPath, 'utf8')
  const parsed = JSON.parse(raw) as ToolsFile
  const referenceList = Array.isArray(parsed.tools) ? parsed.tools : []
  const reference = new Map(referenceList.map((t) => [t.name, t]))

  const shared = Array.from(reference.keys())
    .filter((name) => implemented.has(name))
    .sort()

  const missingTools = Array.from(reference.keys())
    .filter((name) => !implemented.has(name))
    .sort()

  const extraTools = Array.from(implemented.keys())
    .filter((name) => !reference.has(name))
    .sort()

  printSection(`Missing tools vs ${path.basename(refPath)} (${missingTools.length})`, missingTools)
  printSection(`Extra tools (not in ${path.basename(refPath)}) (${extraTools.length})`, extraTools)

  console.log(`\nParity checks (${shared.length} tools)`)
  let hasAnyDiff = false
  for (const name of shared) {
    const refTool = reference.get(name)!
    const implTool = implemented.get(name)!
    
    // Description comparison
    const descDiff = diffDescriptions(refTool.description, implTool.description)
    
    // Schema comparison (enhanced with canonical JSON)
    const schemaDiff = diffSchemas(refTool.input_schema, implTool.input_schema)
    
    if (descDiff.hasDiff || schemaDiff.hasDiff) {
      hasAnyDiff = true
      printToolDiff(name, { description: descDiff, schema: schemaDiff })
    }
  }
  
  if (!hasAnyDiff) {
    console.log('  ✓ All tools match reference')
  }
}

function buildRegistryForSpecs(): ToolRegistry {
  const taskManager = new TaskManager()
  const userInput = createUserInputManager()
  const registry = new ToolRegistry()

  registerBuiltinToolModules(registry, { taskManager, userInput })
  registry.register(createTaskOutputToolModule(taskManager))
  registry.register(createKillShellToolModule(taskManager))
  registry.register(createAskUserQuestionToolModule(userInput))

  const dummyClient = new AnthropicStreamClient({
    apiKey: '',
    baseUrl: 'http://localhost/v1',
    model: 'dummy',
    timeoutMs: 1000,
  })
  registry.register(
    createWebFetchToolModule({
      client: dummyClient,
      maxTokens: 256,
      maxInputChars: 120000,
    }),
  )

  const noopHandler: ToolHandler = {
    canHandle: () => false,
    execute: async (call) => ({ tool_use_id: call.id, content: 'not implemented', is_error: true }),
  }
  registry.register(createTaskToolModule(noopHandler))

  // Match the default CLI behavior: patch Task schema to list allowed subagents.
  registry.addPatch((tools) => patchTaskToolForSubagents(tools, []))

  return registry
}

function normalizeSchema(inputSchema: unknown): SchemaShape {
  const schema = inputSchema && typeof inputSchema === 'object' ? (inputSchema as any) : {}
  const propsObj = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
  const properties = new Set(Object.keys(propsObj))
  const required = new Set(Array.isArray(schema.required) ? schema.required.map((x: any) => String(x)) : [])
  return { properties, required, additionalProperties: schema.additionalProperties }
}

function diffDescriptions(ref: string, impl: string): {
  hasDiff: boolean
  normalizedRef: string
  normalizedImpl: string
} {
  const normalizedRef = normalizeDescription(ref)
  const normalizedImpl = normalizeDescription(impl)
  return {
    hasDiff: normalizedRef !== normalizedImpl,
    normalizedRef,
    normalizedImpl,
  }
}

function normalizeDescription(desc: string): string {
  // Normalize: unify line endings, trim trailing whitespace
  return desc.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+$/gm, '').trimEnd()
}

function diffSchemas(refSchema: unknown, implSchema: unknown): {
  hasDiff: boolean
  missingProps: string[]
  extraProps: string[]
  requiredOnlyInRef: string[]
  requiredOnlyInImpl: string[]
  additionalPropertiesRef: unknown
  additionalPropertiesImpl: unknown
  deepEqual: boolean
} {
  const ref = normalizeSchema(refSchema)
  const impl = normalizeSchema(implSchema)

  const missingProps = Array.from(ref.properties).filter((p) => !impl.properties.has(p)).sort()
  const extraProps = Array.from(impl.properties).filter((p) => !ref.properties.has(p)).sort()
  const requiredOnlyInRef = Array.from(ref.required).filter((p) => !impl.required.has(p)).sort()
  const requiredOnlyInImpl = Array.from(impl.required).filter((p) => !ref.required.has(p)).sort()

  const additionalPropertiesRef = ref.additionalProperties
  const additionalPropertiesImpl = impl.additionalProperties

  // Use canonical JSON comparison for deep equality
  const deepEqual = canonicalStringify(refSchema) === canonicalStringify(implSchema)
  const additionalDiff = !deepEqualValues(additionalPropertiesRef, additionalPropertiesImpl)
  const hasDiff = missingProps.length > 0 || extraProps.length > 0 || requiredOnlyInRef.length > 0 || requiredOnlyInImpl.length > 0 || additionalDiff || !deepEqual

  return {
    hasDiff,
    missingProps,
    extraProps,
    requiredOnlyInRef,
    requiredOnlyInImpl,
    additionalPropertiesRef,
    additionalPropertiesImpl,
    deepEqual,
  }
}

function deepEqualValues(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  try {
    return canonicalStringify(a) === canonicalStringify(b)
  } catch {
    return false
  }
}

/**
 * Canonical JSON stringify: recursively sorts object keys for consistent comparison.
 */
function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return String(obj)
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalStringify(item)).join(',') + ']'
  }
  
  const sortedKeys = Object.keys(obj).sort()
  const pairs = sortedKeys.map((key) => {
    const value = (obj as Record<string, unknown>)[key]
    return JSON.stringify(key) + ':' + canonicalStringify(value)
  })
  return '{' + pairs.join(',') + '}'
}

function printToolDiff(
  name: string,
  diffs: {
    description: ReturnType<typeof diffDescriptions>
    schema: ReturnType<typeof diffSchemas>
  },
): void {
  console.log(`\n- ${name}`)
  
  // Description differences
  if (diffs.description.hasDiff) {
    console.log(`  - description mismatch`)
    const refLines = diffs.description.normalizedRef.split('\n')
    const implLines = diffs.description.normalizedImpl.split('\n')
    const maxLines = Math.max(refLines.length, implLines.length)
    const diffCount = refLines.length !== implLines.length
      ? ` (${refLines.length} vs ${implLines.length} lines)`
      : ''
    console.log(`    Reference${diffCount}: ${refLines.slice(0, 3).join(' ')}${refLines.length > 3 ? '...' : ''}`)
    console.log(`    Implementation${diffCount}: ${implLines.slice(0, 3).join(' ')}${implLines.length > 3 ? '...' : ''}`)
  }
  
  // Schema differences
  if (diffs.schema.hasDiff) {
    if (!diffs.schema.deepEqual) {
      console.log(`  - schema structure mismatch (use canonical JSON comparison)`)
    }
    if (diffs.schema.missingProps.length > 0) console.log(`  - missing properties: ${diffs.schema.missingProps.join(', ')}`)
    if (diffs.schema.extraProps.length > 0) console.log(`  - extra properties: ${diffs.schema.extraProps.join(', ')}`)
    if (diffs.schema.requiredOnlyInRef.length > 0) console.log(`  - required (ref only): ${diffs.schema.requiredOnlyInRef.join(', ')}`)
    if (diffs.schema.requiredOnlyInImpl.length > 0) console.log(`  - required (impl only): ${diffs.schema.requiredOnlyInImpl.join(', ')}`)

    if (!deepEqualValues(diffs.schema.additionalPropertiesRef, diffs.schema.additionalPropertiesImpl)) {
      console.log(
        `  - additionalProperties: ref=${formatValue(diffs.schema.additionalPropertiesRef)} impl=${formatValue(
          diffs.schema.additionalPropertiesImpl,
        )}`,
      )
    }
  }
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function printSection(title: string, items: string[]): void {
  console.log(`\n${title}`)
  if (items.length === 0) {
    console.log('  (none)')
    return
  }
  for (const item of items) console.log(`  - ${item}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
