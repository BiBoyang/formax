# Formax SDK (TypeScript)

This folder exposes the in-process SDK surface used by TypeScript callers.

Public entrypoint:
- `src/sdk/index.ts`

Primary API:
- `query(args): AsyncGenerator<QueryMessage, void, unknown>`
- `unstable_v2_createSession(options): SDKSession`
- `unstable_v2_resumeSession(sessionId, options): SDKSession`
- `unstable_v2_prompt(message, options): Promise<ResultMessage>`

## Quick Start

```ts
import { query } from './src/sdk/index.js'

for await (const message of query({ prompt: 'Summarize this repository' })) {
  if (message.type === 'assistant') {
    console.log(message.text)
  }

  if (message.type === 'result') {
    console.log('done:', message.subtype, message.stop_reason)
  }
}
```

## Structured Output (`outputFormat`)

Use `outputFormat` to request JSON output validated against a JSON Schema.

```ts
import { query, type QueryMessage } from './src/sdk/index.js'

const messages: QueryMessage[] = []

for await (const message of query({
  prompt: 'Return the project name and language',
  options: {
    outputFormat: {
      type: 'json_schema',
      maxRetries: 1,
      schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          language: { type: 'string' },
        },
        required: ['project_name', 'language'],
        additionalProperties: false,
      },
    },
  },
})) {
  messages.push(message)
}

const result = messages.findLast((m) => m.type === 'result')
if (result?.type === 'result') {
  console.log(result.subtype)
  console.log(result.structured_output)
}
```

### Result Subtypes

Structured output paths can end with:
- `success`: schema validation succeeded.
- `error_max_structured_output_retries`: schema validation failed after retry budget was exhausted.
- `error_during_execution`: runtime-level error while executing a turn.

When `subtype` is not `success`, `result.error` contains details.

## Message Stream Shape

`query()` can emit these message types in order:
- `system` (init metadata)
- `stream_event` (optional, when partial events are enabled)
- `input_request` (approval or ask-user-question prompts)
- `assistant` (final assistant text/blocks for the turn)
- `result` (terminal message for the call)

Callers should consume until the terminal `result` message.

## V2 Session API (`unstable_v2_*`)

The SDK also provides a session-style API aligned with Claude Agent SDK naming.

```ts
import { unstable_v2_createSession } from './src/sdk/index.js'

await using session = unstable_v2_createSession({ model: 'claude-sonnet-4-6' })
await session.send('Hello')

for await (const message of session.stream()) {
  if (message.type === 'assistant') {
    console.log(message.text)
  }
}
```

One-shot convenience:

```ts
import { unstable_v2_prompt } from './src/sdk/index.js'

const result = await unstable_v2_prompt('What is 2 + 2?', { model: 'claude-sonnet-4-6' })
console.log(result.subtype, result.result)
```

Resume:

```ts
import { unstable_v2_resumeSession } from './src/sdk/index.js'

const resumed = unstable_v2_resumeSession(existingSessionId, {})
await resumed.send('continue')
for await (const message of resumed.stream()) {
  // ...
}
```

Current limitation (explicit):
- `unstable_v2_resumeSession` is currently in-process only. The session ID must come from a session created in the same Node.js process.
