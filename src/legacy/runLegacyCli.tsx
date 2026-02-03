import path from 'node:path'
import React from 'react'
import { render } from 'ink'
import { clearTerminal } from '../utils/terminal.js'
import { REPL } from '../screens/REPL.js'
import { startConsoleLogger, stopConsoleLogger } from '../utils/consoleLogger.js'
import { loadRuntimeConfig } from '../env/config.js'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore.js'
import { getConfigPaths } from '../adapters/fs/configPaths.js'
import { createToolExecutor } from '../tools/executor/index.js'
import { createApprovalService } from '../tools/executor/approvalService.js'
import { createPolicyPreflight } from '../tools/executor/policyPreflight.js'
import { createSkillPreflight } from '../tools/executor/skillPreflight.js'
import type { ToolPreflight } from '../tools/executor/index.js'
import { createNodeAuditLog } from '../adapters/audit/nodeAuditLog.js'
import { createSubAgentRegistry } from '../subagents/registry.js'
import { createSubAgentRunner } from '../subagents/runner.js'
import { createTaskSubAgentToolHandler } from '../tools/executor/handlers/taskSubAgent.js'
import { AnthropicStreamClient } from '../streaming/anthropic/StreamClient.js'
import { createChatEngine } from '../chat/engine.js'
import { createHooksRuntime } from '../hooks/runtime.js'
import { getKnownContextWindowTokens } from '../chat/context/modelWindow.js'
import { ToolRegistry } from '../tools/registry.js'
import { patchTaskToolForSubagents } from '../tools/patches/taskSubagent.js'
import { registerBuiltinToolModules } from '../tools/modules/index.js'
import { createTaskToolModule } from '../tools/modules/task/index.js'
import { createWebFetchToolModule } from '../tools/modules/webFetch/index.js'
import { TaskManager } from '../tools/runtime/taskManager.js'
import { createTaskOutputToolModule } from '../tools/modules/taskOutput/index.js'
import { createUserInputManager } from '../tools/runtime/userInputManager.js'
import { createAskUserQuestionToolModule } from '../tools/modules/askUserQuestion/index.js'
import { createKillShellToolModule } from '../tools/modules/killShell/index.js'
import { UserInputProvider } from '../tools/runtime/userInputContext.js'
import { InputScopeProvider } from '../features/repl/inputScopeContext.js'
import { findLatestSessionFile, readSessionFile } from '../features/repl/sessionSave/index.js'
import type { App } from '../core/app/createApp.js'
import { SetupWizard } from '../ui/SetupWizard.js'
import { testSetupConnection } from '../adapters/setup/connectionTest.js'
import { writeSetupFiles } from '../adapters/setup/writeSetupFiles.js'
import type { SetupProviderOption } from '../core/setup/types.js'

