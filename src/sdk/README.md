# Formax SDK (TypeScript)

This folder exposes the in-process SDK surface used by TypeScript callers.

Public entrypoint:
- `src/sdk/index.ts`

Primary API:
- `query(args): AsyncGenerator<QueryMessage, void, unknown>`

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
