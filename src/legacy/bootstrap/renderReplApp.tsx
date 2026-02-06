import React from 'react'
import { render } from 'ink'
import { REPL } from '../../screens/REPL.js'
import { UserInputProvider } from '../../tools/runtime/userInputContext.js'
import { InputScopeProvider } from '../../features/repl/inputScopeContext.js'
import type { RuntimeConfig } from '../../env/config.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { TaskManager } from '../../tools/runtime/taskManager.js'
import type { ToolDefinition } from '../../tools/types.js'
import type { ChatEngine, ChatHistory } from '../../chat/engine.js'
import type { UserInputManager } from '../../tools/runtime/userInputManager.js'
import type { Msg } from '../../components/tool/ToolMessage.js'

export function renderReplApp(args: {
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
}): ReturnType<typeof render> {
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
    },
  )
}
