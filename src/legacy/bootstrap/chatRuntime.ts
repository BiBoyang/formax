import { createChatEngine } from '../../chat/engine.js'
import type { AnthropicStreamClient } from '../../streaming/anthropic/StreamClient.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { ToolPreflight } from '../../tools/executor/index.js'
import type { AuditLog } from '../../adapters/audit/auditLog.js'
import type { HooksRuntime } from '../../hooks/runtime.js'
import { createToolExecutor } from '../../tools/executor/index.js'

export function createChatRuntime(args: {
  client: AnthropicStreamClient
  toolRegistry: ToolRegistry
  preflight: ToolPreflight
  hooks: HooksRuntime
  audit: AuditLog
}): {
  executor: ReturnType<typeof createToolExecutor>
  engine: ReturnType<typeof createChatEngine>
} {
  const executor = createToolExecutor(args.toolRegistry.getHandlers(), { preflight: args.preflight, audit: args.audit })
  const engine = createChatEngine({ client: args.client, executor, hooks: args.hooks, audit: args.audit })
  return { executor, engine }
}
