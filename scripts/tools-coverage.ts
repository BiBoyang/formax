import fsp from 'node:fs/promises'
import path from 'node:path'

import { AnthropicStreamClient } from '../packages/core/src/streaming/anthropic/StreamClient.js'
import type { ToolHandler } from '../packages/core/src/tools/executor/index.js'
import { ToolRegistry } from '../packages/core/src/tools/registry.js'
import { registerBuiltinToolModules } from '../packages/core/src/tools/modules/index.js'
import { createAskUserQuestionToolModule } from '../packages/core/src/tools/modules/askUserQuestion/index.js'
import { createKillShellToolModule } from '../packages/core/src/tools/modules/killShell/index.js'
import { createTaskToolModule } from '../packages/core/src/tools/modules/task/index.js'
import { createTaskOutputToolModule } from '../packages/core/src/tools/modules/taskOutput/index.js'
import { createWebFetchToolModule } from '../packages/core/src/tools/modules/webFetch/index.js'
import { TaskManager } from '../packages/core/src/tools/runtime/taskManager.js'
import { createUserInputManager } from '../packages/core/src/tools/runtime/userInputManager.js'

type ToolsFile = { tools?: Array<{ name?: string }> }

async function main(): Promise<void> {
  const refPathArg = process.argv[2] || 'packages/core/src/tools/specs/reference/tools-copy.json'
  const refPath = path.resolve(process.cwd(), refPathArg)

  const registry = buildRegistryForSpecs()
  const specs = await registry.listSpecs()
  const implemented = new Set(specs.map((t) => t.name))

  const raw = await fsp.readFile(refPath, 'utf8')
  const parsed = JSON.parse(raw) as ToolsFile
  const reference = new Set((parsed.tools || []).map((t) => String(t?.name || '').trim()).filter(Boolean))

  const implementedList = Array.from(implemented).sort()
  const missing = Array.from(reference).filter((n) => !implemented.has(n)).sort()
  const extra = Array.from(implemented).filter((n) => !reference.has(n)).sort()

  printSection(`Implemented (${implementedList.length})`, implementedList)
  printSection(`Missing vs ${path.basename(refPath)} (${missing.length})`, missing)
  printSection(`Extra (not in ${path.basename(refPath)}) (${extra.length})`, extra)
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

  return registry
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
