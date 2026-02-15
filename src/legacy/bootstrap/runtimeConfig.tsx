import React from 'react'
import { render } from 'ink'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { testSetupConnection } from '../../adapters/setup/connectionTest.js'
import { writeSetupFiles } from '../../adapters/setup/writeSetupFiles.js'
import { loadRuntimeConfig } from '../../env/config.js'
import { InputScopeProvider } from '../../features/repl/inputScopeContext.js'
import type { SetupProviderOption } from '../../core/setup/types.js'
import { SetupWizard } from '../../ui/SetupWizard.js'
import type { BootstrapContext } from './types.js'

const SETUP_PROVIDER_OPTIONS: SetupProviderOption[] = [
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

async function runSetupWizard(args: { cwd: string; env: NodeJS.ProcessEnv }): Promise<void> {
  const fileStore = createNodeFileStore()
  await new Promise<void>((resolve, reject) => {
    const instance = render(
      <InputScopeProvider initialScope="wizard:setup">
        <SetupWizard
          providers={SETUP_PROVIDER_OPTIONS}
          testConnection={testSetupConnection}
          onWrite={async (draft) => {
            if (!draft.provider) throw new Error('Missing provider')
            await writeSetupFiles({
              fileStore,
              cwd: args.cwd,
              env: args.env,
              provider: draft.provider,
              baseUrl: draft.baseUrl,
              apiKey: draft.apiKey,
              model: draft.model,
              tierModels: draft.tierModels,
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
}

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
    await runSetupWizard({ cwd: args.cwd, env: args.env })
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
