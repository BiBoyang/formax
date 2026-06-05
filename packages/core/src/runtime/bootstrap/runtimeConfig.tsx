import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { loadRuntimeConfig } from '../../config/config.js'
import { runLegacySetupWizard } from '../../services/runtimeUiBridge.js'
import type { BootstrapContext } from './types.js'

export async function createRuntimeConfigContext(args: {
  cwd: string
  env: NodeJS.ProcessEnv
  forceSetup?: boolean
  loadMcpConfig?: boolean
  onBeforeConfigLoad?: () => Promise<void>
  onAfterSetupCompleted?: () => Promise<void>
}): Promise<BootstrapContext> {
  await args.onBeforeConfigLoad?.()
  const fileStore = createNodeFileStore()
  const loadOptions = { fileStore, loadMcpConfig: args.loadMcpConfig !== false }
  let cfg = await loadRuntimeConfig(args.env, args.cwd, loadOptions)
  if (args.forceSetup === true || !cfg.llm.apiKey.trim()) {
    await runLegacySetupWizard({ cwd: args.cwd, env: args.env })
    await args.onAfterSetupCompleted?.()
    cfg = await loadRuntimeConfig(args.env, args.cwd, loadOptions)
  }

  return {
    cwd: args.cwd,
    env: args.env,
    fileStore,
    cfg,
  }
}
