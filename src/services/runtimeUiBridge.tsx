import React from 'react'
import { render } from 'ink'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore.js'
import { testSetupConnection } from '../adapters/setup/connectionTest.js'
import { writeSetupFiles } from '../adapters/setup/writeSetupFiles.js'
import type { ChatEngine, ChatHistory } from '../chat/engine.js'
import type { SetupProviderOption } from '../core/setup/types.js'
import type { RuntimeConfig } from '../config/config.js'
import { InputScopeProvider } from '../features/repl/inputScopeContext.js'
import { LoadingExampleScreen } from '../screens/LoadingExampleScreen.js'
import { REPL } from '../screens/REPL.js'
import { ToolExamplesScreen } from '../screens/ToolExamplesScreen.js'
import { TranscriptPerfScreen } from '../screens/perf/TranscriptPerfScreen.js'
import type { Msg } from '../shared/toolMessageTypes.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { ToolDefinition } from '../tools/types.js'
import type { TaskManager } from '../tools/runtime/taskManager.js'
import { UserInputProvider } from '../tools/runtime/userInputContext.js'
import type { UserInputManager } from '../tools/runtime/userInputManager.js'
import { createSafeInkStdout } from '../shared/utils/inkStreams.js'
import { SetupWizard } from '../ui/SetupWizard.js'

const SETUP_PROVIDER_OPTIONS: SetupProviderOption[] = [
  {
    id: 'anthropic',
    label: 'Anthropic-compatible',
    description: 'Anthropic-compatible API',
  },
  {
    id: 'openai',
    label: 'OpenAI-compatible',
    description: 'OpenAI-compatible API',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    description: 'Not supported yet in setup',
    disabled: true,
  },
]

export type LegacyReplRenderArgs = {
  engine: ChatEngine
  tools: ToolDefinition[]
  cfg: RuntimeConfig
  initialSession?: {
    filePath: string
    messages: Msg[]
    history: ChatHistory
  } | null
  allowedSubagents: Array<{ name: string; description: string }>
  reloadSubagents: () => Promise<Array<{ name: string; description: string }>>
  toolRegistry: ToolRegistry
  taskManager: TaskManager
  userInputManager: UserInputManager
  onClearTerminal: () => Promise<void>
  onExit: () => void
}

export function renderLegacyReplApp(args: LegacyReplRenderArgs): ReturnType<typeof render> {
  return render(
    <InputScopeProvider initialScope="repl">
      <UserInputProvider userInput={args.userInputManager}>
        <REPL
          engine={args.engine}
          tools={args.tools}
          cfg={args.cfg}
          initialSession={args.initialSession ?? undefined}
          onClearTerminal={args.onClearTerminal}
          allowedSubagents={args.allowedSubagents}
          reloadSubagents={args.reloadSubagents}
          toolRegistry={args.toolRegistry}
          taskManager={args.taskManager}
          onExit={args.onExit}
        />
      </UserInputProvider>
    </InputScopeProvider>,
    {
      exitOnCtrlC: false,
      stdout: createSafeInkStdout(process.stdout),
    },
  )
}

export async function runLegacySetupWizard(args: { cwd: string; env: NodeJS.ProcessEnv }): Promise<void> {
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
              contextWindowTokens: draft.contextWindowTokens,
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

export function renderToolExamplesEntry(args: {
  toolRegistry: ToolRegistry
  onExit: () => void
}): ReturnType<typeof render> {
  return render(
    <InputScopeProvider>
      <ToolExamplesScreen toolRegistry={args.toolRegistry} onExit={args.onExit} />
    </InputScopeProvider>,
    {
      exitOnCtrlC: false,
    },
  )
}

export function renderLoadingExamplesEntry(args: { onExit: () => void }): ReturnType<typeof render> {
  return render(<LoadingExampleScreen onExit={args.onExit} />, {
    exitOnCtrlC: false,
  })
}

export function renderTranscriptPerfEntry(args: {
  count: number
  onExit: () => void
}): ReturnType<typeof render> {
  return render(<TranscriptPerfScreen count={args.count} onExit={args.onExit} />, {
    exitOnCtrlC: false,
  })
}
