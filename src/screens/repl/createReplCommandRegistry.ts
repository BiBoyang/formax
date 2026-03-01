import pkg from '../../../package.json'
import type { RuntimeConfig } from '../../env/config'
import type { TaskManager } from '../../tools/runtime/taskManager'
import type { PlanSessionManager } from '../../features/repl/planSession'
import { createSlashCommandRegistry } from '../../features/commands/registry'
import { runReplDoctor } from '../../features/commands/replDoctorService'
import { createStatusSnapshot } from '../../core/diagnostics/status'
import type { ModelTier } from '../../config/modelTier'

export function createReplCommandRegistry(args: {
  cfg: RuntimeConfig
  taskManager?: TaskManager
  planSession: PlanSessionManager
  promptProfile: RuntimeConfig['ui']['promptProfile']
  setPromptProfile: (next: RuntimeConfig['ui']['promptProfile']) => void
  setDefaultModelTier: (next: ModelTier) => Promise<ModelTier>
  workspaceRoots: string[]
  workspaceRootWarnings: string[]
}): ReturnType<typeof createSlashCommandRegistry> {
  const {
    cfg,
    taskManager,
    planSession,
    promptProfile,
    setPromptProfile,
    setDefaultModelTier,
    workspaceRoots,
    workspaceRootWarnings,
  } = args

  return createSlashCommandRegistry({
    cwd: process.cwd(),
    taskManager,
    plan: planSession,
    promptProfile: { get: () => promptProfile, set: setPromptProfile },
    modelTier: {
      get: () => (cfg.llm.defaultTier ?? 'sonnet') as ModelTier,
      set: setDefaultModelTier,
    },
    status: {
      get: () =>
        (() => {
          const base = createStatusSnapshot({
            version: String((pkg as any)?.version || 'unknown'),
            cwd: process.cwd(),
            runtime: {
              llm: {
                provider: cfg.llm.provider,
                baseUrl: cfg.llm.baseUrl,
                model: cfg.llm.model,
                timeoutMs: cfg.llm.timeoutMs,
                apiKey: cfg.llm.apiKey,
              },
              paths: cfg.paths,
              ui: { promptProfile, assistantTextMode: cfg.ui.assistantTextMode },
            },
            workspaceRoots,
          })

          if (!workspaceRootWarnings.length) return base
          return { ...base, warnings: [...base.warnings, ...workspaceRootWarnings] }
        })(),
    },
    doctor: {
      run: async () => {
        return runReplDoctor({
          version: String((pkg as any)?.version || 'unknown'),
          cfg,
          cwd: process.cwd(),
          env: process.env,
        })
      },
    },
  })
}
