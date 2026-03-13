import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolDefinition } from '../types'
import { ToolRegistry } from '../registry'
import { registerBuiltinToolModules } from '../modules/index'
import { createAskUserQuestionToolModule } from '../modules/askUserQuestion/index'
import { createKillShellToolModule } from '../modules/killShell/index'
import { createTaskToolModule } from '../modules/task/index'
import { createTaskOutputToolModule } from '../modules/taskOutput/index'
import { createWebFetchToolModule } from '../modules/webFetch/index'
import { patchTaskToolForSubagents } from '../patches/taskSubagent'
import { TaskManager } from '../runtime/taskManager'
import { createUserInputManager } from '../runtime/userInputManager'
import { AnthropicStreamClient } from '../../streaming/anthropic/StreamClient'
import type { ToolHandler } from '../executor'

type ToolsFile = { tools?: ToolDefinition[] }

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

/**
 * Normalize description: unify line endings, trim trailing whitespace.
 */
function normalizeDescription(desc: string): string {
  return desc.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+$/gm, '').trimEnd()
}

function normalizeSkillAvailableSkills(desc: string): string {
  return desc.replace(
    /<available_skills>[\s\S]*?<\/available_skills>/g,
    '<available_skills>\n\n</available_skills>',
  )
}

function buildTestRegistry(): ToolRegistry {
  const taskManager = new TaskManager()
  const userInput = createUserInputManager()
  const registry = new ToolRegistry()

  registerBuiltinToolModules(registry, { taskManager, userInput, cwd: process.cwd() })
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

function loadToolsCopyJson(): Map<string, ToolDefinition> {
  const refPath = join(
    process.cwd(),
    'packages',
    'core',
    'src',
    'tools',
    'specs',
    'reference',
    'tools-copy.json',
  )
  const raw = readFileSync(refPath, 'utf8')
  const parsed = JSON.parse(raw) as ToolsFile
  const referenceList = Array.isArray(parsed.tools) ? parsed.tools : []
  return new Map(referenceList.map((t) => [t.name, t]))
}

describe('Tool Spec Parity', () => {
  it('should match tools-copy.json for all tools', async () => {
    const registry = buildTestRegistry()
    const specs = await registry.listSpecs()
    const reference = loadToolsCopyJson()

    const implemented = new Map(specs.map((t) => [t.name, t]))
    const shared = Array.from(reference.keys())
      .filter((name) => implemented.has(name))
      .sort()

    for (const name of shared) {
      const refSpec = reference.get(name)!
      const implSpec = implemented.get(name)!

      // Skip SlashCommand - its description is dynamically built at runtime
      if (name === 'SlashCommand') {
        // Only assert the first line stays aligned; the rest is intentionally ported and/or dynamic.
        const refFirstLine = refSpec.description.split('\n')[0]
        const implFirstLine = implSpec.description.split('\n')[0]
        expect(normalizeDescription(implFirstLine)).toBe(normalizeDescription(refFirstLine))
        expect(canonicalStringify(implSpec.input_schema)).toBe(canonicalStringify(refSpec.input_schema))
        continue
      }

      // Skip Skill available skills list - it's dynamically built at runtime
      if (name === 'Skill') {
        const refNormalized = normalizeSkillAvailableSkills(refSpec.description)
        const implNormalized = normalizeSkillAvailableSkills(implSpec.description)
        expect(normalizeDescription(implNormalized)).toBe(normalizeDescription(refNormalized))
        expect(canonicalStringify(implSpec.input_schema)).toBe(canonicalStringify(refSpec.input_schema))
        continue
      }

      // Deep compare description
      expect(normalizeDescription(implSpec.description)).toBe(normalizeDescription(refSpec.description))

      // Deep compare input_schema using canonical JSON
      expect(canonicalStringify(implSpec.input_schema)).toBe(canonicalStringify(refSpec.input_schema))
    }
  })
})
