import pkg from '../../package.json'
import { AppServer } from './server.js'
import { classifyRpcMessage, JSON_RPC_ERRORS, makeErrorResponse, parseJsonLine } from './jsonrpc.js'
import { createStdioJsonlTransport } from './transport/stdio.js'

export async function runAppServer(args?: {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
}): Promise<void> {
  const transport = createStdioJsonlTransport({
    input: args?.input,
    output: args?.output,
  })
  const server = new AppServer({
    info: {
      name: 'formax',
      version: String((pkg as any)?.version || 'unknown'),
    },
  })

  await transport.listen(async (line) => {
    const parsed = parseJsonLine(line)
    if ('message' in parsed) {
      await transport.send(
        makeErrorResponse(null, {
          code: JSON_RPC_ERRORS.PARSE_ERROR,
          message: parsed.message,
        }),
      )
      return
    }

    const message = classifyRpcMessage(parsed.value)
    const responses = server.handleMessage(message)
    for (const response of responses) {
      await transport.send(response)
    }
  })
}
