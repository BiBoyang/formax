import { createChatEngine } from '../../chat/engine.js'
import type { AnthropicCompatibleStreamClient } from '../../streaming/index.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { ToolPreflight } from '../../tools/executor/index.js'
import type { AuditLog } from '../../adapters/audit/auditLog.js'
import type { HooksRuntime } from '../../hooks/runtime.js'
import { createToolExecutor } from '../../tools/executor/index.js'
import type { RuntimeFlags } from '../../config/runtimeFlags.js'

export function createChatRuntime(args: {
  client: AnthropicCompatibleStreamClient
  toolRegistry: ToolRegistry
  preflight: ToolPreflight
  hooks: HooksRuntime
  audit: AuditLog
  runtimeFlags: RuntimeFlags
}): {
  executor: ReturnType<typeof createToolExecutor>
  engine: ReturnType<typeof createChatEngine>
} {
  const executor = createToolExecutor(args.toolRegistry.getHandlers(), { preflight: args.preflight, audit: args.audit })
  const engine = createChatEngine({
    client: args.client,
    executor,
    hooks: args.hooks,
    audit: args.audit,
    runtimeFlags: args.runtimeFlags,
  })
  return { executor, engine }
}
