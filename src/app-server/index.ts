import pkg from '../../package.json'
import { createRuntime } from '../runtime/createRuntime.js'
import { AppServer } from './server.js'
import { classifyRpcMessage, JSON_RPC_ERRORS, makeErrorResponse, parseJsonLine } from './jsonrpc.js'
import { ThreadStore } from './threadStore.js'
import { TurnRunner } from './turnRunner.js'
import { createStdioJsonlTransport } from './transport/stdio.js'

export async function runAppServer(args?: {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
  threadStore?: Pick<ThreadStore, 'startThread' | 'resumeThread' | 'listThreads' | 'readThread'>
  turnRunner?: Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'>
}): Promise<void> {
  const cwd = args?.cwd ?? process.cwd()
  const env = args?.env ?? process.env
  const transport = createStdioJsonlTransport({
    input: args?.input,
    output: args?.output,
  })
  const threadStore =
    args?.threadStore ??
    new ThreadStore({
      cwd,
      env,
      platform: args?.platform,
      homedir: args?.homedir,
    })
  let lazyTurnRunner: Pick<TurnRunner, 'startTurn' | 'interruptTurn' | 'submitInput'> | null = args?.turnRunner ?? null
  const server = new AppServer({
    info: {
      name: 'formax',
      version: String((pkg as any)?.version || 'unknown'),
    },
    threadStore,
    turnRunner: lazyTurnRunner ?? undefined,
    resolveTurnRunner: async () => {
      if (lazyTurnRunner) return lazyTurnRunner
      const runtime = await createRuntime({ cwd, env })
      lazyTurnRunner = new TurnRunner({
        engine: runtime.engine,
        tools: runtime.tools,
        allowedSubagents: runtime.allowedSubagents,
        model: runtime.cfg.llm.model,
        promptProfile: runtime.cfg.ui.promptProfile,
        thinkingEnabled: runtime.cfg.llm.thinkingMode,
        cwd,
        env,
        platform: args?.platform,
        homedir: args?.homedir,
        userInputManager: runtime.userInputManager,
        emitNotification: server.createTurnNotificationEmitter(),
      })
      return lazyTurnRunner
    },
    emitNotification: (message) => {
      void transport.send(message).catch(() => undefined)
    },
  })

  await transport.listen(async (line) => {
    const parsed = parseJsonLine(line)
    if (parsed.ok === false) {
      await transport.send(
        makeErrorResponse(null, {
          code: JSON_RPC_ERRORS.PARSE_ERROR,
          message: parsed.message,
        }),
      )
      return
    }

    const message = classifyRpcMessage(parsed.value)
    const responses = await server.handleMessage(message)
    for (const response of responses) {
      await transport.send(response)
    }
  })
}
