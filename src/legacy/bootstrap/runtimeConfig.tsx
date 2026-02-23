import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { loadRuntimeConfig } from '../../env/config.js'
import { runLegacySetupWizard } from '../../services/runtimeUiBridge.js'
import type { BootstrapContext } from './types.js'

export async function createRuntimeConfigContext(args: {
  cwd: string
  env: NodeJS.ProcessEnv
  forceSetup?: boolean
  onBeforeConfigLoad?: () => Promise<void>
  onAfterSetupCompleted?: () => Promise<void>
}): Promise<BootstrapContext> {
  await args.onBeforeConfigLoad?.()
  const fileStore = createNodeFileStore()
  let cfg = await loadRuntimeConfig(args.env, args.cwd, { fileStore })
  if (args.forceSetup === true || !cfg.llm.apiKey.trim()) {
    await runLegacySetupWizard({ cwd: args.cwd, env: args.env })
    await args.onAfterSetupCompleted?.()
    cfg = await loadRuntimeConfig(args.env, args.cwd, { fileStore })
  }

  return {
    cwd: args.cwd,
    env: args.env,
    fileStore,
    cfg,
  }
}
