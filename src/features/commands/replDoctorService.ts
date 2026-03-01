import { checkWritableDir } from '../../adapters/fs/checkWritableDir'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore'
import { testSetupConnection } from '../../adapters/setup/connectionTest'
import { configShow } from '../../config/settings/show'
import { runDoctor } from '../../core/diagnostics/doctor'
import { formatDoctorHuman } from '../../core/diagnostics/format'
import type { RuntimeConfig } from '../../config/config'
import { getConfigPaths } from '../../config/configPaths'

export async function runReplDoctor(args: {
  version: string
  cfg: RuntimeConfig
  cwd?: string
  env?: NodeJS.ProcessEnv
}): Promise<string> {
  const cwd = args.cwd ?? process.cwd()
  const env = args.env ?? process.env
  const store = createNodeFileStore()
  const paths = getConfigPaths({ cwd, env, platform: process.platform })

  const shown = await configShow({
    fileStore: store,
    paths,
    cwd,
    env,
    platform: process.platform,
  })

  const report = await runDoctor({
    version: args.version,
    cwd,
    provider: shown.config.llm.provider,
    runtime: {
      llm: {
        apiKey: args.cfg.llm.apiKey,
        baseUrl: args.cfg.llm.baseUrl,
        model: args.cfg.llm.model,
      },
      paths: args.cfg.paths,
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
}
