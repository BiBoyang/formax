import pkg from '../../../package.json'
import type { RuntimeConfig } from '../../env/config'
import type { TaskManager } from '../../tools/runtime/taskManager'
import type { PlanSessionManager } from '../../features/repl/planSession'
import { createSlashCommandRegistry } from '../../features/commands/registry'
import { createStatusSnapshot } from '../../core/diagnostics/status'
import { runDoctor } from '../../core/diagnostics/doctor'
import { formatDoctorHuman } from '../../core/diagnostics/format'
import { configShow } from '../../core/config/show'
import { testSetupConnection } from '../../adapters/setup/connectionTest'
import { checkWritableDir } from '../../adapters/fs/checkWritableDir'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore'
import type { ModelTier } from '../../env/modelTier'

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
        const store = createNodeFileStore()
        const shown = await configShow({
          fileStore: store,
          cwd: process.cwd(),
          env: process.env,
          platform: process.platform,
        })
        const report = await runDoctor({
          version: String((pkg as any)?.version || 'unknown'),
          cwd: process.cwd(),
          provider: shown.config.llm.provider,
          runtime: {
            llm: { apiKey: cfg.llm.apiKey, baseUrl: cfg.llm.baseUrl, model: cfg.llm.model },
            paths: cfg.paths,
          },
          config: { paths: shown.paths, files: shown.files },
          warnings: shown.warnings,
          testConnection: testSetupConnection,
          checkWritableDir,
        })
        return (
          formatDoctorHuman({
            version: report.version,
            cwd: report.cwd,
            checks: report.checks,
            warnings: report.warnings,
          }) + '\n'
        )
      },
    },
  })
}