export async function runLegacyCli(_opts: { app?: App } = {}): Promise<void> {
  // 启动控制台日志服务器（可选，通过环境变量控制）
  const enableLogger = process.env.ENABLE_CONSOLE_LOGGER !== 'false'
  if (enableLogger) {
    const port = parseInt(process.env.CONSOLE_LOGGER_PORT || '3001', 10)
    // startConsoleLogger(port)
  }

  // Optional: clear screen for a clean chat view
  await clearTerminal()

  const fileStore = createNodeFileStore()
  let cfg = await loadRuntimeConfig(process.env, process.cwd(), { fileStore })
  const forceSetup = process.env.FORMAX_FORCE_SETUP === '1'
  if (forceSetup || !cfg.llm.apiKey.trim()) {
    const providerOptions: SetupProviderOption[] = [
      {
        id: 'anthropic',
        label: 'Anthropic (Claude)',
        description: 'Claude API (streaming + tools supported)',
      },
      {
        id: 'openai',
        label: 'OpenAI-compatible',
        description: 'Not supported yet in Formax REPL',
        disabled: true,
      },
      {
        id: 'gemini',
        label: 'Gemini',
        description: 'Not supported yet in Formax REPL',
        disabled: true,
      },
    ]

    try {
      await new Promise<void>((resolve, reject) => {
        const instance = render(
          <InputScopeProvider initialScope="wizard:setup">
            <SetupWizard
              providers={providerOptions}
              testConnection={testSetupConnection}
              onWrite={async (draft) => {
                if (!draft.provider) throw new Error('Missing provider')
                await writeSetupFiles({
                  fileStore,
                  cwd: process.cwd(),
                  env: process.env,
                  provider: draft.provider,
                  baseUrl: draft.baseUrl,
                  apiKey: draft.apiKey,
                  model: draft.model,
                })
              }}
              onDone={() => {
                instance.unmount()
                resolve()
              }}
              onCancel={() => {
                instance.unmount()
                reject(new Error('Setup canceled'))
              }}
            />
          </InputScopeProvider>,
          { exitOnCtrlC: false },
        )
      })
    } catch (err) {
      stopConsoleLogger()
      await clearTerminal()
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`Error: ${msg}\n`)
      process.exit(1)
    }

    await clearTerminal()
    cfg = await loadRuntimeConfig(process.env, process.cwd(), { fileStore })
  }
  const model = cfg.llm.model || 'claude-sonnet-4-5-20250929'

  const client = new AnthropicStreamClient({
    apiKey: cfg.llm.apiKey,
    baseUrl: cfg.llm.baseUrl,
    model,
    timeoutMs: cfg.llm.timeoutMs,
  })

  const webFetchClient = new AnthropicStreamClient({
    apiKey: cfg.llm.apiKey,
    baseUrl: cfg.llm.baseUrl,
    model: process.env.FORMAX_WEBFETCH_MODEL || model,
    timeoutMs: cfg.llm.timeoutMs,
  })

  const toolRegistry = new ToolRegistry()
  const taskManager = new TaskManager()
  const userInputManager = createUserInputManager()
  registerBuiltinToolModules(toolRegistry, { taskManager, userInput: userInputManager, cwd: process.cwd() })
  toolRegistry.register(
    createWebFetchToolModule({
      client: webFetchClient,
      maxTokens: Number(process.env.FORMAX_WEBFETCH_MAX_TOKENS || 1024),
      maxInputChars: Number(process.env.FORMAX_WEBFETCH_MAX_INPUT_CHARS || 120000),
    }),
  )

  toolRegistry.register(createTaskOutputToolModule(taskManager))
  toolRegistry.register(createKillShellToolModule(taskManager))
  toolRegistry.register(createAskUserQuestionToolModule(userInputManager))

  const subAgentRegistry = createSubAgentRegistry()
  const configPaths = getConfigPaths({ cwd: process.cwd(), env: process.env })
  const userAgentsDir = path.join(configPaths.globalConfigDir, 'agents')

  // Formax loads sub-agents from .formax only (global + project).
  // Order matters: later directories override earlier ones.
  const agentDirs = Array.from(new Set([userAgentsDir, cfg.paths.subagentsDir]))
  await subAgentRegistry.loadFromDirectories(agentDirs)
  const allowedSubagents = subAgentRegistry.list()
  const reloadSubagents = async () => {
    await subAgentRegistry.loadFromDirectories(agentDirs)
    return subAgentRegistry.list()
  }

  const toolsForSubagents = await toolRegistry.listSpecs()
  const providerForBudget = 'anthropic' as const
  const contextWindowTokens = cfg.llm.contextWindowTokens
    ?? getKnownContextWindowTokens({ provider: providerForBudget, model: cfg.llm.model })
  const promptBudget = contextWindowTokens
    ? {
        contextWindowTokens,
        effectiveContextWindowPercent: cfg.context.effectiveContextWindowPercent,
        autoCompactLimitPercent: cfg.context.autoCompactTokenLimitPercent,
        baselineTokens: cfg.context.baselineTokens,
      }
    : null
  const audit = createNodeAuditLog({ logsDir: cfg.paths.logsDir })
  const approval = createApprovalService({ fileStore, userInput: userInputManager, audit })
  const policyPreflight = createPolicyPreflight({ fileStore, approval, audit })
  const skillPreflight = createSkillPreflight({ fileStore, userInput: userInputManager })
  const preflight: ToolPreflight = async (call, ctx) =>
    (await skillPreflight(call, ctx)) ?? policyPreflight(call, ctx)
  const localExecutor = createToolExecutor(toolRegistry.getHandlers(), { preflight, audit })
  const subAgentRunner = createSubAgentRunner({
    client,
    executor: localExecutor,
    allTools: toolsForSubagents,
    promptBudget,
  })

  const taskHandler = createTaskSubAgentToolHandler({
    registry: subAgentRegistry,
    runner: subAgentRunner,
    taskManager,
  })

  toolRegistry.register(createTaskToolModule(taskHandler))
  // Keep tools-copy.json as the single source of truth for tool specs by default.
  // Set FORMAX_PATCH_TASK_TOOL=true if you want to patch Task.subagent_type into an enum of available subagents.
  if (process.env.FORMAX_PATCH_TASK_TOOL === 'true') {
    toolRegistry.addPatch((tools) => patchTaskToolForSubagents(tools, allowedSubagents))
  }
  const tools = await toolRegistry.listSpecs()
  const executor = createToolExecutor(toolRegistry.getHandlers(), { preflight, audit })
  const hooks = createHooksRuntime({ fileStore, env: process.env })
  const engine = createChatEngine({ client, executor, hooks, audit })

  let replInstance: ReturnType<typeof render> | null = null
  const onClearTerminal = async () => {
    // Keep Ink's internal "previous output" in sync with our terminal clear.
    // `instance.clear()` resets Ink's log-update buffer, while `clearTerminal()`
    // actually clears the terminal scrollback/screen.
    replInstance?.clear()
    await clearTerminal()
  }

  const resumeLast = String(process.env.FORMAX_RESUME_LAST ?? '').trim() === '1'
  const initialSession = resumeLast
    ? await (async () => {
        const filePath = await findLatestSessionFile({ cwd: process.cwd(), env: process.env })
        if (!filePath) return null
        const replay = await readSessionFile(filePath)
        return { filePath, messages: replay.messages, history: replay.history }
      })().catch(() => null)
    : null

  replInstance = render(
    <InputScopeProvider initialScope="repl">
      <UserInputProvider userInput={userInputManager}>
        <REPL
          engine={engine}
          tools={tools}
          cfg={cfg}
          initialSession={initialSession ?? undefined}
          onClearTerminal={onClearTerminal}
          allowedSubagents={allowedSubagents}
          reloadSubagents={reloadSubagents}
          toolRegistry={toolRegistry}
          taskManager={taskManager}
          onExit={() => {
            // stopConsoleLogger()
            process.exit(0)
          }}
        />
      </UserInputProvider>
    </InputScopeProvider>,
    {
      exitOnCtrlC: false,
    },
  )
}
