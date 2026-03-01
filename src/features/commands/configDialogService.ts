import type { FileStore } from '../../adapters/fs/fileStore.js'
import { loadConfigFiles } from '../../adapters/fs/configFiles.js'
import { getConfigPaths } from '../../adapters/fs/configPaths.js'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { updateConfigPatchFile } from '../../config/settings/persist.js'
import { resolveRuntimeConfig } from '../../config/settings/resolve.js'
import { OutputStyleSchema, type FormaxConfigV1Patch } from '../../config/settings/schema.js'

export type ConfigDialogSettingId = 'outputStyle' | 'thinkingMode' | 'verboseOutput'

export type ConfigDialogSnapshot = {
  values: {
    outputStyle: string
    thinkingMode: boolean
    verboseOutput: boolean
  }
  sources: {
    outputStyle: string
    thinkingMode: string
    verboseOutput: string
  }
}

export type ConfigDialogService = {
  load: () => Promise<ConfigDialogSnapshot>
  persist: (args: { id: ConfigDialogSettingId; value: unknown }) => Promise<void>
}

function sourceToLabel(source: string | undefined): string {
  switch (source) {
    case 'default':
      return 'Default'
    case 'global':
      return 'User'
    case 'project':
      return 'Project'
    case 'env':
      return 'Env'
    case 'flags':
      return 'Flags'
    default:
      return 'Default'
  }
}

function buildConfigPatch(args: { id: ConfigDialogSettingId; value: unknown }): FormaxConfigV1Patch {
  const { id, value } = args
  if (id === 'outputStyle') {
    const parsed = OutputStyleSchema.safeParse(value)
    return { ui: { outputStyle: parsed.success ? parsed.data : 'default' } }
  }
  if (id === 'thinkingMode') return { llm: { thinkingMode: Boolean(value) } }
  return { ui: { verboseOutput: Boolean(value) } }
}

function getTargetFilePath(args: {
  id: ConfigDialogSettingId
  globalConfigPath: string
  projectConfigPath: string
}): string {
  if (args.id === 'outputStyle') return args.projectConfigPath
  return args.globalConfigPath
}

export function createConfigDialogService(args?: {
  fileStore?: FileStore
  cwd?: string
  env?: NodeJS.ProcessEnv
}): ConfigDialogService {
  const fileStore = args?.fileStore ?? createNodeFileStore()
  const cwd = args?.cwd ?? process.cwd()
  const env = args?.env ?? process.env

  return {
    async load(): Promise<ConfigDialogSnapshot> {
      const disk = await loadConfigFiles({ fileStore, cwd, env })
      const resolved = resolveRuntimeConfig({
        env: env as Record<string, string | undefined>,
        globalConfig: disk.globalConfig,
        projectConfig: disk.projectConfig,
        authStore: disk.authStore,
      })

      return {
        values: {
          outputStyle: resolved.config.ui.outputStyle,
          thinkingMode: resolved.config.llm.thinkingMode,
          verboseOutput: resolved.config.ui.verboseOutput,
        },
        sources: {
          outputStyle: sourceToLabel(resolved.sources['ui.outputStyle']),
          thinkingMode: sourceToLabel(resolved.sources['llm.thinkingMode']),
          verboseOutput: sourceToLabel(resolved.sources['ui.verboseOutput']),
        },
      }
    },
    async persist({ id, value }): Promise<void> {
      const paths = getConfigPaths({ cwd, env })
      const filePath = getTargetFilePath({
        id,
        globalConfigPath: paths.globalConfigPath,
        projectConfigPath: paths.projectConfigPath,
      })

      await updateConfigPatchFile({
        fileStore,
        filePath,
        nextPatch: buildConfigPatch({ id, value }),
        label: id,
      })
    },
  }
}
