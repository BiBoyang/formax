import path from 'node:path'
import { getConfigPaths } from '../../adapters/fs/configPaths'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore'
import { detectWorkspaceRoots, type WorkspaceRootsResult } from '../../adapters/fs/workspaceRoots'
import { updateConfigPatchFile } from '../../core/config/persist'
import type { ModelTier } from '../../env/modelTier'

export function resolveUserAgentsDir(args?: {
  cwd?: string
  env?: NodeJS.ProcessEnv
}): string {
  const cwd = args?.cwd ?? process.cwd()
  const env = args?.env ?? process.env
  const configPaths = getConfigPaths({ cwd, env })
  const globalConfigDir = path.resolve(cwd, configPaths.globalConfigDir)
  return path.join(globalConfigDir, 'agents')
}

export async function persistDefaultModelTier(args: {
  nextTier: ModelTier
  cwd?: string
  env?: NodeJS.ProcessEnv
}): Promise<void> {
  const cwd = args.cwd ?? process.cwd()
  const env = args.env ?? process.env
  const store = createNodeFileStore()
  const paths = getConfigPaths({ cwd, env })
  await updateConfigPatchFile({
    fileStore: store,
    filePath: paths.globalConfigPath,
    nextPatch: { llm: { defaultTier: args.nextTier } },
    label: 'llm.defaultTier',
  })
}

export async function loadWorkspaceRoots(args?: {
  cwd?: string
}): Promise<WorkspaceRootsResult> {
  const cwd = args?.cwd ?? process.cwd()
  const store = createNodeFileStore()
  return detectWorkspaceRoots({ fileStore: store, cwd })
}
